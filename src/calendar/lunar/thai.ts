/**
 * 泰国佛历（Suriyayatra，§2.6）。
 *
 * 移植自 hmmbug/pythaidate（MIT）的 `LSYear` / `CsDate`，那份实现按
 * J. C. Eade 与 Faraut 给出的算式写成，并有自己的回归测试；本文件只搬
 * 纯计算部分：horakhun / kammacapon / avoman / masaken → 年型（平年 354、
 * 闰日 355、闰月 384）→ 月日查表。
 *
 * MIT License, Copyright (c) hmmbug
 * https://github.com/hmmbug/pythaidate
 */
import type { MessageKey } from "../../i18n";
import { daysInMonth, julianDayNumber, makeDayKey } from "../tz";
import { phaseAngleAt } from "./phase";
import type { LunarDay, LunarMonth, MonthRequest, MoonPhaseKind } from "./types";

const DAYS_IN_800_YEARS = 292207;
const TIME_UNITS_IN_1_DAY = 800;
const EPOCH_OFFSET = 373;
const UCCAPON_CONSTANT = 2611;
const APOGEE_ROTATION_DAYS = 3232;
/** 小历（Chulasakarat）纪元对应的儒略日。 */
const CS_JULIAN_DAY_OFFSET = 1954167;
/** 佛历 = 小历 + 1181。 */
const BUDDHIST_ERA_OFFSET = 1181;

type CalType = "A" | "B" | "C" | "c";

const CAL_TYPE_DAY_COUNTS: Record<CalType, number> = { A: 354, B: 355, C: 384, c: 384 };

interface LSYear {
  year: number;
  horakhun: number;
  kammacapon: number;
  avoman: number;
  tithi: number;
  weekday: number;
  langsak: number;
  nyd: number;
  nextNyd: number;
  leapday: boolean;
  calType: CalType;
  offset: boolean;
  /** 距 Caitra 初一的天数偏移，`calculateYear0` 里才定下来。 */
  offsetDays: number;
}

function lsYear(year: number): LSYear {
  const horakhun =
    Math.floor((year * DAYS_IN_800_YEARS + EPOCH_OFFSET) / TIME_UNITS_IN_1_DAY) + 1;
  const kammacapon =
    TIME_UNITS_IN_1_DAY - ((year * DAYS_IN_800_YEARS + EPOCH_OFFSET) % TIME_UNITS_IN_1_DAY);
  const avoQuot = Math.floor((horakhun * 11 + 650) / 692);
  let avoman = (horakhun * 11 + 650) % 692;
  if (avoman === 0) avoman = 692;
  let tithi = (avoQuot + horakhun) % 30;
  if (avoman === 692) tithi -= 1;
  const weekday = horakhun % 7;

  const horakhun1 =
    Math.floor(((year + 1) * DAYS_IN_800_YEARS + EPOCH_OFFSET) / TIME_UNITS_IN_1_DAY) + 1;
  const quot1 = Math.floor((horakhun1 * 11 + 650) / 692);
  const tithi1 = (quot1 + horakhun1) % 30;

  // Faraut p.28：新年那天在周内的位置
  const langsak = Math.max(1, tithi);
  let nyd = langsak;
  if (nyd < 6) nyd += 29;
  nyd = (weekday - nyd + 1 + 35) % 7;

  const leapday = kammacapon <= 207;

  let calType: CalType = "A";
  if (tithi > 24 || tithi < 6) calType = "C";
  if (tithi === 25 && tithi1 === 5) calType = "A";
  if ((leapday && avoman <= 126) || (!leapday && avoman <= 137)) {
    calType = calType !== "C" ? "B" : "c";
  }

  const nextNyd =
    calType === "A" ? (nyd + 4) % 7 : calType === "B" ? (nyd + 5) % 7 : (nyd + 6) % 7;

  return {
    year,
    horakhun,
    kammacapon,
    avoman,
    tithi,
    weekday,
    langsak,
    nyd,
    nextNyd,
    leapday,
    calType,
    offset: false,
    offsetDays: 0,
  };
}

