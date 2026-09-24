/**
 * 正文缓存（见 `docs/reading-content.md` §4）。
 *
 * 按**段落**存，不按区间存：阈值可调，用户从目录 / 上一章 / 书签等不同入口
 * 进入同一片正文，产生的区间互相重叠 —— 段落是唯一稳定的复用单位。
 *
 * 取数走新版 `/v3/tipitaka-reading/{channel}`（见 `docs/reading-content.md` §2）：
 * - 阅读补缺口用 `para`/`to` 区间过滤（`fetchReadParas`）——按段号随机定位，
 *   区间内没回来的段就是「该版本没译」，记 `html = NULL` + 过期时间；
 * - 下载用 `book` + 游标（`fetchReadChapter`）顺序推进，分母取 `meta.total`。
 */
import {
  CHAPTER_PAGE_UNIT,
  DOWNLOAD_PAGE_SIZE,
  fetchReadChapter,
} from "../api/read-chapter";
import { fetchReadParas, type ReadParaItem } from "../api/read-para";
import { mockReadParas } from "../api/mock";
import { openReadingDb, withReadingTransaction } from "./db";

/** 被动缓存配额：超过后按 LRU 清理未被主动下载的书（§4.5）。 */
export const CACHE_QUOTA_BYTES = 200 * 1024 * 1024;

/**
 * 空段占位的过期时间：服务端「没有这一段」时写空记录，只缓存 48 小时。
 * 过期后若联网则重新请求（该版本可能后来补上了译文）；未过期则不重复请求。
 */
export const EMPTY_PARA_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * 单次补缺口最多取多少块，防御服务端游标不推进时空转。
 *
 * 正常情况下一个阅读窗口（3000 字符）只要 1–2 块；这个上限只在数据异常时
 * 兜底，正常路径永远碰不到。
 */
const MAX_BLOCKS_PER_FILL = 64;

/** 批量 INSERT 的单条语句行数，见 `storeCovered`。 */
const SQL_INSERT_ROWS = 150;

export interface CachedPara {
  para: number;
  /** 该版本没有这一段的译文时为 null；有正文则存 HTML。 */
  html: string | null;
  /** 空段占位的过期时间（epoch ms）；非空正文为 null（永不过期）。 */
  expires_at: number | null;
}

/** 缓存行是否仍然有效：非空正文永不过期，空段占位看过期时间。 */
function isValid(row: Pick<CachedPara, "html" | "expires_at">, now: number): boolean {
  return row.html != null || (row.expires_at != null && row.expires_at > now);
}

/** 查缓存：返回该区间已缓存的段（含 `html IS NULL` 的空段记录）。 */
export async function readCachedParas(
  channelId: string,
  book: number,
  from: number,
  to: number,
): Promise<CachedPara[]> {
  const db = await openReadingDb();
  return db.getAllAsync<CachedPara>(
    `SELECT para, html, expires_at FROM para_html
      WHERE channel = ? AND book = ? AND para BETWEEN ? AND ?
      ORDER BY para`,
    [channelId, book, from, to],
  );
}

/**
 * 把一个**已确认覆盖**的段落区间写回缓存。
 *
 * `items` 里有的段写 HTML（永不过期），区间里其余的段写 `html = NULL` +
 * 过期时间 —— 它们是服务端明说「这一块覆盖到了、但没有内容」的段，
 * 不记下来的话每次进这一片都要重新请求。但「没有」不一定是永久的：
 * 该版本后续可能补上，所以给空段一个 48 小时的过期时间。
 */
async function storeCovered(
  channelId: string,
  book: number,
  from: number,
  to: number,
  items: ReadParaItem[],
): Promise<Map<number, string>> {
  const byPara = new Map<number, string>();
  for (const item of items) {
    if (item.display) byPara.set(item.para, item.display);
  }

  const now = Date.now();
  const expires = now + EMPTY_PARA_TTL_MS;
  await withReadingTransaction(async (db) => {
    // 整章没有译文时这一批可达一万多段（最长的章节 15943 段），逐段一条
    // runAsync 光过桥就要好几秒 —— 拼成多值 INSERT 批量写。每条 6 个占位符，
    // 150 行 = 900 个参数，留在 SQLite 默认 999 的上限之内。
    for (let base = from; base <= to; base += SQL_INSERT_ROWS) {
      const last = Math.min(base + SQL_INSERT_ROWS - 1, to);
      const params: (string | number | null)[] = [];
      for (let p = base; p <= last; p++) {
        const html = byPara.get(p) ?? null;
        params.push(channelId, book, p, html, now, html ? null : expires);
      }
      const values = Array.from({ length: last - base + 1 }, () => "(?,?,?,?,?,?)");
      await db.runAsync(
        `INSERT OR REPLACE INTO para_html
           (channel, book, para, html, fetched_at, expires_at)
         VALUES ${values.join(",")}`,
        params,
      );
    }
  });

  return byPara;
}

