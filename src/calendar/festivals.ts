/**
 * 节日日历：雨安居进度与「下一个节日还有几天」。
 *
 * 节日日期由各历法自己给（`LunarDay.festivalKeys`），这里只做两件事：
 * 把一整年扫出来缓存，再回答「今天在雨安居的第几天」「下一个节日是哪个」。
 *
 * 扫一年要建 12 个月（每个月都要搜朔望），所以**按 (历法, 年, 时区) 缓存**，
 * 别在渲染里反复算。
 */
import type { MessageKey } from "../i18n";
import { buildMonth, type CalendarSystem } from "./lunar";
import { makeDayKey } from "./tz";

const DAY = 86400_000;

export interface FestivalDay {
  dayKey: string;
  keys: MessageKey[];
}

const CACHE = new Map<string, FestivalDay[]>();

/** 某历法某一年的全部节日，按日期排序。 */
export function festivalsOfYear(
  system: CalendarSystem,
  year: number,
  timeZone: string,
): FestivalDay[] {
  const cacheKey = `${system}|${year}|${timeZone}`;
  const cached = CACHE.get(cacheKey);
  if (cached) return cached;

  const out: FestivalDay[] = [];
  for (let month = 1; month <= 12; month++) {
    for (const day of buildMonth(system, { year, month, timeZone }).values()) {
      if (day.festivalKeys.length) {
        out.push({ dayKey: day.dayKey, keys: [...day.festivalKeys] });
      }
    }
  }
  out.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  CACHE.set(cacheKey, out);
  return out;
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

export interface VassaProgress {
  /** 今天是雨安居第几天（入安居次日为第 1 天）。 */
  day: number;
  /** 到出安居还剩几天。 */
  left: number;
  total: number;
}

/**
 * 雨安居进度。
 *
 * 起点是**入安居满月的次日**（满月当天是 Āsāḷhā 布萨，安居从第二天算起），
 * 终点是自恣日（出安居）当天。不在期间内返回 null。
 */
export function vassaProgress(
  system: CalendarSystem,
  todayKey: string,
  timeZone: string,
): VassaProgress | null {
  const year = Number(todayKey.slice(0, 4));
  // 跨年不会发生（安居在同一公历年内），但年初查上一年的安居也无妨。
  for (const y of [year, year - 1]) {
    const festivals = festivalsOfYear(system, y, timeZone);
    const start = festivals.find((f) => f.keys.includes("calendar.festival.vassaStart"));
    const end = festivals.find((f) => f.keys.includes("calendar.festival.pavarana"));
    if (!start || !end) continue;

    const first = dayNumber(start.dayKey) + 1; // 满月次日
    const last = dayNumber(end.dayKey);
    const now = dayNumber(todayKey);
    if (now < first || now > last) continue;

    return { day: now - first + 1, left: last - now, total: last - first + 1 };
  }
  return null;
}

export interface UpcomingFestival {
  key: MessageKey;
  dayKey: string;
  /** 还有几天；0 = 今天。 */
  inDays: number;
}

/**
 * 下一个节日 —— 只在一个月以内才报，远了没有倒计时的意义。
 * 今天本身有节日时报今天。
 */
export function nextFestival(
  system: CalendarSystem,
  todayKey: string,
  timeZone: string,
  withinDays = 30,
): UpcomingFestival | null {
  const now = dayNumber(todayKey);
  const year = Number(todayKey.slice(0, 4));
  const all = [
    ...festivalsOfYear(system, year, timeZone),
    ...festivalsOfYear(system, year + 1, timeZone),
  ];
  for (const festival of all) {
    const inDays = dayNumber(festival.dayKey) - now;
    if (inDays < 0) continue;
    if (inDays > withinDays) return null;
    // 同一天可能有多个节日（国际卫塞节 + 本历法的卫塞），取第一个作代表。
    return { key: festival.keys[0], dayKey: festival.dayKey, inDays };
  }
  return null;
}

/** 今天的日期键（观察地时区）。 */
export function todayKeyOf(parts: { year: number; month: number; day: number }): string {
  return makeDayKey(parts.year, parts.month, parts.day);
}
