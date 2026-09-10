/**
 * 中国农历（§2.4）—— 按 GB/T 33661-2017 自算：**定朔 + 定气**，
 * 一律以东经 120° 标准时（UTC+8）取日，不随用户所在地变。
 *
 * 置闰规则：冬至所在月为十一月；两个冬至之间若有 13 个朔望月，
 * 则**第一个不含中气的月**为闰月。
 */
import { nextMoonPhase, nextSunLongitude } from "../astro";
import { daysInMonth, makeDayKey } from "../tz";
import { phaseAngleAt } from "./phase";
import type { LunarDay, LunarMonth, MonthRequest } from "./types";

const DAY = 86400_000;
const CHINA_OFFSET = 8 * 3600_000;

/** UTC 瞬间 → 东八区的「日序号」（自 1970-01-01 起）。 */
function chinaDayNumber(at: Date): number {
  return Math.floor((at.getTime() + CHINA_OFFSET) / DAY);
}

function gregorianDayNumber(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / DAY);
}

const STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

interface LunarMonthSpan {
  /** 该月初一的日序号。 */
  start: number;
  /** 下月初一的日序号。 */
  end: number;
  /** 1-12。 */
  index: number;
  leap: boolean;
  /** 该月所属农历年（正月初一换年，用于干支）。 */
  lunarYear: number;
}

/** 该年冬至（太阳黄经 270°）在东八区的日序号与精确时刻。 */
function winterSolstice(year: number): Date {
  const at = nextSunLongitude(270, new Date(Date.UTC(year, 11, 15)), 40);
  if (!at) throw new Error(`找不到 ${year} 年冬至`);
  return at;
}

/** 从 `after` 起的下一个合朔时刻。 */
function newMoonAfter(after: Date): Date {
  const at = nextMoonPhase(0, after, 40);
  if (!at) throw new Error("找不到合朔");
  return at;
}

/** 包含指定时刻的那个朔望月的起点（该时刻当日或之前最近的合朔）。 */
function newMoonOnOrBefore(at: Date): Date {
  let candidate = newMoonAfter(new Date(at.getTime() - 40 * DAY));
  let next = newMoonAfter(new Date(candidate.getTime() + DAY));
  while (chinaDayNumber(next) <= chinaDayNumber(at)) {
    candidate = next;
    next = newMoonAfter(new Date(candidate.getTime() + DAY));
  }
  return candidate;
}

/** 一个朔望月里是否含中气（太阳黄经为 30° 整数倍的时刻）。 */
function hasMajorTerm(startDay: number, endDay: number, startAt: Date): boolean {
  // 从月首起找下一个中气：黄经取 30° 的整数倍。
  const base = new Date(startAt.getTime());
  for (let k = 0; k < 12; k++) {
    const at = nextSunLongitude(k * 30, base, 40);
    if (!at) continue;
    const d = chinaDayNumber(at);
    if (d >= startDay && d < endDay) return true;
  }
  return false;
}

const PERIOD_CACHE = new Map<number, LunarMonthSpan[]>();

/**
 * 一个「冬至到冬至」周期里的各个农历月。
 *
 * 周期从 `year-1` 年冬至所在月（十一月）起，到 `year` 年冬至所在月为止。
 * 闰月判断必须**在周期内部**做 —— 2033 年的闰十一月就落在 2033 冬至之后的
 * 那个周期里，按公历年切段会漏掉（著名的「2033 年问题」）。
 */
function periodSpans(year: number): LunarMonthSpan[] {
  const cached = PERIOD_CACHE.get(year);
  if (cached) return cached;

  const m0 = newMoonOnOrBefore(winterSolstice(year - 1));
  const m13 = newMoonOnOrBefore(winterSolstice(year));

  const starts: Date[] = [m0];
  while (chinaDayNumber(starts[starts.length - 1]) < chinaDayNumber(m13)) {
    starts.push(newMoonAfter(new Date(starts[starts.length - 1].getTime() + DAY)));
  }
  const monthCount = starts.length - 1; // 周期内的月数：12 或 13
  const isLeapYear = monthCount === 13;

  let leapAt = -1;
  if (isLeapYear) {
    for (let i = 1; i <= 12; i++) {
      if (!hasMajorTerm(chinaDayNumber(starts[i]), chinaDayNumber(starts[i + 1]), starts[i])) {
        leapAt = i;
        break;
      }
    }
  }

  const spans: LunarMonthSpan[] = [];
  let index = 11; // m0 是十一月，属上一个农历年
  let lunarYear = year - 1;
  for (let i = 0; i < monthCount; i++) {
    const leap = isLeapYear && i === leapAt;
    if (index === 1 && !leap && i > 0) lunarYear++;
    // 闰月不占新的月序，用**前一个月**的序号加「闰」字（闰二月接在二月后）。
    const label = leap ? ((index + 10) % 12) + 1 : index;
    spans.push({
      start: chinaDayNumber(starts[i]),
      end: chinaDayNumber(starts[i + 1]),
      index: label,
      leap,
      lunarYear,
    });
    if (!leap) index = (index % 12) + 1;
  }
  PERIOD_CACHE.set(year, spans);
  return spans;
}

/** 覆盖公历 `year` 全年所需的农历月（跨两个冬至周期）。 */
function spansForYear(year: number): LunarMonthSpan[] {
  return [...periodSpans(year), ...periodSpans(year + 1)];
}

/** 农历年的干支：以正月初一为界。 */
function sexagenary(year: number): string {
  const stem = ((year - 4) % 10 + 10) % 10;
  const branch = ((year - 4) % 12 + 12) % 12;
  return `${STEMS[stem]}${BRANCHES[branch]}年`;
}

export function chineseMonth({ year, month, timeZone }: MonthRequest): LunarMonth {
  const spans = spansForYear(year);
  const out: LunarMonth = new Map();

  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const key = makeDayKey(year, month, day);
    const n = gregorianDayNumber(year, month, day);
    const span = spans.find((s) => n >= s.start && n < s.end);
    if (!span) continue;

    const dayOfMonth = n - span.start + 1;
    // 农历也画月相：初一朔、十五望，初八/廿三前后是上下弦（定朔历里弦不固定
    // 落在同一日，取最接近的那天）。
    const half = Math.round(span.end - span.start) >= 30 ? 8 : 7;
    const phase: LunarDay["phase"] =
      dayOfMonth === 1
        ? "new"
        : dayOfMonth === 15
          ? "full"
          : dayOfMonth === half
            ? "firstQuarter"
            : dayOfMonth === 15 + half
              ? "lastQuarter"
              : "none";

    out.set(key, {
      system: "chinese",
      dayKey: key,
      // 日名交给 UI 按界面语言拼：切到农历是要看农历的推算，不是把界面变成中文。
      dayLabel: "",
      half: dayOfMonth <= 15 ? "waxing" : "waning",
      fortnightDay: dayOfMonth <= 15 ? dayOfMonth : dayOfMonth - 15,
      monthName: "",
      monthNumber: span.index,
      leapMonth: span.leap,
      repeatedMonth: false,
      dayOfMonth,
      era: sexagenary(span.lunarYear),
      phase,
      phaseAngle: phaseAngleAt(year, month, day, timeZone),
      // 汉传斋日取朔望两日（初一、十五）。
      isUposatha: dayOfMonth === 1 || dayOfMonth === 15,
      festivalKeys: [],
      deltaDays: 0,
    });
  }
  return out;
}
