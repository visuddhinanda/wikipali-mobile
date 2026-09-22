/**
 * 同步引擎：把 `sync_outbox` 里的待同步操作推送到服务器。
 *
 * - 只有登录用户 + 联网时才推送（游客无服务器身份）。
 * - 阅读记录走 `recent`；收藏 / 书签 / 下载走 `like`。
 * - 失败保留在队列，`attempts++` 记错误，下次再试；单条失败不阻塞其余。
 *
 * 契约与「缺口」见 `docs/multi-user-sync.md` §8 / §10。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isOnline } from "../api/connectivity";
import {
  fetchProgressChapter,
  likeDelete,
  likeUpsert,
  listMyReactions,
  resolveProgressChapterUid,
  type MyReaction,
  type ProgressChapterInfo,
} from "../api/like";
import { recentListByUser, recentUpsert } from "../api/recent";
import { openReadingDb, openReadingDbFor, tipitakaRunner, withReadingTransaction } from "../reading/db";
import {
  chapterParagraphOf,
  firstReadingParagraph,
  level1ParagraphOf,
} from "../reading/unit";
import { isLoggedIn } from "../user/userScope";
import { getDeviceUuid } from "../user/deviceUuid";
import { localKey, outboxUpsert, type SyncKind } from "./queue";

const MERGED_KEY = "@wikipali/guest-merged";

const LIKE_TYPE: Record<Exclude<SyncKind, "reading">, string> = {
  favorite: "favorite",
  bookmark: "bookmark",
  download: "download",
};

interface OutboxRow {
  id: number;
  local_key: string;
  kind: SyncKind;
  op: "upsert" | "delete";
  payload: string;
  server_id: string | null;
  attempts: number;
}

/** 重试上限：超过即放弃（数据问题如 channel 无效、target 不存在，再试也没用）。 */
const MAX_ATTEMPTS = 3;

/** 解析 outbox payload（损坏时抛错，交给上层记 last_error）。 */
function parse<T>(row: OutboxRow): T {
  return JSON.parse(row.payload) as T;
}

interface LikePayload {
  book: number;
  paragraph?: number | null;
  channelId?: string | null;
  channel?: string | null;
  title?: string | null;
  heading?: string | null;
  updatedAt?: number;
}

/** 推送一条 outbox 记录。成功后返回，调用方负责删除该行。 */
async function pushRow(
  db: import("expo-sqlite").SQLiteDatabase,
  row: OutboxRow,
): Promise<void> {
  const payload = parse<LikePayload>(row);

  if (row.kind === "reading") {
    // 服务器无 recent 删除接口（缺口 3），delete 本地即完成，直接清队。
    if (row.op === "delete") return;
    const param = JSON.stringify({
      book: String(payload.book),
      para: String(payload.paragraph ?? 0),
      channel: payload.channelId ? `${payload.channelId}_` : undefined,
      mode: "reading",
    });
    const res = await recentUpsert({
      type: "chapter",
      article_id: `${payload.book}-${payload.paragraph ?? 0}`,
      param,
    });
    await db.runAsync("UPDATE reading_history SET server_id = ? WHERE book = ?", [
      res.id,
      payload.book,
    ]);
    return;
  }

  // favorite / bookmark / download → likes
  if (row.op === "delete") {
    if (row.server_id) await likeDelete(row.server_id);
    return;
  }

  const channelId = payload.channelId ?? payload.channel ?? null;
  if (!channelId) throw new Error(`sync: ${row.kind} 缺 channelId`);
  // 锚点规则（见 CLAUDE.md「领域知识」）：
  // - favorite / download：锚定 level=1（书）——从「当前所在段」向上搜索到 level=1。
  // - bookmark：progress_chapter 无法锚定 para（正文段），故锚定「包含它的章节标题段」，
  //   精确段（视口顶部段）记在 context 里。
  const bookLevel = row.kind === "favorite" || row.kind === "download";
  const raw = payload.paragraph ?? (await rootParagraph(payload.book));
  let paragraph: number | null;
  if (bookLevel) {
    paragraph = raw != null ? await level1Paragraph(payload.book, raw) : null;
  } else {
    paragraph = raw != null ? await chapterParagraph(payload.book, raw) : null;
  }
  if (paragraph == null) throw new Error(`sync: book ${payload.book} 无章节`);
  const targetId = await resolveProgressChapterUid(
    payload.book,
    paragraph,
    channelId,
  );
  if (!targetId) {
    throw new Error(`sync: book ${payload.book}-${paragraph} 无 progress_chapter`);
  }

  // context：favorite/download 记录完整「书」定位（book + level=1 段 [+ channel]）；
  // bookmark 记录精确段（视口顶部段），供下拉还原精确位置。
  const context =
    row.kind === "favorite"
      ? `book:${payload.book}-${paragraph}`
      : row.kind === "download"
        ? `book:${payload.book}-${paragraph}:${channelId}`
        : `para:${raw}`;

  const res = await likeUpsert({
    type: LIKE_TYPE[row.kind],
    target_id: targetId,
    target_type: "progress_chapter",
    ...(context ? { context } : {}),
  });

  // 回填服务器 id，供后续删除 / 幂等去重。
  if (row.kind === "favorite") {
    await db.runAsync("UPDATE starred SET server_id = ? WHERE book = ?", [
      res.id,
      payload.book,
    ]);
  } else if (row.kind === "bookmark") {
    await db.runAsync(
      "UPDATE bookmarks SET server_id = ? WHERE book = ? AND paragraph = ?",
      [res.id, payload.book, payload.paragraph ?? 0],
    );
  } else {
    await db.runAsync(
      "UPDATE download_state SET server_id = ? WHERE channel = ? AND book = ?",
      [res.id, channelId, payload.book],
    );
  }
}

