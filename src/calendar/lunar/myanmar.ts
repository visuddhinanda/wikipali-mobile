/**
 * 缅甸佛历（§2.5）。
 *
 * 移植自 Yan Naing Aye 的 `ceMmDateTime.js`（MIT，
 * https://github.com/yan9a/mmcal ，算法说明见
 * http://cool-emerald.blogspot.com/2013/06/algorithm-program-and-calculation-of.html ）。
 * 只取纯计算部分：纪元常数、置闰、儒略日 ↔ 缅历、月相、布萨日；
 * 字符串本地化与史料事件表没有搬过来。
 *
 * MIT License, Copyright (c) 2018 Yan Naing Aye
 */
import type { MessageKey } from "../../i18n";
import { daysInMonth, julianDayNumber, makeDayKey } from "../tz";
import { phaseAngleAt } from "./phase";
import type { LunarDay, LunarMonth, MonthRequest, MoonPhaseKind } from "./types";

const SOLAR_YEAR = 1577917828.0 / 4320000.0; // 365.2587565
const LUNAR_MONTH = 1577917828.0 / 53433336.0; // 29.53058795
const MYANMAR_EPOCH = 1954168.050623; // 缅历 0 年起点（MMT）

interface EraConst {
  /** 纪元编号，计算方法随它变。 */
  EI: number;
  /** 置闰偏移。 */
  WO: number;
  /** 求余日数用的月数。 */
  NM: number;
  /** 置闰例外。 */
  EW: number;
}

function bSearch2(k: number, a: number[][]): number {
  let l = 0;
  let u = a.length - 1;
  while (u >= l) {
    const i = Math.floor((l + u) / 2);
    if (a[i][0] > k) u = i - 1;
    else if (a[i][0] < k) l = i + 1;
    else return i;
  }
  return -1;
}

function bSearch1(k: number, a: number[]): number {
  let l = 0;
  let u = a.length - 1;
  while (u >= l) {
    const i = Math.floor((l + u) / 2);
    if (a[i] > k) u = i - 1;
    else if (a[i] < k) l = i + 1;
    else return i;
  }
  return -1;
}

/** 各纪元的常数与例外表（原样照抄，动一个数字就对不上史料）。 */
function getMyConst(my: number): EraConst {
  let EI: number;
  let WO: number;
  let NM: number;
  let EW = 0;
  let fme: number[][];
  let wte: number[];

  if (my >= 1312) {
    // 第三纪元：独立之后（1312 ME 起）
    EI = 3; WO = -0.5; NM = 8;
    fme = [[1377, 1]];
    wte = [1344, 1345];
  } else if (my >= 1217) {
    // 第二纪元：英属时期（1217–1311 ME）
    EI = 2; WO = -1; NM = 4;
    fme = [[1234, 1], [1261, -1]];
    wte = [1263, 1264];
  } else if (my >= 1100) {
    // Thandeikta（1100–1216 ME）
    EI = 1.3; WO = -0.85; NM = -1;
    fme = [[1120, 1], [1126, -1], [1150, 1], [1172, -1], [1207, 1]];
    wte = [1201, 1202];
  } else if (my >= 798) {
    // Makaranta system 2（798–1099 ME）
    EI = 1.2; WO = -1.1; NM = -1;
    fme = [
      [813, -1], [849, -1], [851, -1], [854, -1], [927, -1], [933, -1],
      [936, -1], [938, -1], [949, -1], [952, -1], [963, -1], [968, -1],
      [1039, -1],
    ];
    wte = [];
  } else {
    // Makaranta system 1（0–797 ME）
    EI = 1.1; WO = -1.1; NM = -1;
    fme = [
      [205, 1], [246, 1], [471, 1], [572, -1], [651, 1], [653, 2],
      [656, 1], [672, 1], [729, 1], [767, -1],
    ];
    wte = [];
  }

  const i = bSearch2(my, fme);
  if (i >= 0) WO += fme[i][1];
  if (bSearch1(my, wte) >= 0) EW = 1;
  return { EI, WO, NM, EW };
}

/** 判断是否闰年（watat），并给出第二个 Waso 的满月日。 */
function calWatat(my: number): { fm: number; watat: number } {
  const c = getMyConst(my);
  const TA = (SOLAR_YEAR / 12 - LUNAR_MONTH) * (12 - c.NM);
  let ed = (SOLAR_YEAR * (my + 3739)) % LUNAR_MONTH;
  if (ed < TA) ed += LUNAR_MONTH;
  const fm = Math.round(SOLAR_YEAR * my + MYANMAR_EPOCH - ed + 4.5 * LUNAR_MONTH + c.WO);

  let watat = 0;
  if (c.EI >= 2) {
    const TW = LUNAR_MONTH - (SOLAR_YEAR / 12 - LUNAR_MONTH) * c.NM;
    if (ed >= TW) watat = 1;
  } else {
    // 第一纪元按 19 年 Metonic 周期置闰。
    let w = (my * 7 + 2) % 19;
    if (w < 0) w += 19;
    watat = Math.floor(w / 12);
  }
  watat ^= c.EW;
  return { fm, watat };
}

interface MyanmarYear {
  /** 年型：0 平年、1 小闰年、2 大闰年。 */
  myt: number;
  /** Tagu 月初一的 JDN。 */
  tg1: number;
  fm: number;
}

