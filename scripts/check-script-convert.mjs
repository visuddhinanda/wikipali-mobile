/**
 * 字体转换的等价性校验：本地 split/join 实现 vs 网页版逐条 `String.replace`。
 *
 * 用法：node scripts/check-script-convert.mjs
 *
 * 语料取本地离线目录库里的章节标题（`assets/db/tipitaka.db3`）抽样 400 条，
 * 没有则退回内置样例 —— 网页版实现一次转换要跑上千条正则，比对次数不能太多。逐字符比对，报告首个差异。
 *
 * 已知的**故意**差异，比对时跳过：
 * - `roman → roman`：网页版会把整段转成小写（它的 fromRoman 无条件 toLowerCase），
 *   本地保留大小写 —— 罗马巴利转罗马巴利只该归一鼻音符号，不该改词形；
 * - niggahita 选 `ŋ` 时 `ṅk`/`ṅg` 的处理，以及网页版大写分支的 `ṂK → ṄG` 笔误
 *   （见 convert.ts 的 normalizeNiggahita 注释），所以默认只比 `ṃ`/`ṁ` 两档，
 *   `--all` 把 `ŋ` 也比上（会报这些已知差异）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHARCODE = "/home/deploy/workspace/mint/api-v13/public/charcode";

/* ---------- 网页版实现（原样搬运，只把全局变量收进对象） ---------- */

function loadWebTables() {
  let src = "";
  for (const f of ["unicode.js", "sinhala.js", "myanmar.js", "tai_tham.js", "thai.js", "telugu.js"]) {
    src += fs.readFileSync(path.join(CHARCODE, f), "utf8") + "\n";
  }
  const names = [...src.matchAll(/var\s+(char_[A-Za-z0-9_]+)\s*=/g)].map((m) => m[1]);
  return new Function(`${src}\nreturn {${[...new Set(names)].join(",")}};`)();
}

const T = loadWebTables();

function webApplyMap(text, map) {
  for (let i = 0; i < map.length; i++) {
    text = text.replace(new RegExp(map[i].id, "g"), map[i].value);
  }
  return text;
}

function webNormalize(text, lower, upper) {
  const r = (a, b) => (text = text.replace(new RegExp(a, "g"), b));
  r("ṅk", lower + "k"); r("ṅg", lower + "g");
  r("ŋk", lower + "k"); r("ŋg", lower + "g");
  r("ŋ", lower); r("ṁ", lower); r("ṃ", lower);
  r("ṃk", "ṅk"); r("ṁk", "ṅk"); r("ṃg", "ṅg"); r("ṁg", "ṅg");
  r("ṄK", upper + "K"); r("ṄG", upper + "G");
  r("ŊK", upper + "K"); r("ŊG", upper + "G");
  r("Ŋ", upper); r("Ṁ", upper); r("Ṃ", upper);
  r("ṂK", "ṄG"); r("ṀK", "ṄG"); r("ṂG", "ṄG"); r("ṀG", "ṄG");
  return text;
}

function webToRoman(text, from, lower, upper) {
  switch (from) {
    case "sangayana": {
      const r = (a, b) => (text = text.replace(new RegExp(a, "g"), b));
      r("ïk", lower + "k"); r("ïg", lower + "g"); r("ü", lower); r("§", lower);
      r("ṃ", lower); r("ðK", upper + "K"); r("ðG", upper + "G"); r("ý", upper);
      return webApplyMap(text, T.char_sanga_to_unicode);
    }
    case "sinhala": return webNormalize(webApplyMap(text, T.char_si_to_unicode), lower, upper);
    case "myanmar": return webNormalize(webApplyMap(text, T.char_myn_to_roman_1), lower, upper);
    case "tai_tham": return webNormalize(webApplyMap(text, T.char_tai_to_roman), lower, upper);
    case "thai": return webNormalize(webApplyMap(text, T.char_thai_to_roman), lower, upper);
    case "tai_old": return webNormalize(webApplyMap(text, T.char_tai_old_to_r), lower, upper);
    default: return webNormalize(text, lower, upper);
  }
}

