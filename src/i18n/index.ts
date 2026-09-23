/**
 * 界面语言。
 *
 * 默认**跟随手机系统语言**（`expo-localization` 的 `getLocales()`，
 * 返回的是用户在系统设置里排好序的偏好列表）；用户可在
 * 「我 → 设置 → 语言偏好」显式指定，选择持久化到 AsyncStorage。
 *
 * 只有 UI 文案走这里。经文正文的语言是内容维度（版本 / 频道选择），
 * 与界面语言无关，不要混在一起。
 *
 * 文案按语言分目录、按语义分文件（见 `docs/README.md` §i18n）：
 *   i18n/<locale>/messages.ts  一般消息（标题 / 描述 / 提示 / 空态 / 错误）
 *   i18n/<locale>/labels.ts    标签（徽标 / Tab / 状态 / 选项 / 分类名）
 *   i18n/<locale>/buttons.ts   按钮 / 动作文案
 *   i18n/<locale>/books.ts     巴利书名（丛书名 + 实际书名，兜底用）
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import zhHansMessages from "./zh-Hans/messages";
import zhHansLabels from "./zh-Hans/labels";
import zhHansButtons from "./zh-Hans/buttons";
import zhHantMessages from "./zh-Hant/messages";
import zhHantLabels from "./zh-Hant/labels";
import zhHantButtons from "./zh-Hant/buttons";
import enMessages from "./en/messages";
import enLabels from "./en/labels";
import enButtons from "./en/buttons";
import myMessages from "./my/messages";
import myLabels from "./my/labels";
import myButtons from "./my/buttons";
import thMessages from "./th/messages";
import thLabels from "./th/labels";
import thButtons from "./th/buttons";
import siMessages from "./si/messages";
import siLabels from "./si/labels";
import siButtons from "./si/buttons";
import viMessages from "./vi/messages";
import viLabels from "./vi/labels";
import viButtons from "./vi/buttons";
import loMessages from "./lo/messages";
import loLabels from "./lo/labels";
import loButtons from "./lo/buttons";

export type Locale =
  "zh-Hans" | "zh-Hant" | "en" | "my" | "th" | "si" | "vi" | "lo";

/** 语言选择；`system` 表示跟随系统。 */
export type LocalePreference = Locale | "system";

/** 文案 key：以 zh-Hans 的三类文案推导（缺 key 会在 tsc 阶段报错）。 */
export type MessageKey =
  | keyof typeof zhHansMessages
  | keyof typeof zhHansLabels
  | keyof typeof zhHansButtons;

export type Messages = Record<MessageKey, string>;

const zhHans: Messages = { ...zhHansMessages, ...zhHansLabels, ...zhHansButtons };
const zhHant: Messages = { ...zhHantMessages, ...zhHantLabels, ...zhHantButtons };
const en: Messages = { ...enMessages, ...enLabels, ...enButtons };
const my: Messages = { ...myMessages, ...myLabels, ...myButtons };
const th: Messages = { ...thMessages, ...thLabels, ...thButtons };
const si: Messages = { ...siMessages, ...siLabels, ...siButtons };
const vi: Messages = { ...viMessages, ...viLabels, ...viButtons };
const lo: Messages = { ...loMessages, ...loLabels, ...loButtons };

export const CATALOGS: Record<Locale, Messages> = {
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  en,
  my,
  th,
  si,
  vi,
  lo,
};

/**
 * 设置页里展示的语言列表。
 *
 * `label` 一律用该语言的**自称名**（endonym），不随当前界面语言变化 ——
 * 找母语的人能认出自己的语言，即便当前界面是他看不懂的语言。
 */
export const LOCALE_OPTIONS: { id: Locale; label: string }[] = [
  { id: "zh-Hans", label: "简体中文" },
  { id: "zh-Hant", label: "繁體中文" },
  { id: "en", label: "English" },
  { id: "my", label: "မြန်မာဘာသာ" },
  { id: "th", label: "ภาษาไทย" },
  { id: "si", label: "සිංහල" },
  { id: "vi", label: "Tiếng Việt" },
  { id: "lo", label: "ພາສາລາວ" },
];

/** 任何语言都没匹配上时的兜底。 */
export const FALLBACK_LOCALE: Locale = "en";

const STORAGE_KEY = "@wikipali/locale";

/** 用繁体的中文地区（台港澳）—— 系统没给 script code 时的兜底判据。 */
const TRADITIONAL_REGIONS = new Set(["TW", "HK", "MO"]);

/**
 * 把一个 BCP 47 标签归一到受支持的语言。
 *
 * 中文要分简繁：优先看 ISO 15924 script code（`Hant` / `Hans`），
 * Android / Web 上它可能为 null，再退回按地区判断（zh-TW / zh-HK / zh-MO 用繁体）。
 */
function matchLocale(
  languageCode: string | null,
  scriptCode: string | null,
  regionCode: string | null,
  tag: string,
): Locale | null {
  const parts = tag.split("-");
  const code = (languageCode ?? parts[0] ?? "").toLowerCase();

  if (code === "zh") {
    const script = (scriptCode ?? "").toLowerCase();
    if (script === "hant") return "zh-Hant";
    if (script === "hans") return "zh-Hans";
    // 没有 script code：看地区，再看 tag 里是否直接写了 Hant（如 zh-Hant-TW）
    const region = (regionCode ?? parts[parts.length - 1] ?? "").toUpperCase();
    if (TRADITIONAL_REGIONS.has(region)) return "zh-Hant";
    if (tag.toLowerCase().includes("hant")) return "zh-Hant";
    return "zh-Hans";
  }

  switch (code) {
    case "en":
      return "en";
    case "my":
      return "my";
    case "th":
      return "th";
    case "si":
      return "si";
    case "vi":
      return "vi";
    case "lo":
      return "lo";
    default:
      return null;
  }
}

/** 按系统偏好顺序，取第一个我们支持的语言。 */
export function detectSystemLocale(): Locale {
  try {
    for (const l of getLocales()) {
      const hit = matchLocale(
        l.languageCode,
        l.languageScriptCode,
        l.regionCode,
        l.languageTag,
      );
      if (hit) return hit;
    }
  } catch {
    // 某些环境（如未重建的旧 dev client）拿不到原生模块，走兜底。
  }
  return FALLBACK_LOCALE;
}

function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && v in CATALOGS;
}

export async function getLocalePreference(): Promise<LocalePreference> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (v === "system" || isLocale(v)) return v;
  } catch {
    // ignore
  }
  return "system";
}

export async function setLocalePreference(p: LocalePreference): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, p);
}

export function resolveLocale(p: LocalePreference): Locale {
  return p === "system" ? detectSystemLocale() : p;
}

/**
 * 当前生效语言的模块级副本。
 *
 * React 树内请用 `useT()`；这个副本是给 `src/api/*` 这类拿不到 hook 的
 * 模块用的（比如把网络错误翻译成用户可读的文案）。由 `I18nProvider` 维护。
 */
let activeLocale: Locale = FALLBACK_LOCALE;

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const raw = CATALOGS[locale][key] ?? CATALOGS[FALLBACK_LOCALE][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/** 组件外使用的翻译函数（用模块级的当前语言）。 */
export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  return translate(activeLocale, key, vars);
}

/**
 * 界面语言 → 内容语族。
 *
 * 内容（译本）的语言维度只到语族：简体/繁体中文都是 `zh`，服务端按 `zh`
 * 一并返回 `zh-Hans` / `zh-Hant` / `zh` 的频道。
 */
export function langFamily(locale: Locale): string {
  return locale.split("-")[0];
}
