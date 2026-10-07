/**
 * 整本书离线下载（见 `docs/reading-content.md` §4.4）。
 *
 * 取数走新版 `/v3/tipitaka-reading/{channel}`：`book` 过滤 + 不透明游标一块块取，
 * 每块写回 `para_html`。分母（本书有译文的段数）直接取 `meta.total`，不再逐章探测。
 *
 * 断点续传 = 把 `meta.next_cursor` 存进 `download_state.cursor`：中断 / 重启后从
 * 游标继续，不重下已下过的段。游标为 null 表示整本取完。
 *
 * 串行下载：同一时刻只跑一个下载循环（并发 1，逐个下载），没有排队队列。切用户前
 * 用 `pauseAllDownloads` 暂停当前下载（downloading → paused、保留 cursor），避免
 * 旧账号的循环写进新账号的库。
 */
import { DOWNLOAD_PAGE_SIZE } from "../api/read-chapter";
import { cachedParaCount, fetchChapterBlock } from "./cache";
import {
  tipitakaRunner,
  withReadingTransaction,
  withReadingWrite,
} from "./db";
import { firstReadingParagraph, level1ParagraphOf } from "./unit";
import { localKey, outboxDelete, outboxUpsert } from "../data/queue";
import { t } from "../i18n";

export type DownloadStatus =
  | "pending"
  | "queued"
  | "downloading"
  | "paused"
  | "done"
  | "error";

export interface DownloadProgress {
  channel: string;
  book: number;
  status: DownloadStatus;
  /**
   * 分母：该版本在本书**有译文**的段落总数（游标接口的 `meta.total`）。
   * 还没开工、拿不到接口数字时退化成本书的段落总数，开工后立刻被真值替换。
   */
  total: number;
  /** 分子：已缓存到有正文的段数。 */
  done: number;
  error?: string | null;
  updatedAt: number;
}

/** 百分比（0–100，整数）。 */
export function percent(p: Pick<DownloadProgress, "total" | "done">): number {
  if (p.total <= 0) return 0;
  return Math.min(100, Math.round((p.done / p.total) * 100));
}

/**
 * 该书段落总数（只读库，离线可算）——**分母的兜底值**。
 *
 * 真正的分母是「该版本有译文的段数」，只有联网问过游标接口才知道；一次都没
 * 下载过的书拿不到，先用本书段落总数顶着，开工后第一块就会换成真值。
 */
async function totalParas(book: number): Promise<number> {
  const sql = await tipitakaRunner();
  const rows = await sql.all<{ n: number }>(
    "SELECT count(*) n FROM pali_text WHERE book = ?",
    [book],
  );
  return rows[0]?.n ?? 0;
}

async function writeState(
  p: DownloadProgress,
  anchorParagraph?: number,
  cursor?: string | null,
): Promise<void> {
  // 进度写 + 完成时入队放同一个事务（与正文缓存的写事务串行，避免互相打断）。
  await withReadingTransaction(async (db) => {
    // 用 upsert 保留 server_id（同步回填的服务器 like.id），下载进度更新不覆盖它。
    await db.runAsync(
      `INSERT INTO download_state (channel, book, status, total, done, error, updated_at, cursor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel, book) DO UPDATE SET
         status = excluded.status,
         total = excluded.total,
         done = excluded.done,
         error = excluded.error,
         updated_at = excluded.updated_at,
         cursor = excluded.cursor`,
      [
        p.channel,
        p.book,
        p.status,
        p.total,
        p.done,
        p.error ?? null,
        p.updatedAt,
        cursor ?? null,
      ],
    );
    // 下载完成 = 一条「下载记录」，入队同步到服务器 likes（type=download）。
    if (p.status === "done") {
      await enqueueDownloadSync(db, p.channel, p.book, anchorParagraph);
    }
  });
}

/** 下载完成时入队一条下载记录同步（幂等，local_key 唯一）。 */
async function enqueueDownloadSync(
  db: import("expo-sqlite").SQLiteDatabase,
  channel: string,
  book: number,
  anchorParagraph?: number,
): Promise<void> {
  const prev = await db.getFirstAsync<{ server_id: string | null }>(
    "SELECT server_id FROM download_state WHERE channel = ? AND book = ?",
    [channel, book],
  );
  // 下载是书级操作：锚定 level=1 段（progress_chapters 里 para 指向 level=1 的行就是「书」）。
  // 从「下载时所在段」向上搜索到 level=1；没传则退回第一个 level=1。
  const sql = await tipitakaRunner();
  const raw = anchorParagraph ?? (await firstReadingParagraph(sql, book));
  const paragraph =
    raw != null ? await level1ParagraphOf(sql, book, raw) : null;
  await outboxUpsert(
    db,
    localKey("download", book, undefined, channel),
    "download",
    { channel, book, paragraph, updatedAt: Date.now() },
    prev?.server_id ?? null,
  );
}