function webFromRoman(text, to, lower, upper) {
  text = text.toLowerCase();
  switch (to) {
    case "sangayana": return webApplyMap(" " + text, T.char_unicode_to_sanga);
    case "sinhala1": return webApplyMap(text, T.char_unicode_to_si_c);
    case "sinhala2": return webApplyMap(text, T.char_unicode_to_si_n);
    case "telugu": return webNormalize(webApplyMap(text, T.char_unicode_to_telugu), lower, upper);
    case "myanmar": return webNormalize(webApplyMap(text, T.char_roman_to_myn), lower, upper);
    case "tai_tham": return webNormalize(webApplyMap(text, T.char_roman_to_tai), lower, upper);
    case "thai": return webNormalize(webApplyMap(text, T.char_roman_to_thai), lower, upper);
    default: return webNormalize(text, lower, upper);
  }
}

const UPPER = { "ṃ": "Ṃ", "ṁ": "Ṁ", "ŋ": "Ŋ" };

function webConvert(text, from, to, n) {
  return webFromRoman(webToRoman(text, from, n, UPPER[n]), to, n, UPPER[n]);
}

/* ---------- 语料 ---------- */

const SAMPLE = [
  "Namo tassa bhagavato arahato sammāsambuddhassa.",
  "Evaṃ me sutaṃ – ekaṃ samayaṃ bhagavā sāvatthiyaṃ viharati jetavane anāthapiṇḍikassa ārāme.",
  "Aṅguttaranikāye Ekakanipātapāḷi. Saṅghaṃ saraṇaṃ gacchāmi.",
  "Idha, bhikkhave, bhikkhu kāye kāyānupassī viharati ātāpī sampajāno satimā.",
  "Buddhaṃ Dhammaṃ Saṅghaṃ. ĀĪŪ ṄÑṬḌṆḶ.",
];

function corpus() {
  const db = ["assets/db/tipitaka.db3", "assets/db/tipitaka.db"]
    .map((p) => path.join(ROOT, p))
    .find((p) => fs.existsSync(p));
  if (!db) return SAMPLE;
  try {
    const { DatabaseSync } = require("node:sqlite");
    const d = new DatabaseSync(db, { readonly: true });
    const rows = d
      .prepare("SELECT toc FROM pali_text WHERE toc IS NOT NULL AND toc <> '' LIMIT 400")
      .all();
    return rows.map((r) => r.toc).concat(SAMPLE);
  } catch {
    return SAMPLE;
  }
}

/* ---------- 比对 ---------- */

const { convertScript, SOURCE_SCRIPTS, TARGET_SCRIPTS } = require(
  path.join(ROOT, ".check-script-convert/convert.js"),
);

const niggahitas = process.argv.includes("--all") ? ["ṃ", "ṁ", "ŋ"] : ["ṃ", "ṁ"];
const texts = corpus();
console.log(`语料 ${texts.length} 条，niggahita ${niggahitas.join("/")}`);

let checked = 0;
let bad = 0;
for (const from of SOURCE_SCRIPTS) {
  for (const to of TARGET_SCRIPTS) {
    if (from === "roman" && to === "roman") continue; // 已知差异：大小写
    for (const n of niggahitas) {
      for (const text of texts) {
        const mine = convertScript(text, { from, to, niggahita: n });
        const web = webConvert(text, from, to, n);
        checked++;
        if (mine !== web) {
          bad++;
          if (bad <= 5) {
            console.log(`\n✗ ${from} → ${to} (${n})\n  输入: ${JSON.stringify(text.slice(0, 80))}\n  网页: ${JSON.stringify(web.slice(0, 80))}\n  本地: ${JSON.stringify(mine.slice(0, 80))}`);
          }
        }
      }
    }
  }
}
console.log(`\n比对 ${checked} 次，差异 ${bad} 次`);
process.exit(bad === 0 ? 0 : 1);
