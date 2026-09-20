/**
 * 阅读窗口：按巴利文字符数滑动的段落窗口（lazy load / 虚拟化）。
 *
 * 现有链路是「一次加载整个阅读单元（章节）」——`ReaderLayerPane` 把单元内
 * 全部段落拼成一份 HTML 灌进 WebView，滚动由 WebView 自己完成，没有「滚动到
 * 底部再加载 n 段、移出屏幕就卸载」的能力（见 `docs/reading-content.md`）。
 *
 * 本模块把「一次加载多少段」从「整单元」细化成「一个按字符数算的窗口」：
 * - 初始窗口：以锚点段为起点，向下取约 `WINDOW_STRLEN` 个巴利文字符的段落；
 *   贴到书尾仍不足时，再向上补足。
 * - `extendWindow`：向 `down` / `up` 各扩约 `WINDOW_STRLEN` 字符的新段落。
 *
 * 窗口覆盖的是**整本书的段落流**（跨阅读单元/章节边界）——滚动是连续的，
 * 章节只是「当前锚点所属单元」这一概念，由上层在窗口顶部段跨入新单元时更新。
 *
 * 段落不可再分，所以窗口边界取到「累计字符数首次 ≥ 目标值」的那一段；
 * 单个超大段落（全库最长 30138 字符）会自成一段进入窗口，与
 * `src/reading/batch.ts` 的分批语义一致。
 */
import type { SqlRunner } from "../catalog/commentary";

/** 单次向一个方向扩展的目标巴利文字符数（用户指定，如 3000）。 */
export const WINDOW_STRLEN = 3000;

export interface ParaWindow {
  /** 窗口起始段（含）。 */
  from: number;
  /** 窗口结束段（含）。 */
  to: number;
}

export interface BookBounds {
  lo: number;
  hi: number;
}

/** `[from, to]` 区间的巴利文字符数。 */
export function windowStrlen(
  lengths: Map<number, number>,
  from: number,
  to: number,
): number {
  let s = 0;
  for (let p = from; p <= to; p++) s += lengths.get(p) ?? 0;
  return s;
}

/**
 * 向一个方向扩展窗口，新增约 `target` 个巴利文字符的段落。
 *
 * `down` 只向后推进 `to`，`up` 只向前推进 `from`；到书边界为止。
 * 返回新窗口（不修改入参）。
 */
export function extendWindow(
  lengths: Map<number, number>,
  bounds: BookBounds,
  win: ParaWindow,
  dir: "down" | "up",
  target = WINDOW_STRLEN,
): ParaWindow {
  if (dir === "down") {
    let to = win.to;
    let s = 0;
    while (to < bounds.hi && s < target) {
      to += 1;
      s += lengths.get(to) ?? 0;
    }
    return { from: win.from, to };
  }
  let from = win.from;
  let s = 0;
  while (from > bounds.lo && s < target) {
    from -= 1;
    s += lengths.get(from) ?? 0;
  }
  return { from, to: win.to };
}

/**
 * 以 `anchor` 为起点的初始窗口：向下取约 `target` 字符；贴到书尾不足时再
 * 向上补足。`anchor` 会被夹到书的段落范围内。
 */
export function initialWindow(
  lengths: Map<number, number>,
  bounds: BookBounds,
  anchor: number,
  target = WINDOW_STRLEN,
): ParaWindow {
  const a = Math.max(bounds.lo, Math.min(bounds.hi, anchor));
  const down = extendWindow(lengths, bounds, { from: a, to: a }, "down", target);
  if (windowStrlen(lengths, down.from, down.to) < target && down.from > bounds.lo) {
    return extendWindow(lengths, bounds, down, "up", target);
  }
  return down;
}

/** 一本书的段落号范围（`min..max`；全库段落号连续，已校验）。 */
export async function bookBounds(
  sql: SqlRunner,
  book: number,
): Promise<BookBounds | null> {
  const rows = await sql.all<{ lo: number; hi: number }>(
    "SELECT min(paragraph) lo, max(paragraph) hi FROM pali_text WHERE book = ?",
    [book],
  );
  const r = rows[0];
  return r && r.lo != null ? { lo: r.lo, hi: r.hi } : null;
}