/** 读一本书的下载状态；没有记录时按已缓存段数现算。 */
export function getDownloadProgress(
  channelId: string,
  book: number,
): Promise<DownloadProgress> {
  // 读也走串行队列，避免与下载写并发（expo-sqlite 并发调用会触发 NPE）。
  return withReadingWrite(async (db) => {
    const row = await db.getFirstAsync<{
      status: DownloadStatus;
      total: number;
      done: number;
      error: string | null;
      updated_at: number;
    }>(
      "SELECT status, total, done, error, updated_at FROM download_state WHERE channel = ? AND book = ?",
      [channelId, book],
    );
    if (row) {
      return {
        channel: channelId,
        book,
        status: row.status,
        total: row.total,
        done: row.done,
        error: row.error,
        updatedAt: row.updated_at,
      };
    }
    const doneRow = await db.getFirstAsync<{ n: number }>(
      "SELECT count(html) n FROM para_html WHERE channel = ? AND book = ?",
      [channelId, book],
    );
    return {
      channel: channelId,
      book,
      status: "pending",
      total: await totalParas(book),
      done: doneRow?.n ?? 0,
      updatedAt: 0,
    };
  });
}

/**
 * 仅删除下载的正文数据：清 `para_html`，`download_state` 改回 `pending`（保留记录）。
 * 服务器上的 download reaction **不动**。
 */
export async function clearDownloadData(
  channelId: string,
  book: number,
): Promise<void> {
  cancelIfCurrent(channelId, book);
  await withReadingTransaction(async (db) => {
    await db.runAsync("DELETE FROM para_html WHERE channel = ? AND book = ?", [
      channelId,
      book,
    ]);
    await db.runAsync(
      `UPDATE download_state SET status = 'pending', total = 0, done = 0, error = NULL, cursor = NULL
        WHERE channel = ? AND book = ?`,
      [channelId, book],
    );
  });
}

/**
 * 删除下载数据 + 下载记录：清 `para_html`、删 `download_state`，并入队服务器
 * download reaction 的 delete 墓碑（登录后由 `syncNow` 删除服务器记录）。
 */
export async function removeDownload(
  channelId: string,
  book: number,
): Promise<void> {
  cancelIfCurrent(channelId, book);
  await withReadingTransaction(async (db) => {
    await db.runAsync("DELETE FROM para_html WHERE channel = ? AND book = ?", [
      channelId,
      book,
    ]);
    const prev = await db.getFirstAsync<{ server_id: string | null }>(
      "SELECT server_id FROM download_state WHERE channel = ? AND book = ?",
      [channelId, book],
    );
    await db.runAsync(
      "DELETE FROM download_state WHERE channel = ? AND book = ?",
      [channelId, book],
    );
    await outboxDelete(
      db,
      localKey("download", book, undefined, channelId),
      "download",
      { channel: channelId, book },
      prev?.server_id ?? null,
    );
  });
}

/** 全部下载记录（书架「已下载」列表）。 */
export function listDownloads(): Promise<DownloadProgress[]> {
  return withReadingWrite(async (db) => {
    const rows = await db.getAllAsync<{
      channel: string;
      book: number;
      status: DownloadStatus;
      total: number;
      done: number;
      error: string | null;
      updated_at: number;
    }>("SELECT * FROM download_state ORDER BY updated_at DESC");
    return rows.map((r) => ({
      channel: r.channel,
      book: r.book,
      status: r.status,
      total: r.total,
      done: r.done,
      error: r.error,
      updatedAt: r.updated_at,
    }));
  });
}

// ── 串行下载：同一时刻只跑一个循环，逐个下载 ──

const runKey = (channelId: string, book: number) => `${channelId}/${book}`;

