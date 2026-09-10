/**
 * 把历法输出拼成界面文字。
 *
 * 拼装留在 UI 侧：历法模块只给结构化结果（半月、第几日、月名、纪年），
 * 怎么说是界面语言的事。
 */
import type { MessageKey } from "../i18n";
import { sasanaYear } from "./lunar";
import type { LunarDay } from "./lunar";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * 农历在中文界面下用传统写法（正月初一、闰二月廿九），其余语言按序号说
 * （「Month 2 · Day 29」）。
 *
 * 这不是「切界面语言」，是同一套记法在中文里本来就有名字 —— 跟缅历的
 * Thadingyut、锡兰的 Binara 一样，只不过它恰好是汉字。
 */
const CHINESE_MONTHS = [
  "正月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "腊月",
];
const CHINESE_DAYS = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
];

function isChineseLocale(locale: string): boolean {
  return locale.startsWith("zh");
}

/**
 * 月名：专名（Thadingyut、Vap）原样保留 —— 那是名字，不是语言；
 * 只按序号称呼的农历、泰历按**界面语言**拼，闰月与泰历的第二个八月各有说法。
 */
export function monthLabelOf(day: LunarDay | undefined, t: T, locale = ""): string {
  if (!day) return "";
  if (day.monthName) return day.monthName;
  if (!day.monthNumber) return "";
  if (day.system === "chinese" && isChineseLocale(locale)) {
    return `${day.leapMonth ? "闰" : ""}${CHINESE_MONTHS[day.monthNumber - 1]}`;
  }
  const key = day.leapMonth
    ? "calendar.leapMonthNo"
    : day.repeatedMonth
      ? "calendar.repeatMonthNo"
      : "calendar.monthNo";
  return t(key, { n: day.monthNumber });
}

/**
 * 格子里的一行小字。
 *
 * 半月计数的历法（天文、缅、泰）说「上弦 15」，整月计数的（农历）说「19 日」；
 * 一律走界面语言 —— 切到泰历是要看泰历的推算差别，不是把界面换成泰文。
 */
export function dayLabelOf(day: LunarDay | undefined, t: T, locale = ""): string {
  if (!day) return "";
  if (day.dayLabel) return day.dayLabel;
  if (day.system === "chinese" && day.dayOfMonth) {
    return isChineseLocale(locale)
      ? (CHINESE_DAYS[day.dayOfMonth - 1] ?? String(day.dayOfMonth))
      : t("calendar.dayNo", { n: day.dayOfMonth });
  }
  if (!day.fortnightDay) return "";
  const half = t(day.half === "waxing" ? "calendar.half.waxing" : "calendar.half.waning");
  return `${half} ${day.fortnightDay}`;
}

/** 月份标题下的副行：月名 + 纪年。 */
export function eraLineOf(day: LunarDay | undefined, t: T, locale = ""): string {
  if (!day) return "";
  const month = monthLabelOf(day, t, locale);
  switch (day.system) {
    case "myanmar": {
      const my = Number(day.era);
      return `${month} ${day.era} · BE ${sasanaYear(my)}`;
    }
    case "chinese":
      // 中文里「丙午年八月」连写，别的语言之间要空格。
      return isChineseLocale(locale)
        ? `${day.era}${month}`
        : [day.era, month].filter(Boolean).join(" ");
    case "thai":
      return [month, day.era].filter(Boolean).join(" · ");
    case "srilanka":
      return month ? `${month} Poya` : "";
    default:
      return "";
  }
}

const PHASE_KEYS: Record<string, MessageKey> = {
  new: "calendar.phase.new",
  firstQuarter: "calendar.phase.firstQuarter",
  full: "calendar.phase.full",
  lastQuarter: "calendar.phase.lastQuarter",
};

export function phaseLabelOf(day: LunarDay | undefined, t: T): string {
  if (!day || day.phase === "none") return "";
  return t(PHASE_KEYS[day.phase]);
}

/** Δ 标签：`Δ0` / `Δ−1` / `Δ+1`。 */
export function deltaLabelOf(day: LunarDay | undefined): string {
  if (!day || day.phase === "none") return "";
  if (day.deltaDays === 0) return "Δ0";
  return day.deltaDays > 0 ? `Δ+${day.deltaDays}` : `Δ${day.deltaDays}`;
}

/**
 * 三个时刻的巴利名。
 *
 * 律中判日界的是 `aruṇuggamana`（明相）、判非时食的是 `majjhanhika`（日中）、
 * `atthaṅgama` 是日落。写在中文标签上方，让读经的人对得上术语。
 */
export const PALI_TIME_NAMES = {
  aruna: "aruṇuggamana",
  noon: "majjhanhika",
  sunset: "atthaṅgama",
} as const;

/** 七曜的巴利星名，压在星期头下面（缅、泰、锡兰读者按星名认星期）。 */
export const PALI_WEEKDAYS = ["Ravi", "Canda", "Bhumma", "Budha", "Guru", "Sukka", "Sani"];

export const WEEKDAY_KEYS: MessageKey[] = [
  "calendar.weekday.sun",
  "calendar.weekday.mon",
  "calendar.weekday.tue",
  "calendar.weekday.wed",
  "calendar.weekday.thu",
  "calendar.weekday.fri",
  "calendar.weekday.sat",
];
