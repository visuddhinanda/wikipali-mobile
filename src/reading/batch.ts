/**
 * 请求分批：按**巴利文字符数**扫描段落，而不是按固定段数。
 *
 * 段落大小差别极大（全库最短几个字符，最长 30138 个字符），按固定段数分批
 * 会让批次体量在两个数量级之间摆动：200 段一批时，中位 24.6 K 字符，
 * 最坏一批 321 K 字符（书 24 段 201–400），HTML 接近 1 MB，
 * 必然撞上 `src/api/client.ts` 的 12 秒超时。
 *
 * 段落字符数 `pali_text.length` 本地就有，扫一遍即可自适应分批。
 */
import type { SqlRunner } from "../catalog/commentary";

/**
 * 单批目标字符数。达到即断批。
 *
 * 全库实测（30000 / 300 段）：批次 3682 个，字符中位 30143、99% 31593、
 * 最大 54037 —— 最大值 = 目标值 + 那个 30138 字符的单段，无法再切。
 */
export const FETCH_BATCH_STRLEN = 30_000;

/**
 * 单批段数上限。
 *
 * 字符数管不住段数：偈颂类的书一段只有几个字符，光按字符数会攒出 1700 段
 * 一批。服务端是 `foreach range()` **逐段查库**，段数才是它的成本，
 * 所以两个约束都要有，谁先到算谁。
 */
export const FETCH_BATCH_MAX_PARAS = 300;

/**
 * `length` 是**巴利原文**的字符数。译文频道的实际 HTML 体量与它不成正比，
 * 但这是本地唯一可得的体量代理，用来分批足够了 —— 目的是消掉数量级差异，
 * 不是精确预测响应大小。
 */
const lengthCache = new Map<number, Promise<Map<number, number>>>();

/** 一本书的段落字符数（按书缓存）。 */
export function paragraphLengths(
  sql: SqlRunner,
  book: number,
): Promise<Map<number, number>> {
  let p = lengthCache.get(book);
  if (!p) {
    p = (async () => {
      const rows = await sql.all<{ paragraph: number; length: number | null }>(
        "SELECT paragraph, length FROM pali_text WHERE book = ? ORDER BY paragraph",
        [book],
      );
      return new Map(rows.map((r) => [r.paragraph, r.length ?? 0]));
    })().catch((err) => {
      lengthCache.delete(book); // 失败不缓存，下次重试
      throw err;
    });
    lengthCache.set(book, p);
  }
  return p;
}

/**
 * 把段落号（升序）切成请求区间。
 *
 * 只合并**连续**的段落 —— 中间有缺口说明那些段已缓存，不必重取。
 * 断批条件：累计字符数达到 `FETCH_BATCH_STRLEN`，或段数达到
 * `FETCH_BATCH_MAX_PARAS`。单段超过阈值时自成一批（段落不可再分）。
 */
export function planRanges(
  paras: number[],
  lengths: Map<number, number>,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let from = -1;
  let prev = -1;
  let strlen = 0;
  let count = 0;

  const flush = () => {
    if (from >= 0) out.push([from, prev]);
    from = -1;
    strlen = 0;
    count = 0;
  };

  for (const p of paras) {
    // 不连续就断批：缺口里的段已在缓存里，没必要重新请求
    if (from >= 0 && p !== prev + 1) flush();
    if (from < 0) from = p;

    strlen += lengths.get(p) ?? 0;
    count++;
    prev = p;

    if (strlen >= FETCH_BATCH_STRLEN || count >= FETCH_BATCH_MAX_PARAS) {
      flush();
    }
  }
  flush();
  return out;
}

/** 便捷封装：先取该书的段落字符数，再分批。 */
export async function planBookRanges(
  sql: SqlRunner,
  book: number,
  paras: number[],
): Promise<Array<[number, number]>> {
  if (paras.length === 0) return [];
  return planRanges(paras, await paragraphLengths(sql, book));
}