/** 正在跑的那本书的 key（同一时刻最多一个）。 */
let currentKey: string | null = null;
/** 当前循环的取消开关。 */
let cancelled = false;
/** 切用户 / 暂停全部期间：不再开跑等待中的下载。 */
let suspended = false;
/** 串行队列：下一个下载等上一个结束再跑。 */
let chain: Promise<unknown> = Promise.resolve();
/** 排队中 + 正在跑的下载总数（用来判断新来的书是否需要排队）。 */
let pendingCount = 0;
/** 排队等待中的 key（在串行链里等着的书）。 */
const queuedKeys = new Set<string>();
/** 被用户取消排队的 key（等链轮到它时直接跳过）。 */
const cancelledQueued = new Set<string>();

/** 是否正在下载（有活体循环在跑）。 */
export function isDownloading(channelId: string, book: number): boolean {
  return currentKey === runKey(channelId, book);
}

/** 是否排队等待下载（还没轮到，串行链里等前面的书下完）。 */
export function isQueued(channelId: string, book: number): boolean {
  return queuedKeys.has(runKey(channelId, book));
}

/** 把一本书标记为排队中（保留 total/done/cursor/server_id）。 */
async function markQueued(channelId: string, book: number): Promise<void> {
  await withReadingWrite((db) =>
    db.runAsync(
      `INSERT INTO download_state (channel, book, status, total, done, error, updated_at, cursor)
       VALUES (?, ?, 'queued', 0, 0, NULL, ?, NULL)
       ON CONFLICT(channel, book) DO UPDATE SET
         status = 'queued',
         updated_at = excluded.updated_at`,
      [channelId, book, Date.now()],
    ),
  );
}

/** 暂停下载：跑着的停止循环；排队中的撤出队列。已写入的数据全部有效。 */
export function pauseDownload(channelId: string, book: number): void {
  const key = runKey(channelId, book);
  if (currentKey === key) {
    cancelled = true;
    return;
  }
  if (queuedKeys.has(key)) {
    queuedKeys.delete(key);
    cancelledQueued.add(key);
    // 撤出队列：有数据 → paused（可续传），否则 → pending（未下载）。
    void withReadingWrite(async (db) => {
      const row = await db.getFirstAsync<{ done: number }>(
        "SELECT done FROM download_state WHERE channel = ? AND book = ?",
        [channelId, book],
      );
      const status = (row?.done ?? 0) > 0 ? "paused" : "pending";
      await db.runAsync(
        "UPDATE download_state SET status = ?, updated_at = ? WHERE channel = ? AND book = ?",
        [status, Date.now(), channelId, book],
      );
    });
  }
}

/** 若这本书正在下载则取消它（删除/清数据用）。 */
function cancelIfCurrent(channelId: string, book: number): void {
  if (currentKey === runKey(channelId, book)) cancelled = true;
}

/**
 * 下载循环的兜底上限：防御服务端游标不推进时空转。正常一本书按 5000 字节一块
 * 几百块就取完了，这个上限只在数据异常时兜底。
 */
const MAX_DOWNLOAD_BLOCKS = 50000;