/**
 * 定下某一年的年型与新年偏移。
 *
 * 要连看前后两年：闰日与闰月在泰历里不能同时出现（缅历可以），撞上了就把闰日
 * 挪到前一年或后一年，靠新年星期的连续性决定挪哪边。
 */
function calculateYear0(year: number): LSYear {
  const y = [-2, -1, 0, 1, 2].map((d) => lsYear(year + d));

  if (y[2].tithi === 24 && y[3].tithi === 6) {
    for (const item of y) {
      item.calType = "C";
      item.nextNyd = (item.nextNyd + 2) % 7;
    }
  }

  for (const i of [1, 2, 3]) {
    if (y[i].calType === "c") {
      const j = y[i].nyd === y[i - 1].nextNyd ? 1 : -1;
      y[i + j].calType = "B";
      y[i + j].nextNyd = (y[i + j].nextNyd + 1) % 7;
    }
  }

  for (const i of [1, 2, 3]) {
    if (y[i - 1].nextNyd !== y[i].nyd && y[i].nextNyd !== y[i + 1].nyd) {
      y[i].offset = true;
      y[i].langsak += 1;
      y[i].nyd = (y[i].nyd + 6) % 7;
      y[i].nextNyd = (y[i].nextNyd + 6) % 7;
    }
  }

  for (const item of y) if (item.calType === "c") item.calType = "C";

  const target = y[2];
  target.offsetDays = target.langsak;
  if (target.offsetDays < 6 + (target.offset ? 1 : 0)) {
    target.offsetDays += 29;
  }
  return target;
}

/** 月序表：88 表示闰年里的第二个八月（เดือน ๘๘）。 */
const LUNAR_MONTHS = [0, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 8, 88, 15, 16];

const FIND_TABLE: Record<"A" | "B" | "C", [number, number][]> = {
  A: [
    [383, 16], [354, 15], [324, 12], [295, 11], [265, 10], [236, 9],
    [206, 8], [177, 7], [147, 6], [118, 5], [88, 4], [59, 3], [29, 2],
  ],
  B: [
    [384, 16], [355, 15], [325, 12], [296, 11], [266, 10], [237, 9],
    [207, 8], [178, 7], [148, 6], [119, 5], [89, 4], [59, 3], [29, 2],
  ],
  C: [
    [384, 15], [354, 12], [325, 11], [295, 10], [266, 9], [236, 8],
    [207, 7], [177, 6], [148, 5], [118, 14], [88, 13], [59, 3], [29, 2],
  ],
};

/** 由年型与「新年以来第几天」查出月与日。 */
function findDate(calType: CalType, days: number): { month: number; day: number } {
  const table = FIND_TABLE[(calType === "c" ? "C" : calType) as "A" | "B" | "C"];
  for (const [threshold, index] of table) {
    if (days > threshold) {
      return { month: LUNAR_MONTHS[index], day: days - threshold };
    }
  }
  return { month: LUNAR_MONTHS[1], day: days };
}

export interface ThaiDate {
  /** 小历年。 */
  year: number;
  /** 月 1-12；88 = 第二个八月。 */
  month: number;
  /** 月内第几日 1-30。 */
  day: number;
  calType: CalType;
}