/**
 * 一本书的「书级」段落：第一个 `level = 1` 的章节行。
 *
 * `progress_chapters` 的 `para` 指向 `pali_texts.paragraph`；当那行 `level=1` 时，
 * 这个 progress_chapter 就是「书」本身（见 CLAUDE.md「领域知识」）。
 */
async function rootParagraph(book: number): Promise<number | null> {
  return firstReadingParagraph(await tipitakaRunner(), book);
}

/** 包含指定段落的章节标题段（`level ≤ 7`），书签锚点用。 */
async function chapterParagraph(
  book: number,
  para: number,
): Promise<number | null> {
  return chapterParagraphOf(await tipitakaRunner(), book, para);
}

/** 覆盖指定段落的 `level = 1` 段（「书」），收藏/下载锚点用。 */
async function level1Paragraph(
  book: number,
  para: number,
): Promise<number | null> {
  return level1ParagraphOf(await tipitakaRunner(), book, para);
}

/** 当前用户的待同步条数（未登录返回 0）。 */
export async function pendingSyncCount(): Promise<number> {
  if (!isLoggedIn()) return 0;
  try {
    const db = await openReadingDb();
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT count(*) n FROM sync_outbox",
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

let syncing = false;

/** 推一轮：联网且登录时执行，返回成功推送的条数。 */
export async function syncNow(): Promise<number> {
  if (syncing) return 0; // 防止并发推送（登录收尾 + 前台事件同时触发）
  if (!isLoggedIn()) return 0;
  if (!(await isOnline())) return 0;

  syncing = true;
  try {
    return await doSync();
  } finally {
    syncing = false;
  }
}

async function doSync(): Promise<number> {
  const db = await openReadingDb();
  const rows = await db.getAllAsync<OutboxRow>(
    "SELECT id, local_key, kind, op, payload, server_id, attempts FROM sync_outbox ORDER BY id ASC LIMIT 50",
  );
  let pushed = 0;
  for (const row of rows) {
    try {
      await pushRow(db, row);
      await db.runAsync("DELETE FROM sync_outbox WHERE id = ?", [row.id]);
      pushed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (row.attempts + 1 >= MAX_ATTEMPTS) {
        // 超过重试上限：数据问题（如 channel 无效、target 不存在）再试也没用，放弃。
        await db.runAsync("DELETE FROM sync_outbox WHERE id = ?", [row.id]);
      } else {
        await db.runAsync(
          "UPDATE sync_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?",
          [message, row.id],
        );
      }
    }
  }
  return pushed;
}

/** 从服务器拉取阅读记录并合并进本地（换设备 / 首次登录时调用）。 */
export async function pullReadingHistory(userId: string): Promise<number> {
  const rows = await recentListByUser(userId, "chapter");
  let n = 0;
  await withReadingTransaction(async (db) => {
    for (const r of rows) {
      const [bookStr, paraStr] = String(r.article_id).split("-");
      const book = Number(bookStr);
      const paragraph = Number(paraStr);
      if (!Number.isFinite(book) || !Number.isFinite(paragraph)) continue;
      let channelId: string | null = null;
      if (r.param) {
        try {
          const p = JSON.parse(r.param) as { channel?: string };
          channelId = p.channel ? String(p.channel).split("_")[0] : null;
        } catch {
          channelId = null;
        }
      }
      // 服务器时间戳归一为 epoch ms；解析失败按「较新」处理。
      const parsed = r.updated_at
        ? Date.parse(String(r.updated_at).replace(" ", "T"))
        : NaN;
      const updatedAt = Number.isFinite(parsed) ? parsed : Date.now();
      // 冲突按「较新者胜」：本地较新则保留本地，跳过覆盖。
      const local = await db.getFirstAsync<{ updated_at: number }>(
        "SELECT updated_at FROM reading_history WHERE book = ?",
        [book],
      );
      if (local && local.updated_at >= updatedAt) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO reading_history
           (book, paragraph, title, heading, channel_id, updated_at, server_id)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`,
        [
          book,
          paragraph,
          r.title || `${book}-${paragraph}`,
          channelId,
          updatedAt,
          r.id,
        ],
      );
      n += 1;
    }
  });
  return n;
}

/** 服务器时间戳 → epoch ms；解析失败按「当前」处理。 */
function parseServerTime(ts?: string): number {
  if (!ts) return Date.now();
  const parsed = Date.parse(String(ts).replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** 解析 bookmark 的 context `para:<n>`（精确段，视口顶部段）。 */
function parseBookmarkContext(context: string | null): number | null {
  if (!context) return null;
  const m = /^para:(\d+)$/.exec(context);
  if (!m) return null;
  const para = Number(m[1]);
  return Number.isFinite(para) ? para : null;
}

type SyncDb = import("expo-sqlite").SQLiteDatabase;

/** 较新者胜：本地 updated_at 不比服务器旧就跳过覆盖。 */
async function localIsNewer(
  db: SyncDb,
  sql: string,
  params: import("expo-sqlite").SQLiteBindValue[],
  serverAt: number,
): Promise<boolean> {
  const cur = await db.getFirstAsync<{ updated_at: number }>(sql, params);
  return !!cur && cur.updated_at >= serverAt;
}

/** 下拉收藏：target_id 反查 → (book, para=level1, channel)。 */
async function applyFavorite(
  db: SyncDb,
  r: MyReaction,
  info: ProgressChapterInfo,
): Promise<void> {
  const updatedAt = parseServerTime(r.updated_at);
  if (
    await localIsNewer(
      db,
      "SELECT updated_at FROM starred WHERE book = ?",
      [info.book],
      updatedAt,
    )
  ) {
    return;
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO starred (book, paragraph, title, channel_id, updated_at, server_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      info.book,
      info.para,
      info.title ?? `${info.book}-${info.para}`,
      info.channel_id,
      updatedAt,
      r.id,
    ],
  );
}

/** 下拉书签：book/channel 取自反查 info；精确段取 context 的 `para:<n>`（无则回退反查的章节段）。 */
async function applyBookmark(
  db: SyncDb,
  r: MyReaction,
  info: ProgressChapterInfo,
): Promise<void> {
  const updatedAt = parseServerTime(r.updated_at);
  const paragraph = parseBookmarkContext(r.context) ?? info.para;
  if (
    await localIsNewer(
      db,
      "SELECT updated_at FROM bookmarks WHERE book = ? AND paragraph = ?",
      [info.book, paragraph],
      updatedAt,
    )
  ) {
    return;
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO bookmarks (book, paragraph, title, heading, channel_id, updated_at, server_id)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
    [
      info.book,
      paragraph,
      info.title ?? `${info.book}-${paragraph}`,
      info.channel_id,
      updatedAt,
      r.id,
    ],
  );
}

/** 下拉下载：只补「本地没有」的记录（不覆盖已下载设备上的进度）。
 *  `book` / `channel` 一律取自反查 `info`（target_id → progress_chapters 表），
 *  不依赖 context —— 反查拿到的 (book, para, channel) 才是完整定位。 */
async function applyDownload(
  db: SyncDb,
  r: MyReaction,
  info: ProgressChapterInfo,
): Promise<void> {
  const book = info.book;
  const channel = info.channel_id;
  const cur = await db.getFirstAsync<{ n: number }>(
    "SELECT count(*) n FROM download_state WHERE channel = ? AND book = ?",
    [channel, book],
  );
  if ((cur?.n ?? 0) > 0) return;
  await db.runAsync(
    `INSERT INTO download_state (channel, book, status, total, done, error, updated_at, server_id)
     VALUES (?, ?, 'pending', 0, 0, NULL, ?, ?)`,
    [channel, book, parseServerTime(r.updated_at), r.id],
  );
}

/**
 * 下拉我自己的收藏 / 书签 / 下载 reactions，逐条反查 `target_id` 还原成本地记录。
 * 依赖 `GET /api/v2/progress/{uid}` 反查（`docs/multi-user-sync.md` §10 缺口 1）。
 */
export async function pullReactions(): Promise<number> {
  const kinds = ["favorite", "bookmark", "download"] as const;
  let n = 0;
  for (const type of kinds) {
    let rows: MyReaction[];
    try {
      rows = await listMyReactions(type);
    } catch (err) {
      console.warn(`[sync] listMyReactions(${type}) failed:`, err);
      continue;
    }
    for (const r of rows) {
      try {
        const info = await fetchProgressChapter(r.target_id);
        await withReadingTransaction(async (db) => {
          if (type === "favorite") await applyFavorite(db, r, info);
          else if (type === "bookmark") await applyBookmark(db, r, info);
          else await applyDownload(db, r, info);
        });
        n += 1;
      } catch (err) {
        console.warn(`[sync] apply ${type} failed:`, err);
      }
    }
  }
  return n;
}

/**
 * 把游客期间的本地数据并入登录用户（登录后询问、用户同意时调用）。
 * 复制 reading_history / bookmarks / starred，并为每条入队 upsert；
 * 下载记录只入队 upsert（不复制正文），使服务器获得「下载过这本书」的记录。
 */
export async function mergeGuestIntoUser(userId: string): Promise<number> {
  const guestId = await getDeviceUuid();
  if (!guestId || guestId === userId) return 0;

  const guest = await openReadingDbFor(guestId);
  const user = await openReadingDbFor(userId);
  let count = 0;
  try {
    await user.withTransactionAsync(async () => {
      // 阅读记录
      const histories = await guest.getAllAsync<{
        book: number;
        paragraph: number;
        title: string;
        heading: string | null;
        channel_id: string | null;
        updated_at: number;
      }>("SELECT book, paragraph, title, heading, channel_id, updated_at FROM reading_history");
      for (const r of histories) {
        const cur = await user.getFirstAsync<{ updated_at: number }>(
          "SELECT updated_at FROM reading_history WHERE book = ?",
          [r.book],
        );
        if (cur && cur.updated_at >= r.updated_at) continue;
        await user.runAsync(
          `INSERT OR REPLACE INTO reading_history
             (book, paragraph, title, heading, channel_id, updated_at, server_id)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          [r.book, r.paragraph, r.title, r.heading, r.channel_id, r.updated_at],
        );
        await outboxUpsert(
          user,
          localKey("reading", r.book),
          "reading",
          { book: r.book, paragraph: r.paragraph, title: r.title, heading: r.heading, channelId: r.channel_id, updatedAt: r.updated_at },
          null,
        );
        count += 1;
      }

      // 书签
      const marks = await guest.getAllAsync<{
        book: number;
        paragraph: number;
        title: string;
        heading: string | null;
        channel_id: string | null;
        updated_at: number;
      }>("SELECT book, paragraph, title, heading, channel_id, updated_at FROM bookmarks");
      for (const r of marks) {
        const cur = await user.getFirstAsync<{ updated_at: number }>(
          "SELECT updated_at FROM bookmarks WHERE book = ? AND paragraph = ?",
          [r.book, r.paragraph],
        );
        if (cur && cur.updated_at >= r.updated_at) continue;
        await user.runAsync(
          `INSERT OR REPLACE INTO bookmarks
             (book, paragraph, title, heading, channel_id, updated_at, server_id)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          [r.book, r.paragraph, r.title, r.heading, r.channel_id, r.updated_at],
        );
        await outboxUpsert(
          user,
          localKey("bookmark", r.book, r.paragraph),
          "bookmark",
          { book: r.book, paragraph: r.paragraph, title: r.title, heading: r.heading, channelId: r.channel_id, updatedAt: r.updated_at },
          null,
        );
        count += 1;
      }

      // 收藏
      const stars = await guest.getAllAsync<{
        book: number;
        paragraph: number | null;
        title: string;
        channel_id: string | null;
        updated_at: number;
      }>("SELECT book, paragraph, title, channel_id, updated_at FROM starred");
      for (const r of stars) {
        const cur = await user.getFirstAsync<{ updated_at: number }>(
          "SELECT updated_at FROM starred WHERE book = ?",
          [r.book],
        );
        if (cur && cur.updated_at >= r.updated_at) continue;
        await user.runAsync(
          `INSERT OR REPLACE INTO starred
             (book, paragraph, title, channel_id, updated_at, server_id)
           VALUES (?, ?, ?, ?, ?, NULL)`,
          [r.book, r.paragraph, r.title, r.channel_id, r.updated_at],
        );
        await outboxUpsert(
          user,
          localKey("favorite", r.book),
          "favorite",
          { book: r.book, paragraph: r.paragraph, title: r.title, channelId: r.channel_id, updatedAt: r.updated_at },
          null,
        );
        count += 1;
      }

      // 下载记录：只入队 upsert（不复制正文），让服务器记下「下载过这本书」。
      const downloads = await guest.getAllAsync<{
        channel: string;
        book: number;
        updated_at: number;
      }>("SELECT channel, book, updated_at FROM download_state");
      const sql = await tipitakaRunner();
      for (const r of downloads) {
        const paragraph = await firstReadingParagraph(sql, r.book);
        await outboxUpsert(
          user,
          localKey("download", r.book, undefined, r.channel),
          "download",
          { channel: r.channel, book: r.book, paragraph, updatedAt: r.updated_at },
          null,
        );
        count += 1;
      }
    });

    // 标记游客已合并（下一次登录不再重复询问）。
    await AsyncStorage.setItem(`${MERGED_KEY}:${userId}`, "1");
  } finally {
    await guest.closeAsync();
    await user.closeAsync();
  }
  return count;
}

/** 该账户是否已并入过游客数据。 */
export async function guestMergedFor(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(`${MERGED_KEY}:${userId}`)) === "1";
  } catch {
    return false;
  }
}

/** 游客库里是否有待合并的用户数据（登录后据此决定是否弹「合并」询问）。 */
export async function guestHasData(): Promise<boolean> {
  try {
    const guestId = await getDeviceUuid();
    const db = await openReadingDbFor(guestId);
    try {
      const tables = ["reading_history", "bookmarks", "starred", "download_state"];
      for (const t of tables) {
        const row = await db.getFirstAsync<{ n: number }>(
          `SELECT count(*) n FROM ${t}`,
        );
        if ((row?.n ?? 0) > 0) return true;
      }
      const q = await db.getFirstAsync<{ n: number }>(
        "SELECT count(*) n FROM sync_outbox",
      );
      return (q?.n ?? 0) > 0;
    } finally {
      await db.closeAsync();
    }
  } catch {
    return false;
  }
}
