#!/usr/bin/env node
/**
 * 临时脚本：拉取 mint `book-title` 列表，提取 `data.rows`，生成内嵌书籍列表 JSON。
 *
 * 用法：
 *   node scripts/fetch-book-titles.mjs [baseUrl]
 *   # 默认 baseUrl = http://127.0.0.1:4000/api/v2
 *
 * 输出：src/catalog/book-titles.json
 *   每行只保留书籍列表所需的字段：book / paragraph / title / sn / toc / tags。
 *   （丢弃 id / created_at / updated_at / related_name 等运行时字段，减小 bundle 体积）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] ?? "http://127.0.0.1:4000/api/v2").replace(/\/+$/, "");
const url = `${base}/book-title`;

console.log(`GET ${url}`);
const res = await fetch(url, { headers: { Accept: "application/json" } });
if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);

const json = await res.json();
const rows = json?.data?.rows;
if (!Array.isArray(rows)) throw new Error("响应缺少 data.rows");

const keep = rows.map((r) => ({
  book: r.book,
  paragraph: r.paragraph,
  title: r.title,
  sn: r.sn,
  toc: r.toc,
  tags: r.tags ?? [],
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, "../src/catalog/book-titles.json");
fs.writeFileSync(out, JSON.stringify(keep, null, 2) + "\n", "utf8");
console.log(`written ${keep.length} rows -> ${out}`);