/**
 * 用区间接口补一个缺口 `[from, to]`：按游标一块块取，每块写回缓存。
 *
 * 返回该区间的 `para → html`（空段为 ""）；离线返回 `mock: true`（不写盘）。
 * 区间超过一页时用 `next_cursor` 续传，取完或 `next_cursor` 为 null 即停。
 */
async function fillGap(
  channelId: string,
  book: number,
  from: number,
  to: number,
): Promise<{ map: Map<number, string>; mock: boolean }> {
  const map = new Map<number, string>();
  let nextFrom = from;
  let after: string | null = null;
  // exhausted：服务端明说「区间取完了」（next_cursor 为 null 或空结果），
  // 剩下的段才敢整段记空。兜底上限触达时不算取完，不记空 —— 那会被缓存层
  // 写成「确认无内容」，下次进来看不到本该有的正文。
  let exhausted = false;
  for (let n = 0; n < MAX_BLOCKS_PER_FILL; n++) {
    const { items, mock, nextCursor } = await fetchReadParas(
      book,
      from,
      to,
      channelId,
      { after, pageSize: DOWNLOAD_PAGE_SIZE, unit: CHAPTER_PAGE_UNIT },
    );
    if (mock) return { map, mock: true };
    if (items.length === 0) {
      exhausted = true;
      break;
    }

    const lastPara = items[items.length - 1].para;
    // 覆盖区间 [nextFrom, lastPara]：items 里的段写正文；两条有译文段之间的
    // 空档记 NULL —— 服务端按段号升序回，两条之间不会再有译文。
    await storeCovered(channelId, book, nextFrom, lastPara, items);
    for (let p = nextFrom; p <= lastPara; p++) map.set(p, "");
    for (const item of items) {
      if (item.display) map.set(item.para, item.display);
    }
    nextFrom = lastPara + 1;
    if (!nextCursor) {
      exhausted = true;
      break;
    }
    after = nextCursor;
  }
  // 区间确认取完：剩下的 [nextFrom, to] 一段译文都没有。
  if (exhausted && nextFrom <= to) {
    await storeCovered(channelId, book, nextFrom, to, []);
    for (let p = nextFrom; p <= to; p++) map.set(p, "");
  }
  return { map, mock: false };
}

/**
 * 取一个区间的正文：查缓存 → 只补缺口，返回 `para → html` 的 Map。
 *
 * 命中规则（`html IS NULL` 的空段占位）：
 * - 非空正文 → 永不过期，直接命中；
 * - 空段占位且在 48 小时过期时间内 → 命中，不重复请求；
 * - 空段占位且已过期（或旧数据无过期时间）→ 视为缺失，重新走网络。
 *
 * 空段在返回的 Map 里值为空串，拼接时由调用方跳过。
 */
export async function loadParasMap(
  channelId: string,
  book: number,
  from: number,
  to: number,
): Promise<Map<number, string>> {
  const cached = await readCachedParas(channelId, book, from, to);
  const now = Date.now();
  const byPara = new Map<number, string>();
  for (const r of cached) {
    if (isValid(r, now)) byPara.set(r.para, r.html ?? "");
  }

  let p = from;
  while (p <= to) {
    if (byPara.has(p)) {
      p += 1;
      continue;
    }
    // 找连续缺口 [p, gapEnd]，一次区间取数补齐。
    let q = p;
    while (q <= to && !byPara.has(q)) q += 1;
    const gapEnd = q - 1;
    const { map, mock } = await fillGap(channelId, book, p, gapEnd);
    if (mock) {
      // 离线：占位文只用于当次显示，不写盘 —— 否则会冒充真经永久留在缓存里。
      for (const item of await mockReadParas(book, p, gapEnd)) {
        byPara.set(item.para, item.display);
      }
      return byPara;
    }
    for (const [para, html] of map) byPara.set(para, html);
    p = gapEnd + 1;
  }

  return byPara;
}

