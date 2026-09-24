/**
 * 整本书离线下载（见 `docs/reading-content.md` §4.4）。
 *
 * 取数走新版 `/v3/tipitaka-reading/{channel}`：`book` 过滤 + 不透明游标一块块取，
 * 每块写回 `para_html`。分母（本书有译文的段数）直接取 `meta.total`，不再逐章探测。
 *
 * 断点续传 = 把 `meta.next_cursor` 存进 `download_state.cursor`：中断 / 重启后从
 * 游标继续，不重下已下过的段。游标为 null 表示整本取完。
 */
import { DOWNLOAD_PAGE_SIZE } from "../api/read-chapter";
import { cachedParaCount, fetchChapterBlock } from "./cache";
import { openReadingDb, tipitakaRunner } from "./db";
import { firstReadingParagraph, level1ParagraphOf } from "./unit";
import { localKey, outboxDelete, outboxUpsert } from "../data/queue";
import { t } from "../i18n";

export type DownloadStatus =
  | "pending"
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
  const db = await openReadingDb();
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
export async function getDownloadProgress(
  channelId: string,
  book: number,
): Promise<DownloadProgress> {
  const db = await openReadingDb();
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
  const [total, done] = await Promise.all([
    totalParas(book),
    cachedParaCount(channelId, book),
  ]);
  return {
    channel: channelId,
    book,
    status: "pending",
    total,
    done,
    updatedAt: 0,
  };
}

/**
 * 仅删除下载的正文数据：清 `para_html`，`download_state` 改回 `pending`（保留记录）。
 * 服务器上的 download reaction **不动**。
 */
export async function clearDownloadData(
  channelId: string,
  book: number,
): Promise<void> {
  const db = await openReadingDb();
  await db.runAsync("DELETE FROM para_html WHERE channel = ? AND book = ?", [
    channelId,
    book,
  ]);
  await db.runAsync(
    `UPDATE download_state SET status = 'pending', total = 0, done = 0, error = NULL, cursor = NULL
      WHERE channel = ? AND book = ?`,
    [channelId, book],
  );
}

/**
 * 删除下载数据 + 下载记录：清 `para_html`、删 `download_state`，并入队服务器
 * download reaction 的 delete 墓碑（登录后由 `syncNow` 删除服务器记录）。
 */
export async function removeDownload(
  channelId: string,
  book: number,
): Promise<void> {
  const db = await openReadingDb();
  await db.runAsync("DELETE FROM para_html WHERE channel = ? AND book = ?", [
    channelId,
    book,
  ]);
  const prev = await db.getFirstAsync<{ server_id: string | null }>(
    "SELECT server_id FROM download_state WHERE channel = ? AND book = ?",
    [channelId, book],
  );
  await db.runAsync("DELETE FROM download_state WHERE channel = ? AND book = ?", [
    channelId,
    book,
  ]);
  await outboxDelete(
    db,
    localKey("download", book, undefined, channelId),
    "download",
    { channel: channelId, book },
    prev?.server_id ?? null,
  );
}

/** 全部下载记录（书架「已下载」列表）。 */
export async function listDownloads(): Promise<DownloadProgress[]> {
  const db = await openReadingDb();
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
}

/** 正在下载的书 → 取消开关。用于暂停：停止循环即可，已写入的数据全部有效。 */
const running = new Map<string, { cancelled: boolean }>();

const runKey = (channelId: string, book: number) => `${channelId}/${book}`;

/** 是否正在下载。 */
export function isDownloading(channelId: string, book: number): boolean {
  return running.has(runKey(channelId, book));
}

/** 暂停下载：已写入的批次全部有效，下次调用 `downloadBook` 从游标继续。 */
export function pauseDownload(channelId: string, book: number): void {
  const flag = running.get(runKey(channelId, book));
  if (flag) flag.cancelled = true;
}

/**
 * 下载循环的兜底上限：防御服务端游标不推进时空转。正常一本书按 5000 字节一块
 * 几百块就取完了，这个上限只在数据异常时兜底。
 */
const MAX_DOWNLOAD_BLOCKS = 50000;

/**
 * 下载整本书。已在下载中则直接返回当前进度。
 *
 * @param onProgress 每块结束后回调，用于刷新 UI 百分比。
 */
export async function downloadBook(
  channelId: string,
  book: number,
  onProgress?: (p: DownloadProgress) => void,
  anchorParagraph?: number,
): Promise<DownloadProgress> {
  const key = runKey(channelId, book);
  if (running.has(key)) {
    // 已有循环在跑，重复调用直接回当前进度 —— 但要回调一次，
    // 否则调用方（书架的「继续」按钮）点了完全没反馈。
    const current = await getDownloadProgress(channelId, book);
    onProgress?.(current);
    return current;
  }

  const flag = { cancelled: false };
  running.set(key, flag);

  const db = await openReadingDb();
  // 断点续传：上次没取完的游标与分母。
  const stored = await db.getFirstAsync<{ total: number; cursor: string | null }>(
    "SELECT total, cursor FROM download_state WHERE channel = ? AND book = ?",
    [channelId, book],
  );

  let progress: DownloadProgress = {
    channel: channelId,
    book,
    status: "downloading",
    total: stored?.total ?? (await totalParas(book)),
    done: await cachedParaCount(channelId, book),
    error: null,
    updatedAt: Date.now(),
  };
  let cursor: string | null = stored?.cursor ?? null;

  const publish = async (patch: Partial<DownloadProgress>) => {
    progress = { ...progress, ...patch, updatedAt: Date.now() };
    await writeState(progress, anchorParagraph, cursor);
    onProgress?.(progress);
  };
  await publish({});

  try {
    for (let n = 0; n < MAX_DOWNLOAD_BLOCKS; n++) {
      if (flag.cancelled) {
        await publish({ status: "paused" });
        return progress;
      }

      const block = await fetchChapterBlock(
        channelId,
        book,
        cursor,
        DOWNLOAD_PAGE_SIZE,
      );
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
    await publish({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    return progress;
  } finally {
    running.delete(key);
  }
}
