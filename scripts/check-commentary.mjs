/**
 * 用真实离线库校验注释层次算法（docs/commentary-layers.md）。
 *
 *   node scripts/check-commentary.mjs            # 跑内置样例
 *   node scripts/check-commentary.mjs 98 1969    # 查指定章节
 *
 * 直接跑 TypeScript 源码里的算法：用 node:sqlite 提供 SqlRunner，
 * 避免脚本与 App 各写一份逻辑。
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(root, "assets/db/tipitaka.db3"), { readOnly: true });

// Node 24 原生支持类型剥离，直接 import TS 源码，保证校验的是同一份实现
const mod = await import(join(root, "src/catalog/commentary.ts"));

const runner = {
  async all(sql, params) {
    return db.prepare(sql).all(...params);
  },
};

const args = process.argv.slice(2);
const cases = args.length >= 2
  ? [[Number(args[0]), Number(args[1])]]
  : [[69, 2835], [98, 1969], [174, 1111], [1, 159], [88, 1616]];

for (const [book, paragraph] of cases) {
  const self = db
    .prepare("SELECT book, paragraph, toc, level, parent, tags, book_name, cs_para FROM pali_text WHERE book=? AND paragraph=?")
    .get(book, paragraph);
  if (!self) {
    console.log(`(${book},${paragraph}) 不存在`);
    continue;
  }
  const own = await mod.resolveLayer(runner, book, paragraph);
  const coord = await mod.chapterCoordinate(runner, self);
  console.log(
    `\n=== (${book},${paragraph}) level=${self.level} ${JSON.stringify(self.toc)}` +
      `  自身坐标=${self.book_name}/${self.cs_para}` +
      `  查询坐标=${coord ? `${coord.book_name}/${coord.cs_para}` : "无"}` +
      `  层次=${own ? mod.LAYER_LABEL[own.layer] : "未知"}` +
      (own ? `（据 ${own.source.book}:${own.source.paragraph} ${JSON.stringify(own.source.toc)}）` : ""),
  );
  const related = await mod.findRelatedChapters(runner, book, paragraph);
  if (!related.length) {
    console.log("  无对应章节");
    continue;
  }
  for (const r of related) {
    console.log(
      `  ${(r.layerLabel ?? "未知").padEnd(5)} book=${String(r.book).padStart(3)} ` +
        `para=${String(r.paragraph).padStart(5)} level=${r.level} ${JSON.stringify(r.toc)}`,
    );
  }
}
db.close();
