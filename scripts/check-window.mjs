/**
 * 用真实离线库校验阅读窗口（lazy load 按巴利文字符数取段落）。
 *
 *   node scripts/check-window.mjs            # 全库校验
 *   node scripts/check-window.mjs 93 3       # 某本书、某锚点的窗口明细
 *
 * 跑的是 `src/reading/window.ts` 里的 `initialWindow` / `extendWindow` /
 * `windowStrlen`，与 App 同一份实现。
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(root, "assets/db/tipitaka.db3"), { readOnly: true });
const { initialWindow, extendWindow, windowStrlen, WINDOW_STRLEN } = await import(
  join(root, "src/reading/window.ts")
);

function bookData(book) {
  const rows = db
    .prepare("SELECT paragraph, length FROM pali_text WHERE book = ? ORDER BY paragraph")
    .all(book);
  return {
    lo: rows[0].paragraph,
    hi: rows[rows.length - 1].paragraph,
    lengths: new Map(rows.map((r) => [r.paragraph, r.length ?? 0])),
  };
}

const books = db
  .prepare("SELECT DISTINCT book FROM pali_text ORDER BY book")
  .all()
  .map((r) => r.book);

// 单书明细模式
if (process.argv[2] != null) {
  const book = Number(process.argv[2]);
  const anchor = process.argv[3] != null ? Number(process.argv[3]) : undefined;
  const { lo, hi, lengths } = bookData(book);
  const a = anchor ?? lo;
  const w = initialWindow(lengths, { lo, hi }, a, WINDOW_STRLEN);
  console.log(`book ${book} 段落 ${lo}..${hi}，锚点 ${a}`);
  console.log(
    `initialWindow [${w.from}, ${w.to}] 段数 ${w.to - w.from + 1} 字符 ${windowStrlen(lengths, w.from, w.to)}`,
  );
  // 从初始窗口连续向下翻到底
  let win = w;
  let n = 0;
  while (win.to < hi) {
    const next = extendWindow(lengths, { lo, hi }, win, "down", WINDOW_STRLEN);
    n++;
    console.log(
      `  down ${n}: [${win.to + 1}, ${next.to}] +${windowStrlen(lengths, win.to + 1, next.to)} 字符 (${next.to - win.to} 段)`,
    );
    win = next;
  }
  process.exit(0);
}

// 全库校验：初始窗口 + 单方向连续扩展，必须无空洞、无重叠、终止于书末
let fail = 0;
let maxInitStr = 0;
let maxInitBook = 0;
for (const book of books) {
  const { lo, hi, lengths } = bookData(book);

  // 初始窗口覆盖锚点、不越界
  for (const anchor of [lo, Math.floor((lo + hi) / 2), hi]) {
    const w = initialWindow(lengths, { lo, hi }, anchor, WINDOW_STRLEN);
    if (w.from < lo || w.to > hi || w.from > anchor || w.to < anchor) {
      console.error(`✗ book ${book} anchor ${anchor}: 越界/不含锚点 ${JSON.stringify(w)}`);
      fail++;
    }
    if (anchor === lo) {
      const s = windowStrlen(lengths, w.from, w.to);
      if (s > maxInitStr) {
        maxInitStr = s;
        maxInitBook = book;
      }
    }
  }

  // 向下翻到底：连续、覆盖到 hi、终止
  let win = initialWindow(lengths, { lo, hi }, lo, WINDOW_STRLEN);
  let guard = 0;
  while (win.to < hi) {
    const next = extendWindow(lengths, { lo, hi }, win, "down", WINDOW_STRLEN);
    if (next.to <= win.to || next.from !== win.from) {
      console.error(`✗ book ${book}: down 扩展不动 ${JSON.stringify(win)} → ${JSON.stringify(next)}`);
      fail++;
      break;
    }
    win = next;
    if (++guard > 1_000_000) {
      console.error(`✗ book ${book}: down 扩展死循环`);
      fail++;
      break;
    }
  }
  if (win.to !== hi) {
    console.error(`✗ book ${book}: down 未覆盖到书末 ${win.to}/${hi}`);
    fail++;
  }

  // 向上翻到书首
  win = initialWindow(lengths, { lo, hi }, hi, WINDOW_STRLEN);
  guard = 0;
  while (win.from > lo) {
    const next = extendWindow(lengths, { lo, hi }, win, "up", WINDOW_STRLEN);
    if (next.from >= win.from || next.to !== win.to) {
      console.error(`✗ book ${book}: up 扩展不动 ${JSON.stringify(win)} → ${JSON.stringify(next)}`);
      fail++;
      break;
    }
    win = next;
    if (++guard > 1_000_000) {
      console.error(`✗ book ${book}: up 扩展死循环`);
      fail++;
      break;
    }
  }
  if (win.from !== lo) {
    console.error(`✗ book ${book}: up 未覆盖到书首 ${win.from}/${lo}`);
    fail++;
  }
}

console.log(`全库 ${books.length} 本书校验完成，${fail === 0 ? "✓ 全部通过" : `✗ ${fail} 处失败`}`);
console.log(`初始窗口最大字符数 ${maxInitStr}（书 ${maxInitBook}，含超长单段时偏大）`);
console.log(`目标每方向 ${WINDOW_STRLEN} 字符`);
process.exit(fail === 0 ? 0 : 1);
