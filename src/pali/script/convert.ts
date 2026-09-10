/**
 * 巴利文字体（script）转换。
 *
 * 与网页版 `library/tools/script-convertor` 同一套转换表和同一条流水线：
 * **任何输入先归一到罗马巴利，再从罗马巴利转到目标字体**，所以 N 种字体
 * 只需要 2N 张表而不是 N² 张。
 *
 * 表由 `scripts/gen-script-tables.mjs` 从网页版的 charcode/*.js 生成；
 * 中文读音（37342 条 / 1.4 MB）不进移动端包，工具页也不提供该选项。
 */
import { applyMap } from "./apply";
import { sangaToUnicode, unicodeToSanga } from "./tables/sangayana";
import { siToUnicode, unicodeToSiC, unicodeToSiN } from "./tables/sinhala";
import { romanToMyn, mynToRoman1 } from "./tables/myanmar";
import { romanToTai, taiToRoman, taiOldToR } from "./tables/taiTham";
import { romanToThai, thaiToRoman } from "./tables/thai";
import { unicodeToTelugu } from "./tables/telugu";

/** 可作为输入的字体。 */
export type SourceScript =
  | "roman"
  | "sangayana"
  | "sinhala"
  | "myanmar"
  | "tai_tham"
  | "thai"
  | "tai_old";

/** 可作为输出的字体。锡兰文分传统 / 现代两种正字法。 */
export type TargetScript =
  | "roman"
  | "sangayana"
  | "sinhala1"
  | "sinhala2"
  | "telugu"
  | "myanmar"
  | "tai_tham"
  | "thai";

export const SOURCE_SCRIPTS: readonly SourceScript[] = [
  "roman",
  "sangayana",
  "sinhala",
  "myanmar",
  "tai_tham",
  "thai",
  "tai_old",
];

export const TARGET_SCRIPTS: readonly TargetScript[] = [
  "roman",
  "sangayana",
  "sinhala1",
  "sinhala2",
  "telugu",
  "myanmar",
  "tai_tham",
  "thai",
];

/**
 * 罗马巴利里鼻音符号（niggahita）的写法，三家并行且都在用：
 * `ṃ`（VRI / 缅甸）、`ṁ`（PTS）、`ŋ`（旧式）。转换时统一成所选的那个。
 */
export type Niggahita = "ṃ" | "ṁ" | "ŋ";

export const NIGGAHITA_OPTIONS: readonly Niggahita[] = ["ṃ", "ṁ", "ŋ"];

export const DEFAULT_NIGGAHITA: Niggahita = "ṃ";

const NIGGAHITA_UPPER: Record<Niggahita, string> = {
  "ṃ": "Ṃ",
  "ṁ": "Ṁ",
  "ŋ": "Ŋ",
};

/**
 * 归一鼻音符号。
 *
 * `ṅk` / `ṅg`（软腭鼻音后接软腭塞音）保持 `ṅ` 不动 —— 这是拼写惯例，
 * 不是 niggahita 的另一种写法，换成 `ṃ` 会改掉词形。
 *
 * 规则分两步：先把 `ŋk`/`ṃk`/`ṁk` 一类的软腭音簇统一写回 `ṅ`，再把剩下的
 * 鼻音符号统一成所选写法。顺序不能反，否则第二步会先把 `ṃk` 里的 `ṃ` 换掉。
 *
 * 两处与网页版**故意**不同（都是它逐条替换的顺序造成的，见
 * `scripts/check-script-convert.mjs`）：
 * - 选 `ŋ` 时网页版会把 `ṅk` 一并写成 `ŋk`，这里仍保持 `ṅk`，与选 `ṃ`/`ṁ` 一致；
 * - 网页版大写分支把 `ṂK`/`ṀK` 写成了 `ṄG`（应为 `ṄK`），这里改对。
 */
function normalizeNiggahita(text: string, n: Niggahita): string {
  const upper = NIGGAHITA_UPPER[n];
  return applyMap(text, [
    ["ŋk", "ṅk"],
    ["ŋg", "ṅg"],
    ["ṃk", "ṅk"],
    ["ṁk", "ṅk"],
    ["ṃg", "ṅg"],
    ["ṁg", "ṅg"],
    ["ŊK", "ṄK"],
    ["ŊG", "ṄG"],
    ["ṂK", "ṄK"],
    ["ṀK", "ṄK"],
    ["ṂG", "ṄG"],
    ["ṀG", "ṄG"],
    ["ŋ", n],
    ["ṁ", n],
    ["ṃ", n],
    ["Ŋ", upper],
    ["Ṁ", upper],
    ["Ṃ", upper],
  ]);
}