/**
 * 取**精确一段**的正文（AI 回答里的引文角标用）：查缓存 → 缺了就联网取这一段。
 * 该版本没有这一段、或离线取不到，返回 null。
 *
 * 走区间接口（`fetchReadParas`）而不是游标接口：游标会**顺延到下一段有译文的**，
 * 问「9102-7」可能回 9102-350。引文要的是「这一段，有就是有、没有就是没有」，
 * 只能用不顺延的那个口子。
 *
 * 写回规则与阅读完全一致（有正文写 HTML、没有写 NULL + 过期时间），缓存因此
 * 是共用的：读过的段点角标不再联网，点过角标的段进阅读器也直接命中。
 */
export async function loadOnePara(
  channelId: string,
  book: number,
  para: number,
): Promise<string | null> {
  const cached = await readCachedParas(channelId, book, para, para);
  const row = cached[0];
  if (row && isValid(row, Date.now())) return row.html;

  const { items, mock } = await fetchReadParas(book, para, para, channelId);
  // 离线占位文既不写盘、也不冒充真经显示出去
  if (mock) return null;
  return (await storeCovered(channelId, book, para, para, items)).get(para) ?? null;
}

/**
 * 从 `from` 起找第一个有正文的段落号；到 `hi` 为止都没有内容（或离线）返回 null。
 *
 * 用于「点开书什么都看不到」：译文残缺的版本前面整段没有内容，窗口停在书首
 * 只会看到一串标题。阅读器据此把窗口挪到真有正文的地方。
 *
 * 直接用 `page_size=1` 让服务端回该区间最小段号的有译文段，一次取到目标。
 */
export async function findFirstContent(
  channelId: string,
  book: number,
  from: number,
  hi: number,
): Promise<number | null> {
  const scan = await scanCached(channelId, book, from, hi);
  // 缓存里从 from 起连续解析过的那一段就有正文 → 不必联网
  if (scan.content != null) return scan.content;
  if (scan.gap == null) return null; // 到 hi 为止都解析过且都没有正文
  const p = scan.gap;

  const { items, mock } = await fetchReadParas(book, p, hi, channelId, {
    pageSize: 1,
    unit: "para",
  });
  if (mock) return null;
  if (items.length === 0) {
    // 该区间一段译文都没有，整段记空，下次不再重问。
    await storeCovered(channelId, book, p, hi, []);
    return null;
  }
  const first = items[0];
  await storeCovered(channelId, book, p, first.para, items);
  return first.para;
}

/**
 * 从 `from` 起扫一遍缓存：`content` 是连续已解析区间里第一个有正文的段，
 * `gap` 是第一个没解析过（或已过期）的段。两者都为 null 表示 `[from, hi]`
 * 全部解析过且全是空段。
 */
async function scanCached(
  channelId: string,
  book: number,
  from: number,
  hi: number,
): Promise<{ content: number | null; gap: number | null }> {
  const db = await openReadingDb();
  const now = Date.now();
  // 只取仍然有效的行，段号升序；`has` 是「这一段有正文」。一次最多扫这么多行，
  // 扫满了还没遇到缺口就当缺口在末尾，下一轮接着扫。
  const rows = await db.getAllAsync<{ para: number; has: number }>(
    `SELECT para, (html IS NOT NULL) AS has FROM para_html
      WHERE channel = ? AND book = ? AND para BETWEEN ? AND ?
        AND (html IS NOT NULL OR expires_at > ?)
      ORDER BY para LIMIT 5000`,
    [channelId, book, from, hi, now],
  );

  let expected = from;
  for (const row of rows) {
    if (row.para !== expected) return { content: null, gap: expected };
    if (row.has) return { content: row.para, gap: null };
    expected = row.para + 1;
  }
  return { content: null, gap: expected > hi ? null : expected };
}

/**
 * 取一个阅读单元的正文 HTML：查缓存 → 只补缺口 → 按段落号升序拼接。
 *
 * 空段（`html IS NULL`）不参与拼接。
 */
export async function loadParaHtml(
  channelId: string,
  book: number,
  from: number,
  to: number,
): Promise<string> {
  const byPara = await loadParasMap(channelId, book, from, to);
  const parts: string[] = [];
  for (let p = from; p <= to; p++) {
    const html = byPara.get(p);
    if (html) parts.push(html);
  }
  return parts.join("\n");
}

/**
 * 已缓存到**有正文**的段数（下载进度的分子，§4.4）。
 *
 * 只数非空段：空段记录的是「该版本没译这一段」，把它算进已下载会让进度条
 * 反映「扫过多少段」而不是「下到多少内容」——译文残缺的版本会瞬间冲到 90%
 * 再原地不动。
 */
