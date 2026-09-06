/**
 * 用真实离线库校验阅读单元切分算法（docs/reading-content.md §3）。
 *
 *   node scripts/check-reading-unit.mjs           # 全库校验 + 内置样例
 *   node scripts/check-reading-unit.mjs 93 3      # 查指定起点，打印下沉过程
 *   node scripts/check-reading-unit.mjs 59        # 打印该书前 10 个单元
 *
 * 直接跑 TypeScript 源码里的算法：用 node:sqlite 提供 SqlRunner，
 * 避免脚本与 App 各写一份逻辑（同 scripts/check-commentary.mjs）。
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(root, "assets/db/tipitaka.db3"), { readOnly: true });

const mod = await import(join(root, "src/reading/unit.ts"));

const runner = {
  async all(sql, params) {
    return db.prepare(sql).all(...params);
  },
};

const books = db
  .prepare("SELECT DISTINCT book FROM pali_text ORDER BY book")
  .all()
  .map((r) => r.book);

const args = process.argv.slice(2).map(Number);

if (args.length >= 2) {
  await showUnit(args[0], args[1]);
} else if (args.length === 1) {
  await showBook(args[0], 10);
} else {
  await checkAll();
  for (const [book, para] of [[93, 3], [33, 2], [122, 3], [42, 400], [190, 3]]) {
    await showUnit(book, para);
  }
  await showBook(59, 4);
}

db.close();

/** 单个起点：打印区间与所在章节。 */
async function showUnit(book, para) {
  const u = await mod.readingUnit(runner, book, para);
  if (!u) {
    console.log(`\n(${book},${para}) 不存在`);
    return;
  }
  const row = db
    .prepare("SELECT level, toc, chapter_strlen FROM pali_text WHERE book=? AND paragraph=?")
    .get(book, para);
  console.log(
    `\n=== book ${book} 起点 ${para} (L${row.level} ${JSON.stringify(row.toc)}` +
      ` chapter_strlen=${row.chapter_strlen}) ===`,
  );
  console.log(
    `  [${u.mode}] 区间 ${u.from}-${u.to}，${u.to - u.from + 1} 段，${u.strlen} 字符` +
      (u.chapter ? `，停在 ${u.chapter.paragraph}(L${u.chapter.level}) ${JSON.stringify(u.chapter.toc)}` : ""),
  );
}

/** 一本书的前 n 个单元。 */
async function showBook(book, n) {
  const first = await mod.firstReadingParagraph(runner, book);
  if (first === null) {
    console.log(`\nbook ${book} 无章节行`);
    return;
  }
  console.log(`\n=== book ${book} 连续翻页（前 ${n} 个单元，起点 ${first}）===`);
  let u = await mod.readingUnit(runner, book, first);
  for (let i = 0; i < n && u; i++) {
    console.log(`  ${u.from}-${u.to}  ${String(u.strlen).padStart(6)} 字  [${u.mode}]`);
    u = await mod.nextReadingUnit(runner, u);
  }
}

/** 全库校验：从书首翻到书末，检查终止性、无倒挂、无空洞、无重叠。 */
async function checkAll() {
  let total = 0;
  let min = Infinity;
  let max = 0;
  const modes = {};
  const bad = [];
  let smallCount = 0;

  for (const book of books) {
    const first = await mod.firstReadingParagraph(runner, book);
    if (first === null) continue;
    const maxPara = db
      .prepare("SELECT max(paragraph) m FROM pali_text WHERE book=?")
      .get(book).m;

    const units = await mod.allReadingUnits(runner, book);
    if (units.length === 0) {
      bad.push(`book ${book} 没有算出任何单元`);
      continue;
    }
    if (units[0].from !== first) {
      bad.push(`book ${book} 首单元起点 ${units[0].from} ≠ ${first}`);
    }
    if (units[units.length - 1].to !== maxPara) {
      bad.push(`book ${book} 末单元 to=${units[units.length - 1].to} ≠ 书末 ${maxPara}`);
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.to < u.from) bad.push(`book ${book} 区间倒挂 ${u.from}-${u.to}`);
      if (i > 0 && units[i - 1].to + 1 !== u.from) {
        bad.push(`book ${book} 空洞/重叠 ${units[i - 1].to} → ${u.from}`);
      }
      total++;
      min = Math.min(min, u.strlen);
      max = Math.max(max, u.strlen);
      if (u.strlen < 800) smallCount++;
      modes[u.mode] = (modes[u.mode] ?? 0) + 1;
    }
  }

  console.log(`=== 全库校验（${books.length} 本）===`);
  console.log(`单元总数 ${total}，字符 ${min}~${max}，<800 字符 ${smallCount} 个`);
  console.log("模式分布", modes);
  console.log(
    bad.length
      ? `✗ ${bad.length} 处异常:\n  ` + bad.slice(0, 10).join("\n  ")
      : "✓ 全部终止、无倒挂、无空洞、无重叠、覆盖到书末",
  );
}