function calMy(my: number): MyanmarYear {
  let yd = 0;
  let y1: { fm: number; watat: number };
  let nd = 0;
  let fm = 0;
  const y2 = calWatat(my);
  let myt = y2.watat;
  do {
    yd++;
    y1 = calWatat(my - yd);
  } while (y1.watat === 0 && yd < 3);

  if (myt) {
    nd = (y2.fm - y1.fm) % 354;
    myt = Math.floor(nd / 31) + 1;
    fm = y2.fm;
  } else {
    fm = y1.fm + 354 * yd;
  }
  const tg1 = y1.fm + 354 * yd - 102;
  return { myt, tg1, fm };
}

export interface MyanmarDate {
  /** 年型。 */
  myt: number;
  /** 缅历年。 */
  my: number;
  /** 月：Tagu=1 … Tabaung=12，1st Waso=0，Late Tagu=13、Late Kason=14。 */
  mm: number;
  /** 月内日 1-30。 */
  md: number;
}

/** JDN → 缅历日期。 */
export function jdnToMyanmar(jdnInput: number): MyanmarDate {
  const jdn = Math.round(jdnInput);
  const my = Math.floor((jdn - 0.5 - MYANMAR_EPOCH) / SOLAR_YEAR);
  const yo = calMy(my);
  let dd = jdn - yo.tg1 + 1;
  const b = Math.floor(yo.myt / 2);
  const c = Math.floor(1 / (yo.myt + 1));
  const myl = 354 + (1 - c) * 30 + b;
  const mmt = Math.floor((dd - 1) / myl);
  dd -= mmt * myl;
  const a = Math.floor((dd + 423) / 512);
  let mm = Math.floor((dd - b * a + c * a * 30 + 29.26) / 29.544);
  const e = Math.floor((mm + 12) / 16);
  const f = Math.floor((mm + 11) / 16);
  const md = dd - Math.floor(29.544 * mm - 29.26) - b * e + c * f * 30;
  mm += f * 3 - e * 4 + 12 * mmt;
  return { myt: yo.myt, my, mm, md };
}

/** 月长（29 或 30 天）；大闰年的 Nayon 多一天。 */
function monthLength(mm: number, myt: number): number {
  let mml = 30 - (mm % 2);
  if (mm === 3) mml += Math.floor(myt / 2);
  return mml;
}

/** 月相：0 上弦、1 满月、2 下弦、3 月黑。 */
function moonPhaseIndex(md: number, mm: number, myt: number): number {
  const mml = monthLength(mm, myt);
  return Math.floor((md + 1) / 16) + Math.floor(md / 16) + Math.floor(md / mml);
}

/** 布萨日：1 = 布萨，2 = 布萨前夜，0 = 其余。 */
function sabbath(md: number, mm: number, myt: number): number {
  const mml = monthLength(mm, myt);
  if (md === 8 || md === 15 || md === 23 || md === mml) return 1;
  if (md === 7 || md === 14 || md === 22 || md === mml - 1) return 2;
  return 0;
}

/** 半月内第几日（1-15）。 */
function fortnightDay(md: number): number {
  return md - 15 * Math.floor(md / 16);
}

const MONTH_NAMES: Record<number, string> = {
  0: "First Waso",
  1: "Tagu",
  2: "Kason",
  3: "Nayon",
  4: "Waso",
  5: "Wagaung",
  6: "Tawthalin",
  7: "Thadingyut",
  8: "Tazaungmon",
  9: "Nadaw",
  10: "Pyatho",
  11: "Tabodwe",
  12: "Tabaung",
  13: "Late Tagu",
  14: "Late Kason",
};

const PHASES: MoonPhaseKind[] = ["none", "full", "none", "new"];

/** 满月日的传统节日。 */
function festivalsOf(mm: number, phase: number): MessageKey[] {
  if (phase !== 1) return [];
  if (mm === 2) return ["calendar.festival.vesakLocal"]; // Kason 满月：佛陀日
  if (mm === 4) return ["calendar.festival.vassaStart"]; // Waso 满月：入雨安居
  if (mm === 7) return ["calendar.festival.pavarana"]; // Thadingyut 满月：自恣
  return [];
}

export function myanmarMonth({ year, month, timeZone }: MonthRequest): LunarMonth {
  const out: LunarMonth = new Map();
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const key = makeDayKey(year, month, day);
    const d = jdnToMyanmar(julianDayNumber(year, month, day));
    const phaseIndex = moonPhaseIndex(d.md, d.mm, d.myt);
    // 上下弦的「布萨」是第 8 / 23 日，不是天文上的弦（缅历按算术定日）。
    const isQuarter = d.md === 8 || d.md === 23;
    const phase: MoonPhaseKind = isQuarter
      ? d.md === 8
        ? "firstQuarter"
        : "lastQuarter"
      : PHASES[phaseIndex] ?? "none";

    out.set(key, {
      system: "myanmar",
      dayKey: key,
      dayLabel: "",
      half: phaseIndex >= 2 ? "waning" : "waxing",
      fortnightDay: fortnightDay(d.md),
      monthName: MONTH_NAMES[d.mm] ?? String(d.mm),
      monthNumber: 0,
      leapMonth: false,
      repeatedMonth: false,
      dayOfMonth: d.md,
      era: `${d.my}`,
      phase,
      phaseAngle: phaseAngleAt(year, month, day, timeZone),
      isUposatha: sabbath(d.md, d.mm, d.myt) === 1,
      festivalKeys: festivalsOf(d.mm, phaseIndex),
      deltaDays: 0,
    });
  }
  return out;
}

/** 缅历年 → 佛历年（Sasana year）。 */
export function sasanaYear(my: number): number {
  return my + 1182;
}
