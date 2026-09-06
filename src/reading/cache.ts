/**
 * 正文缓存（见 `docs/reading-content.md` §4）。
 *
 * 按**段落**存，不按区间存：阈值可调，用户从目录 / 上一章 / 书签等不同入口
 * 进入同一片正文，产生的区间互相重叠 —— 段落是唯一稳定的复用单位。
 */
import { fetchReadParas } from "../api/read-para";
import { planBookRanges } from "./batch";
import { openReadingDb, tipitakaRunner } from "./db";

/** 被动缓存配额：超过后按 LRU 清理未被主动下载的书（§4.5）。 */
export const CACHE_QUOTA_BYTES = 200 * 1024 * 1024;

export interface CachedPara {
  para: number;
  html: string;
}

/** 查缓存：返回该区间已缓存的段（含 `html = ''` 的空段记录）。 */
export async function readCachedParas(
  channelId: string,
  book: number,
  from: number,
  to: number,
): Promise<CachedPara[]> {
  const db = await openReadingDb();
  return db.getAllAsync<CachedPara>(
    `SELECT para, html FROM para_html
      WHERE channel = ? AND book = ? AND para BETWEEN ? AND ?
      ORDER BY para`,
    [channelId, book, from, to],
  );
}

/**
 * 拉取并写回一个区间。
 *
 * 「请求了但服务端没返回」的段落写 `html = ''`，标记为「已确认为空」——
 * 否则含空段的章节每次进入都会重新请求，永远命中不了缓存。
 */
async function fetchAndStore(
  channelId: string,
  book: number,
  from: number,
  to: number,
): Promise<Map<number, string>> {
  const { items, mock } = await fetchReadParas(book, from, to, channelId);
  const byPara = new Map(items.map((i) => [i.para, i.display ?? ""]));

  // 离线占位数据只用于当次显示，不写盘 —— 否则会冒充真经永久留在缓存里
  if (mock) return byPara;

  const now = Date.now();
  const db = await openReadingDb();
  await db.withTransactionAsync(async () => {
    for (let p = from; p <= to; p++) {
      await db.runAsync(
        `INSERT OR REPLACE INTO para_html (channel, book, para, html, fetched_at)
         VALUES (?, ?, ?, ?, ?)`,
        [channelId, book, p, byPara.get(p) ?? "", now],
      );
    }
  });

  return byPara;
}

/**
 * 取一个阅读单元的正文 HTML：查缓存 → 只补缺口 → 按段落号升序拼接。
 *
 * 空段（`html = ''`）不参与拼接。
 */
export async function loadParaHtml(
  channelId: string,
  book: number,
  from: number,
  to: number,
): Promise<string> {
  const cached = await readCachedParas(channelId, book, from, to);
  const byPara = new Map(cached.map((r) => [r.para, r.html]));

  const missing: number[] = [];
  for (let p = from; p <= to; p++) {
    if (!byPara.has(p)) missing.push(p);
  }

  // 按巴利文字符数分批（见 batch.ts）：段落大小差两个数量级，按固定段数分会超时
  for (const [a, b] of await planBookRanges(await tipitakaRunner(), book, missing)) {
    const fetched = await fetchAndStore(channelId, book, a, b);
    for (let p = a; p <= b; p++) byPara.set(p, fetched.get(p) ?? "");
  }

  const parts: string[] = [];
  for (let p = from; p <= to; p++) {
    const html = byPara.get(p);
    if (html) parts.push(html);
  }
  return parts.join("\n");
}

/** 已缓存的段数（下载进度的分子，§4.4）。 */
export async function cachedParaCount(
  channelId: string,
  book: number,
): Promise<number> {
  const db = await openReadingDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT count(*) n FROM para_html WHERE channel = ? AND book = ?",
    [channelId, book],
  );
  return row?.n ?? 0;
}

/** 该书该频道已缓存的段落号（下载时跳过已有的，即断点续传）。 */
export async function cachedParas(
  channelId: string,
  book: number,
  from: number,
  to: number,
): Promise<Set<number>> {
  const db = await openReadingDb();
  const rows = await db.getAllAsync<{ para: number }>(
    `SELECT para FROM para_html
      WHERE channel = ? AND book = ? AND para BETWEEN ? AND ?`,
    [channelId, book, from, to],
  );
  return new Set(rows.map((r) => r.para));
}

/**
 * 拉取并写入一个区间（下载用）。
 * 返回写入的段数 —— 空段也会写一行，所以就是区间长度。
 */
export async function storeParas(
  channelId: string,
  book: number,
  from: number,
  to: number,
): Promise<number> {
  await fetchAndStore(channelId, book, from, to);
  return to - from + 1;
}

/** 删除一本书某频道的全部缓存。 */
export async function clearBookCache(
  channelId: string,
  book: number,
): Promise<void> {
  const db = await openReadingDb();
  await db.runAsync("DELETE FROM para_html WHERE channel = ? AND book = ?", [
    channelId,
    book,
  ]);
  await db.runAsync(
    "DELETE FROM download_state WHERE channel = ? AND book = ?",
    [channelId, book],
  );
}

export interface CacheUsage {
  channel: string;
  book: number;
  paras: number;
  bytes: number;
  lastUsed: number;
  /** 是否为用户主动下载（主动下载的不参与 LRU 清理）。 */
  downloaded: boolean;
}

/** 按「频道 + 书」统计缓存占用，用于设置页展示与 LRU 清理。 */
export async function cacheUsage(): Promise<CacheUsage[]> {
  const db = await openReadingDb();
  const rows = await db.getAllAsync<{
    channel: string;
    book: number;
    paras: number;
    bytes: number;
    lastUsed: number;
    downloaded: number;
  }>(
    `SELECT p.channel, p.book,
            count(*) paras, sum(length(p.html)) bytes, max(p.fetched_at) lastUsed,
            (d.book IS NOT NULL) downloaded
       FROM para_html p
       LEFT JOIN download_state d
              ON d.channel = p.channel AND d.book = p.book AND d.status = 'done'
      GROUP BY p.channel, p.book`,
  );
  return rows.map((r) => ({ ...r, downloaded: !!r.downloaded }));
}

/**
 * 配额清理：只动被动缓存（`download_state` 里没有 `done` 记录的书），
 * 按最近使用时间从旧到新整本删除，直到降到配额以下。
 */
export async function enforceCacheQuota(
  quotaBytes = CACHE_QUOTA_BYTES,
): Promise<number> {
  const usage = await cacheUsage();
  let total = usage.reduce((s, u) => s + u.bytes, 0);
  if (total <= quotaBytes) return 0;

  const evictable = usage
    .filter((u) => !u.downloaded)
    .sort((a, b) => a.lastUsed - b.lastUsed);

  const db = await openReadingDb();
  let freed = 0;
  for (const u of evictable) {
    if (total <= quotaBytes) break;
    await db.runAsync("DELETE FROM para_html WHERE channel = ? AND book = ?", [
      u.channel,
      u.book,
    ]);
    total -= u.bytes;
    freed += u.bytes;
  }
  // SQLite 删数据后文件不会自动缩小
  if (freed > 0) await db.execAsync("VACUUM");
  return freed;
}
