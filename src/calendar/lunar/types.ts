/**
 * 五套历法的统一输出（`docs/buddhist-calendar.md` §5）。
 *
 * 每套历法**用自己的记法**说话：缅历给 Thadingyut + 上弦十五，农历给八月十九，
 * 泰历给 เดือน ๑๑。翻译成界面语言是 UI 的事，这里不做。
 */
import type { MessageKey } from "../../i18n";

export type CalendarSystem = "astro" | "chinese" | "myanmar" | "srilanka" | "thai";

export const CALENDAR_SYSTEMS: CalendarSystem[] = [
  "astro",
  "myanmar",
  "srilanka",
  "thai",
  "chinese",
];

/** 只标四相；其余日子为 `none`，格子里不画图标。 */
export type MoonPhaseKind = "new" | "firstQuarter" | "full" | "lastQuarter" | "none";

export interface LunarDay {
  system: CalendarSystem;
  /** `2026-09-30`，观察地时区的日历日。 */
  dayKey: string;
  /** 该历法自己的日名（农历「十九」、缅历「上弦十五」由 UI 按 half/fortnightDay 合成时为空）。 */
  dayLabel: string;
  /** 半月方向；四相日之外也有效。 */
  half: "waxing" | "waning";
  /** 半月内第几日（1-15）；0 表示该历法不给这个量。 */
  fortnightDay: number;
  /**
   * 月名**专名**（Thadingyut / Vap Poya 这类人名地名式的名字，不随界面语言变）。
   * 只按序号称呼的历法（农历、泰历）这里留空，改用 `monthNumber`。
   */
  monthName: string;
  /** 月序 1-12；0 表示该历法不用序号。 */
  monthNumber: number;
  /** 闰月（农历）。 */
  leapMonth: boolean;
  /** 重复的月（泰历闰年的第二个八月 ๘๘）。 */
  repeatedMonth: boolean;
  /** 月内第几日 1-30；只按半月计数的历法为 0。 */
  dayOfMonth: number;
  /** 纪年：`缅历 1388` / `BE 2570` / `丙午年`。 */
  era: string;
  phase: MoonPhaseKind;
  /** 真月相角（0-360），画月相图标用；与 phase 无关地连续。 */
  phaseAngle: number;
  isUposatha: boolean;
  /** 节日文案的 i18n key，同一天可有多个。 */
  festivalKeys: MessageKey[];
  /** 与天文朔望的取日差（日）；天文历自身恒为 0。 */
  deltaDays: number;
}

/** 一个公历月的推算结果：键是 `dayKey`。 */
export type LunarMonth = Map<string, LunarDay>;

export interface MonthRequest {
  /** 公历年月（月 1-12）。 */
  year: number;
  month: number;
  /** 观察地时区；取日一律按它。 */
  timeZone: string;
}