/** 儒略日 → 泰历。 */
export function jdnToThai(jdn: number): ThaiDate {
  const hk = jdn - CS_JULIAN_DAY_OFFSET;
  let year = Math.floor((hk * 800 - 373) / DAYS_IN_800_YEARS);
  let days: number;
  let year0: LSYear;

  if (hk % DAYS_IN_800_YEARS === 95333) {
    // 每 800 年一次：太阳闰年的最后一天正好撞上闰月年，上面的公式会多算一年。
    year -= 1;
    year0 = calculateYear0(year);
    days = 365;
  } else {
    year0 = calculateYear0(year);
    days = hk - year0.horakhun;
  }

  let daysInYear = 365 + (year0.leapday ? 1 : 0);
  while (days > daysInYear) {
    year += 1;
    days -= daysInYear;
    year0 = calculateYear0(year);
    daysInYear = 365 + (year0.leapday ? 1 : 0);
  }

  const { month, day } = findDate(year0.calType, year0.offsetDays + days);
  return { year, month, day, calType: year0.calType };
}

/** 月长：单数月 29 天、双数月 30 天；闰日年的第七月多一天。 */
function monthLength(month: number, calType: CalType): number {
  if (month === 88) return 30;
  if (month === 7 && calType === "B") return 30;
  return month % 2 === 1 ? 29 : 30;
}

/**
 * 满月日的节日。
 *
 * **闰月年（athikamāt）三个节日整体后移一个月**：万佛节走四月、卫塞节走七月、
 * 三宝节走第二个八月 —— 泰国官方公布的日期就是这么排的（2026 年万佛节 3/3
 * 在四月、卫塞节 5/31 在七月、三宝节 7/29 在 ๘๘）。出安居仍在十一月，不移。
 */
function festivalsOf(
  month: number,
  isFull: boolean,
  calType: CalType,
  csYear: number,
): MessageKey[] {
  if (!isFull) return [];
  const leapMonthYear = calType === "C" || calType === "c";
  // 万佛节在二三月，落在小历年的**末尾**（月序 1-4）；泰国的规矩是「这个公历年
  // 有闰月就移到四月」，而那个闰月属于四月之后才开始的下一个小历年 —— 所以要看
  // 下一年的年型，不是这一天所在年的。
  const makhaMonth =
    (calculateYear0(csYear + 1).calType as CalType) === "C" ? 4 : 3;
  if (month === makhaMonth && month <= 4) return ["calendar.festival.makha"];
  if (month === (leapMonthYear ? 7 : 6)) return ["calendar.festival.vesakLocal"];
  if (month === (leapMonthYear ? 88 : 8)) return ["calendar.festival.vassaStart"];
  if (month === 11) return ["calendar.festival.pavarana"];
  return [];
}

export function thaiMonth({ year, month, timeZone }: MonthRequest): LunarMonth {
  const out: LunarMonth = new Map();
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const key = makeDayKey(year, month, day);
    const d = jdnToThai(julianDayNumber(year, month, day));
    const length = monthLength(d.month, d.calType);
    const waxing = d.day <= 15;
    const fortnightDay = waxing ? d.day : d.day - 15;
    const isFull = waxing && d.day === 15;
    const isNew = !waxing && d.day === length;

    const phase: MoonPhaseKind = isFull
      ? "full"
      : isNew
        ? "new"
        : fortnightDay === 8
          ? waxing
            ? "firstQuarter"
            : "lastQuarter"
          : "none";

    out.set(key, {
      system: "thai",
      dayKey: key,
      // 日名交给 UI 按界面语言拼：切到泰历是要看泰历的推算差别，不是把界面变成泰文。
      dayLabel: "",
      half: waxing ? "waxing" : "waning",
      fortnightDay,
      monthName: "",
      monthNumber: d.month === 88 ? 8 : d.month,
      leapMonth: false,
      repeatedMonth: d.month === 88,
      dayOfMonth: d.day,
      era: `BE ${d.year + BUDDHIST_ERA_OFFSET}`,
      phase,
      phaseAngle: phaseAngleAt(year, month, day, timeZone),
      // วันพระ：上弦八、十五，下弦八，以及月末（14 或 15）。
      isUposatha: fortnightDay === 8 || isFull || isNew,
      festivalKeys: festivalsOf(d.month, isFull, d.calType, d.year),
      deltaDays: 0,
    });
  }
  return out;
}
