/**
 * 从 mint/api-v13/public/charcode/*.js 生成 src/pali/script/tables/*.ts。
 *
 * 上游是浏览器全局变量写的 `var char_xxx = [{id,value},...]`，这里 eval 出来，
 * 转成紧凑的 `[id, value]` 二元组数组 —— 同样的数据，体积小一半，
 * 且构造 trie 时不用再读对象字段。
 *
 * 只搬 App 真正用到的表：中文读音表（37342 条 / 1.4 MB）不进移动端包。
 */
import fs from "node:fs";
import path from "node:path";

const SRC = "/home/deploy/workspace/mint/api-v13/public/charcode";
const OUT = new URL("../src/pali/script/tables/", import.meta.url).pathname;

/** 输出文件 → 需要的表名。 */
const FILES = {
  sangayana: { src: "unicode.js", maps: ["char_sanga_to_unicode", "char_unicode_to_sanga"] },
  sinhala: { src: "sinhala.js", maps: ["char_si_to_unicode", "char_unicode_to_si_c", "char_unicode_to_si_n"] },
  myanmar: { src: "myanmar.js", maps: ["char_roman_to_myn", "char_myn_to_roman_1"] },
  taiTham: { src: "tai_tham.js", maps: ["char_roman_to_tai", "char_tai_to_roman", "char_tai_old_to_r"] },
  thai: { src: "thai.js", maps: ["char_roman_to_thai", "char_thai_to_roman"] },
  telugu: { src: "telugu.js", maps: ["char_unicode_to_telugu"] },
};

function load(file) {
  const src = fs.readFileSync(path.join(SRC, file), "utf8");
  const sandbox = {};
  // 上游脚本是 `var x = [...]`，包一层函数后把全部 var 收集出来
  const names = [...src.matchAll(/var\s+(char_[A-Za-z0-9_]+)\s*=/g)].map((m) => m[1]);
  const fn = new Function(`${src}\nreturn {${names.join(",")}};`);
  Object.assign(sandbox, fn());
  return sandbox;
}

function camel(name) {
  return name.replace(/^char_/, "").replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

let total = 0;
for (const [out, { src, maps }] of Object.entries(FILES)) {
  const tables = load(src);
  const lines = [
    "// 本文件由 scripts/gen-script-tables.mjs 自动生成，请勿手改。",
    `// 数据来源：mint/api-v13/public/charcode/${src}`,
    'import type { CharMap } from "../types";',
    "",
  ];
  for (const name of maps) {
    const rows = tables[name];
    if (!Array.isArray(rows)) throw new Error(`${src} 里没有 ${name}`);
    total += rows.length;
    lines.push(`export const ${camel(name)}: CharMap = [`);
    for (const r of rows) {
      // 上游是 `new RegExp(id,'g')`，键里若有元字符就得当正则处理；
      // 实际全是字面量，App 端才敢用 split/join（见 src/pali/script/apply.ts）
      if (/[\\^$.|?*+()[\]{}]/.test(String(r.id))) {
        throw new Error(`${name} 的键 ${JSON.stringify(r.id)} 含正则元字符`);
      }
      lines.push(`  [${JSON.stringify(String(r.id))}, ${JSON.stringify(String(r.value))}],`);
    }
    lines.push("];", "");
  }
  fs.writeFileSync(path.join(OUT, `${out}.ts`), lines.join("\n"));
  console.log(out, maps.map((m) => tables[m].length).join("/"));
}
console.log("总条目", total);
