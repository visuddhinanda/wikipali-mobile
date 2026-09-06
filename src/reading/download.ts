/**
 * 整本书离线下载（见 `docs/reading-content.md` §4.4）。
 *
 * 断点续传不需要状态机：每批写入前先查该批已缓存的段，已有的跳过。
 * 中断在哪都不用记，重启时自然从缺口继续。
 */
import { planBookRanges } from "./batch";
import { cachedParaCount, cachedParas, storeParas } from "./cache";
import { openReadingDb, tipitakaRunner } from "./db";

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
  /** 该书段落总数（含章节标题行）。 */
  total: number;
  /** 已缓存段数。 */
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
 * 该书段落总数（只读库，离线可算）——进度的分母。
 *
 * 数的是**全部行**，不是只数 `level = 100` 的正文行：章节标题行同样有正文
 * （接口对标题行也返回 display，如书 93 的 para 5 是个 `<h4>`），下载与缓存
 * 都会把它们存进 para_html。只数正文行会让分子大于分母，进度冲破 100%。
 */
async function totalParas(book: number): Promise<number> {
  const sql = await tipitakaRunner();
  const rows = await sql.all<{ n: number }>(
    "SELECT count(*) n FROM pali_text WHERE book = ?",
    [book],
  );
  return rows[0]?.n ?? 0;
}

/**
 * 该书的段落范围（下载时按 paragraph 从小到大扫）。
 *
 * 全库 217 本的段落号都是连续的（`count(*) == max - min + 1`，已校验），
 * 所以直接按 `lo..hi` 扫不会请求到不存在的段，`done` 也不会超过 `total`。
 */
async function paraRange(book: number): Promise<[number, number] | null> {
  const sql = await tipitakaRunner();
  const rows = await sql.all<{ lo: number; hi: number }>(
    "SELECT min(paragraph) lo, max(paragraph) hi FROM pali_text WHERE book = ?",
    [book],
  );
  const r = rows[0];
  return r && r.lo != null ? [r.lo, r.hi] : null;
}

async function writeState(p: DownloadProgress): Promise<void> {
  const db = await openReadingDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO download_state
       (channel, book, status, total, done, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [p.channel, p.book, p.status, p.total, p.done, p.error ?? null, p.updatedAt],
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

/** 暂停下载：已写入的批次全部有效，下次调用 `downloadBook` 从缺口继续。 */
export function pauseDownload(channelId: string, book: number): void {
  const flag = running.get(runKey(channelId, book));
  if (flag) flag.cancelled = true;
}

/**
 * 下载整本书。已在下载中则直接返回当前进度。
 *
 * @param onProgress 每批结束后回调，用于刷新 UI 百分比。
 */
export async function downloadBook(
  channelId: string,
  book: number,
  onProgress?: (p: DownloadProgress) => void,
): Promise<DownloadProgress> {
  const key = runKey(channelId, book);
  if (running.has(key)) return getDownloadProgress(channelId, book);

  const flag = { cancelled: false };
  running.set(key, flag);

  const total = await totalParas(book);
  let progress: DownloadProgress = {
    channel: channelId,
    book,
    status: "downloading",
    total,
    done: await cachedParaCount(channelId, book),
    error: null,
    updatedAt: Date.now(),
  };
  await writeState(progress);
  onProgress?.(progress);

  try {
    const range = await paraRange(book);
    if (!range) throw new Error(`book ${book} 无段落数据`);
    const [lo, hi] = range;

    // 断点续传：先算出还缺哪些段，只对缺口分批。中断在哪都不用记 ——
    // 已写入的段自然被跳过（docs/reading-content.md §4.4）。
    const have = await cachedParas(channelId, book, lo, hi);
    const missing: number[] = [];
    for (let p = lo; p <= hi; p++) {
      if (!have.has(p)) missing.push(p);
    }

    // 按巴利文字符数分批，不按固定段数（见 batch.ts）
    const ranges = await planBookRanges(await tipitakaRunner(), book, missing);
    for (const [from, to] of ranges) {
      if (flag.cancelled) {
        progress = { ...progress, status: "paused", updatedAt: Date.now() };
        await writeState(progress);
        onProgress?.(progress);
        return progress;
      }

      await storeParas(channelId, book, from, to);
      progress = {
        ...progress,
        done: await cachedParaCount(channelId, book),
        updatedAt: Date.now(),
      };
      await writeState(progress);
      onProgress?.(progress);
    }

    progress = {
      ...progress,
      status: "done",
      done: await cachedParaCount(channelId, book),
      updatedAt: Date.now(),
    };
    await writeState(progress);
    onProgress?.(progress);
    return progress;
  } catch (err) {
    progress = {
      ...progress,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      updatedAt: Date.now(),
    };
    await writeState(progress);
    onProgress?.(progress);
    return progress;
  } finally {
    running.delete(key);
  }
}