export async function cachedParaCount(
  channelId: string,
  book: number,
): Promise<number> {
  const db = await openReadingDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT count(html) n FROM para_html WHERE channel = ? AND book = ?",
    [channelId, book],
  );
  return row?.n ?? 0;
}

/**
 * 下载用：按游标取一块并写回缓存，返回下一块游标与分母。
 * 离线返回 null（调用方当作一次失败）。
 */
export async function fetchChapterBlock(
  channelId: string,
  book: number,
  after: string | null,
  pageSize?: number,
  unit?: "para" | "byte",
): Promise<{ nextCursor: string | null; total?: number } | null> {
  const outcome = await fetchReadChapter(book, channelId, after, {
    pageSize,
    unit,
  });
  if (outcome.status === "offline") return null;
  if (outcome.status === "empty") return { nextCursor: null };

  const block = outcome.block;
  if (block.items.length > 0) {
    // 只写 items 的正文与它们之间的空档；块外（书首到首条、末条到书尾）的
    // 空段不在这里记，留给阅读路径按需补齐。
    await storeCovered(
      channelId,
      book,
      block.items[0].para,
      block.items[block.items.length - 1].para,
      block.items,
    );
  }
  return { nextCursor: block.nextCursor, total: block.total };
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
            count(p.html) paras, sum(length(p.html)) bytes, max(p.fetched_at) lastUsed,
            (d.book IS NOT NULL) downloaded
       FROM para_html p
       LEFT JOIN download_state d
              ON d.channel = p.channel AND d.book = p.book AND d.status = 'done'
      GROUP BY p.channel, p.book`,
  );
  return rows.map((r) => ({ ...r, bytes: r.bytes ?? 0, downloaded: !!r.downloaded }));
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

/** 记住版本 uid 对应的显示名（离线选版本、离线显示名字都要用）。 */
export async function rememberChannelName(
  channelUid: string,
  name: string,
): Promise<void> {
  if (!channelUid || !name) return;
  const db = await openReadingDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO channels (uid, name) VALUES (?, ?)",
    [channelUid, name],
  );
}

export interface LocalChannel {
  channelId: string;
  name: string | null;
  /** 该版本在本书已缓存到**有正文**的段数。 */
  cached: number;
  /** 是否是用户显式下载的（而不是阅读时被动缓存的）。 */
  downloaded: boolean;
}

/**
 * 本书在本地已有内容的版本，按「下载过的优先、缓存段数多的优先」排。
 *
 * 用途：滑到义注/复注层时先看本地有什么，别一律等接口再挑 —— 那样既会
 * 挑到本地没数据的版本（于是转圈联网），也让已下载的书白白等一次网络。
 *
 * 数的是**有正文**的段（`count(html)`）而不是行数：空段记录同样占一行，
 * 按行数排会把「扫过一遍但一段没译」的版本排到前面。同理，一段正文都没有的
 * 版本直接不算「本地有内容」。
 */
export async function localChannelsFor(book: number): Promise<LocalChannel[]> {
  const db = await openReadingDb();
  const rows = await db.getAllAsync<{
    channel: string;
    name: string | null;
    cached: number;
    downloaded: number;
  }>(
    `SELECT c.channel,
            n.name                          AS name,
            c.cached                        AS cached,
            CASE WHEN d.channel IS NULL THEN 0 ELSE 1 END AS downloaded
       FROM (SELECT channel, COUNT(html) AS cached
               FROM para_html WHERE book = ? GROUP BY channel
             HAVING COUNT(html) > 0) c
       LEFT JOIN channels n ON n.uid = c.channel
       LEFT JOIN download_state d
               ON d.channel = c.channel AND d.book = ? AND d.done > 0
      ORDER BY downloaded DESC, cached DESC`,
    [book, book],
  );
  return rows.map((r) => ({
    channelId: r.channel,
    name: r.name,
    cached: r.cached,
    downloaded: r.downloaded === 1,
  }));
}

/** 批量查版本显示名（uid → name）；没见过的 uid 不会出现在结果里。 */
export async function channelNames(
  uids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(uids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const db = await openReadingDb();
  const rows = await db.getAllAsync<{ uid: string; name: string }>(
    `SELECT uid, name FROM channels WHERE uid IN (${unique.map(() => "?").join(",")})`,
    unique,
  );
  return new Map(rows.map((r) => [r.uid, r.name]));
}