/** 跑一本书的下载循环，返回最终进度（错误落到 status，不向外抛）。 */
async function runDownloadLoop(
  channelId: string,
  book: number,
  onProgress?: (p: DownloadProgress) => void,
  anchorParagraph?: number,
): Promise<DownloadProgress> {
  const key = runKey(channelId, book);
  // 轮到它了：不再是排队状态；若排队期间被取消，直接跳过。
  queuedKeys.delete(key);
  if (cancelledQueued.has(key)) {
    cancelledQueued.delete(key);
    const p = await getDownloadProgress(channelId, book);
    onProgress?.(p);
    return p;
  }
  // 切用户暂停期间不再开跑。
  if (suspended) {
    const p = await getDownloadProgress(channelId, book);
    onProgress?.(p);
    return p;
  }

  currentKey = key;
  cancelled = false;

  let progress: DownloadProgress = {
    channel: channelId,
    book,
    status: "downloading",
    total: 0,
    done: 0,
    error: null,
    updatedAt: Date.now(),
  };
  let cursor: string | null = null;

  const publish = async (patch: Partial<DownloadProgress>) => {
    progress = { ...progress, ...patch, updatedAt: Date.now() };
    await writeState(progress, anchorParagraph, cursor);
    onProgress?.(progress);
  };

  try {
    // 断点续传：上次没取完的游标与分母（读也走串行队列）。
    const stored = await withReadingWrite((wdb) =>
      wdb.getFirstAsync<{
        total: number;
        cursor: string | null;
      }>(
        "SELECT total, cursor FROM download_state WHERE channel = ? AND book = ?",
        [channelId, book],
      ),
    );
    progress = {
      ...progress,
      total: stored?.total ?? (await totalParas(book)),
      done: await cachedParaCount(channelId, book),
    };
    cursor = stored?.cursor ?? null;
    await publish({});

    for (let n = 0; n < MAX_DOWNLOAD_BLOCKS; n++) {
      if (cancelled) {
        await publish({ status: "paused" });
        return progress;
      }

      const block = await fetchChapterBlock(
        channelId,
        book,
        cursor,
        DOWNLOAD_PAGE_SIZE,
      );
      // 取数期间被取消（暂停/删除/切用户）：别再写 done 或继续推进，落 paused。
      if (cancelled) {
        await publish({ status: "paused" });
        return progress;
      }
      if (!block) throw new Error(t("error.network"));
      // 分母取 meta.total（本书有译文的段数），首块拿到即固定。
      if (block.total != null) progress.total = block.total;

      cursor = block.nextCursor; // null = 取完
      if (cursor == null) {
        // 分子按「渲染出正文的段」数，分母按服务端的「有译文的段」数 —— 个别段
        // 在服务端有句子、渲染出来却是空的，会差上几段。整本取完就按满算，
        // 否则进度条永远停在 99%。
        await publish({ status: "done", done: progress.total });
        return progress;
      }

      await publish({
        total: progress.total,
        done: await cachedParaCount(channelId, book),
      });
    }
    throw new Error(`download: book ${book} 取数块数超上限`);
  } catch (err) {
    try {
      await publish({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      /* 写 error 状态本身失败（如 DB 不可用）时放弃，循环照常结束 */
    }
    return progress;
  } finally {
    currentKey = null;
  }
}

/**
 * 下载整本书。同一时刻只跑一个：若别的书在下载，则排队等到它结束；若这本书
 * 已在下载，直接回当前进度。返回的 Promise 在本书真正结束（done/error/paused）
 * 时 resolve。
 *
 * @param onProgress 每块结束后回调，用于刷新 UI 百分比。
 */
export function downloadBook(
  channelId: string,
  book: number,
  onProgress?: (p: DownloadProgress) => void,
  anchorParagraph?: number,
): Promise<DownloadProgress> {
  const key = runKey(channelId, book);
  // 已在跑同一本书：复用当前进度，回一次。
  if (currentKey === key) {
    return getDownloadProgress(channelId, book).then((p) => {
      onProgress?.(p);
      return p;
    });
  }
  // 已在排队：回一次排队进度。
  if (queuedKeys.has(key)) {
    return getDownloadProgress(channelId, book).then((p) => {
      onProgress?.(p);
      return p;
    });
  }

  // 排队：当前有别的书在跑/在排队，这本书标记为排队中，等链轮到它再开跑。
  if (pendingCount > 0) {
    queuedKeys.add(key);
    cancelledQueued.delete(key);
    const queued: DownloadProgress = {
      channel: channelId,
      book,
      status: "queued",
      total: 0,
      done: 0,
      updatedAt: Date.now(),
    };
    onProgress?.(queued);
    void markQueued(channelId, book);
  }
  pendingCount++;

  // 串行：等上一个下载结束再开跑。
  const run = chain.then(() =>
    runDownloadLoop(channelId, book, onProgress, anchorParagraph),
  );
  chain = run.then(
    () => {
      pendingCount = Math.max(0, pendingCount - 1);
    },
    () => {
      pendingCount = Math.max(0, pendingCount - 1);
    },
  );
  return run;
}

/**
 * 切换用户 / 退出前的「全部暂停」：当前正在下载 → paused（保留 cursor 可续传），
 * 等待中的不再开跑。清空执行体，防止旧账号的循环写进新账号的库。
 */
export async function pauseAllDownloads(): Promise<void> {
  suspended = true;
  cancelled = true;
  queuedKeys.clear();
  await withReadingWrite((db) =>
    db.runAsync(
      "UPDATE download_state SET status = 'paused', updated_at = ? WHERE status IN ('downloading', 'queued')",
      [Date.now()],
    ),
  );
  // 当前循环停到下一个块边界、等待中的循环因 suspended 直接返回。
  await chain;
  suspended = false;
}

/**
 * 冷启动对账：上次进程被杀残留的 `downloading` / `queued` → `paused`
 * （保留 cursor 可续传）。
 */
export async function reconcileDownloads(): Promise<void> {
  await withReadingWrite((db) =>
    db.runAsync(
      "UPDATE download_state SET status = 'paused', updated_at = ? WHERE status IN ('downloading', 'queued')",
      [Date.now()],
    ),
  );
}
