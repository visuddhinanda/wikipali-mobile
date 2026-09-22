/**
 * 整本书离线下载（见 `docs/reading-content.md` §4.4）。
 *
 * 取数与阅读走同一条链路：`tipitaka-read-chapter` 按章节 + 游标一块块取，
 * 每块写回 `para_html`，块覆盖到但没回来的段记 `html = NULL` + 过期时间。
 *
 * 断点续传不需要状态机：每章开始前先查该章已解析（且未过期）的段，游标落在
 * 第一个缺口上。中断在哪都不用记，重启时自然从缺口继续。
 */
import { DOWNLOAD_PAGE_SIZE } from "../api/read-chapter";
import { bookApiChapters, type ApiChapter } from "./chapter";
import { cachedParaCount, fetchChapterBlock, resolvedParas } from "./cache";
import { openReadingDb, tipitakaRunner } from "./db";
import { firstReadingParagraph, level1ParagraphOf } from "./unit";
import { localKey, outboxUpsert } from "../data/queue";
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
   * 分母：该版本在本书**有译文**的段落总数（章节接口的 `total_para` 逐章累加）。
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
 * 探分母用的块大小：1 段。
 *
 * 每章的第一次调用只为拿 `total_para`（该章有多少段有译文），内容顺带存下来，
 * 所以块开到最小。一本书顶层章节最多 8 个，探完分母就固定了，进度条不会
 * 边下边变分母。
 */
const PROBE_PAGE_SIZE = 1;
const PROBE_PAGE_UNIT = "para";

/**
 * 该书段落总数（只读库，离线可算）——**分母的兜底值**。
 *
 * 真正的分母是「该版本有译文的段数」，只有联网问过章节接口才知道；一次都没
 * 下载过的书拿不到，先用本书段落总数顶着，开工后第一轮探测就会换成真值。
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
): Promise<void> {
  const db = await openReadingDb();
  // 用 upsert 保留 server_id（同步回填的服务器 like.id），下载进度更新不覆盖它。
  await db.runAsync(
    `INSERT INTO download_state (channel, book, status, total, done, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel, book) DO UPDATE SET
       status = excluded.status,
       total = excluded.total,
       done = excluded.done,
       error = excluded.error,
       updated_at = excluded.updated_at`,
    [p.channel, p.book, p.status, p.total, p.done, p.error ?? null, p.updatedAt],
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

/** 章节里第一个还没解析（或占位已过期）的段；整章都齐了返回 null。 */
function firstGap(chapter: ApiChapter, resolved: Set<number>, after = 0): number | null {
  const from = Math.max(chapter.start, after);
  for (let p = from; p <= chapter.end; p++) {
    if (!resolved.has(p)) return p;
  }
  return null;
}

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

  let progress: DownloadProgress = {
    channel: channelId,
    book,
    status: "downloading",
    total: await totalParas(book),
    done: await cachedParaCount(channelId, book),
    error: null,
    updatedAt: Date.now(),
  };
  const publish = async (patch: Partial<DownloadProgress>) => {
    progress = { ...progress, ...patch, updatedAt: Date.now() };
    await writeState(progress, anchorParagraph);
    onProgress?.(progress);
  };
  await publish({});

  try {
    const chapters = await bookApiChapters(await tipitakaRunner(), book);
    if (chapters.length === 0) throw new Error(`book ${book} 无段落数据`);

    // ── 1. 探分母：每章问一次「有多少段有译文」，累加即本书的可下载段数 ──
    let total = 0;
    for (const ch of chapters) {
      if (flag.cancelled) {
        await publish({ status: "paused" });
        return progress;
      }
      const probe = await fetchChapterBlock(
        channelId,
        book,
        ch.start,
        PROBE_PAGE_SIZE,
        PROBE_PAGE_UNIT,
      );
      if (!probe) throw new Error(t("error.network"));
      total += probe.total;
    }
    await publish({ total, done: await cachedParaCount(channelId, book) });

    // ── 2. 逐章按游标取数，缺口在哪就从哪续 ──
    const resolved = await resolvedParas(
      channelId,
      book,
      chapters[0].start,
      chapters[chapters.length - 1].end,
    );

    for (const ch of chapters) {
      let cursor = firstGap(ch, resolved);
      while (cursor != null) {
        if (flag.cancelled) {
          await publish({ status: "paused" });
          return progress;
        }

        const covered = await fetchChapterBlock(
          channelId,
          book,
          cursor,
          DOWNLOAD_PAGE_SIZE,
        );
        if (!covered) throw new Error(t("error.network"));
        for (let p = cursor; p <= covered.to; p++) resolved.add(p);

        await publish({ done: await cachedParaCount(channelId, book) });
        cursor = firstGap(ch, resolved, covered.to + 1);
      }
    }

    // 分子按「渲染出正文的段」数，分母按服务端的「有译文的段」数 —— 个别段
    // 在服务端有句子、渲染出来却是空的，会差上几段。整本取完就按满算，
    // 否则进度条永远停在 99%。
    await publish({ status: "done", done: total });
    return progress;
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