/** Sangayana（VRI 的自造 8-bit 编码）→ 罗马巴利。 */
function sangayanaToRoman(text: string, n: Niggahita): string {
  const upper = NIGGAHITA_UPPER[n];
  // 先处理 sangayana 自己的鼻音写法，再套字符表
  const pre = applyMap(text, [
    ["ïk", `${n}k`],
    ["ïg", `${n}g`],
    ["ü", n],
    ["§", n],
    ["ṃ", n],
    ["ðK", `${upper}K`],
    ["ðG", `${upper}G`],
    ["ý", upper],
  ]);
  return applyMap(pre, sangaToUnicode);
}

/** 任意字体 → 罗马巴利。 */
export function toRoman(text: string, from: SourceScript, n: Niggahita): string {
  switch (from) {
    case "sangayana":
      return sangayanaToRoman(text, n);
    case "sinhala":
      return normalizeNiggahita(applyMap(text, siToUnicode), n);
    case "myanmar":
      return normalizeNiggahita(applyMap(text, mynToRoman1), n);
    case "tai_tham":
      return normalizeNiggahita(applyMap(text, taiToRoman), n);
    case "thai":
      return normalizeNiggahita(applyMap(text, thaiToRoman), n);
    case "tai_old":
      return normalizeNiggahita(applyMap(text, taiOldToR), n);
    default:
      return normalizeNiggahita(text, n);
  }
}

/**
 * 罗马巴利 → 任意字体。
 *
 * 先转小写：目标字体（缅甸文、泰文、天城体一类）没有大小写，转换表也只
 * 收了小写键，大写字母不转小写会原样漏出来。
 */
export function fromRoman(text: string, to: TargetScript, n: Niggahita): string {
  const lower = text.toLowerCase();
  switch (to) {
    case "sangayana":
      // 上游在开头补一个空格：表里有依赖词首的规则（`ŋk` → `ïk` 之类）
      return applyMap(` ${lower}`, unicodeToSanga);
    case "sinhala1":
      return applyMap(lower, unicodeToSiC);
    case "sinhala2":
      return applyMap(lower, unicodeToSiN);
    case "telugu":
      return normalizeNiggahita(applyMap(lower, unicodeToTelugu), n);
    case "myanmar":
      return normalizeNiggahita(applyMap(lower, romanToMyn), n);
    case "tai_tham":
      return normalizeNiggahita(applyMap(lower, romanToTai), n);
    case "thai":
      return normalizeNiggahita(applyMap(lower, romanToThai), n);
    default:
      return normalizeNiggahita(lower, n);
  }
}

/**
 * 目标字体 → 同一种字体作为输入时的名字。
 *
 * 用于「转回罗马巴利」：阅读器里显示的是缅文/泰文，查词和提问要送罗马巴利
 * 给模型，工具页的两栏互换也用它。天城体没有反向表，所以不在表里。
 */
export const TARGET_TO_SOURCE: Partial<Record<TargetScript, SourceScript>> = {
  roman: "roman",
  sangayana: "sangayana",
  sinhala1: "sinhala",
  sinhala2: "sinhala",
  myanmar: "myanmar",
  tai_tham: "tai_tham",
  thai: "thai",
};

/** 输入字体 → 同一种字体作为输出时的名字（工具页互换用）。 */
export const SOURCE_TO_TARGET: Partial<Record<SourceScript, TargetScript>> = {
  roman: "roman",
  sangayana: "sangayana",
  sinhala: "sinhala1",
  myanmar: "myanmar",
  tai_tham: "tai_tham",
  thai: "thai",
};

/**
 * 把已经转成某种字体的文本转回罗马巴利。没有反向表（天城体）时原样返回。
 */
export function scriptToRoman(
  text: string,
  script: TargetScript,
  niggahita: Niggahita = DEFAULT_NIGGAHITA,
): string {
  const from = TARGET_TO_SOURCE[script];
  if (!from || !text) return text;
  return toRoman(text, from, niggahita);
}

export interface ConvertOptions {
  from: SourceScript;
  to: TargetScript;
  niggahita?: Niggahita;
}

/** 一次完整转换：源字体 → 罗马巴利 → 目标字体。 */
export function convertScript(text: string, opts: ConvertOptions): string {
  if (!text) return text;
  const n = opts.niggahita ?? DEFAULT_NIGGAHITA;
  if (opts.from === "roman" && opts.to === "roman") {
    return normalizeNiggahita(text, n);
  }
  return fromRoman(toRoman(text, opts.from, n), opts.to, n);
}
