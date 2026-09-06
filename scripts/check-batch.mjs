/**
 * 用真实离线库校验请求分批（docs/reading-content.md §4.6）。
 *
 *   node scripts/check-batch.mjs          # 全库分批统计
 *   node scripts/check-batch.mjs 24       # 某本书的分批明细（前 10 批）
 *
 * 跑的是 `src/reading/batch.ts` 里的 `planRanges`，与 App 同一份实现。
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(root, "assets/db/tipitaka.db3"), { readOnly: true });
const { planRanges, FETCH_BATCH_STRLEN, FETCH_BATCH_MAX_PARAS } = await import(
  join(root, "src/reading/batch.ts")
);

const books = db
  .prepare("SELECT DISTINCT book FROM pali_text ORDER BY book")
  .all()
  .map((r) => r.book);

/** 一本书的段落号与字符数。 */
function bookData(book) {
  const rows = db
    .prepare("SELECT paragraph, length FROM pali_text WHERE book = ? ORDER BY paragraph")
    .all(book);
  return {
    paras: rows.map((r) => r.paragraph),
    lengths: new Map(rows.map((r) => [r.paragraph, r.length ?? 0])),
  };
}

const sumOf = (lengths, from, to) => {
  let s = 0;
  for (let p = from; p <= to; p++) s += lengths.get(p) ?? 0;
  return s;
};

const arg = Number(process.argv[2]);

if (Number.isFinite(arg)) {
  const { paras, lengths } = bookData(arg);
  const ranges = planRanges(paras, lengths);
  console.log(`book ${arg}：${paras.length} 段 → ${ranges.length} 批`);
  for (const [from, to] of ranges.slice(0, 10)) {
    console.log(
      `  ${String(from).padStart(5)}-${String(to).padEnd(5)} ` +
        `${String(to - from + 1).padStart(4)} 段  ${String(sumOf(lengths, from, to)).padStart(6)} 字符`,
    );
  }
  if (ranges.length > 10) console.log(`  …… 还有 ${ranges.length - 10} 批`);
} else {
  console.log(`阈值：${FETCH_BATCH_STRLEN} 字符 / ${FETCH_BATCH_MAX_PARAS} 段（谁先到算谁）\n`);
  const sizes = [];
  const counts = [];
  const bad = [];
  let total = 0;

  for (const book of books) {
    const { paras, lengths } = bookData(book);
    const ranges = planRanges(paras, lengths);

    // 覆盖性：分批必须无空洞、无重叠地覆盖全部段落
    let expect = 0;
    for (const [from, to] of ranges) {
      if (paras[expect] !== from) bad.push(`book ${book} 批次起点 ${from} ≠ ${paras[expect]}`);
      expect += to - from + 1;
      sizes.push(sumOf(lengths, from, to));
      counts.push(to - from + 1);
      total++;
    }
    if (expect !== paras.length) {
      bad.push(`book ${book} 覆盖 ${expect} 段 ≠ 总数 ${paras.length}`);
    }
  }

  sizes.sort((a, b) => a - b);
  counts.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.floor(arr.length * p)];
  console.log(`全库批次 ${total}`);
  console.log(
    `每批字符  中位 ${q(sizes, 0.5)}  99% ${q(sizes, 0.99)}  最大 ${sizes[sizes.length - 1]}`,
  );
  console.log(
    `每批段数  中位 ${q(counts, 0.5)}  99% ${q(counts, 0.99)}  最大 ${counts[counts.length - 1]}`,
  );
  console.log(bad.length ? `✗ ${bad.length} 处异常:\n  ${bad.slice(0, 5).join("\n  ")}` : "✓ 覆盖完整、无空洞、无重叠");
}

db.close();
