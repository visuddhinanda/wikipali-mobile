/**
 * 未来的布萨日。
 *
 * 布萨日由各历法自己给（`LunarDay.isUposatha`），这里只负责**往后连续扫**：
 * 从今天所在的月开始逐月建月、挑出布萨日、拼成一条按日期排序的列表。
 *
 * 全程离线 —— 五套历法都是纯算法（真朔望 / 缅历 / Suriyayatra / 定朔定气），
 * 不查表也不联网，所以能算到任意远的未来。通知排程靠的就是这一点。
 */
import { buildMonth, type CalendarSystem } from "./lunar";
import { dayKey, makeDayKey, toLocalParts, zonedDayStart } from "./tz";

export interface UposathaDay {
  /** `2026-09-30`，观察地时区的日历日。 */
  dayKey: string;
  year: number;
  month: number;
  day: number;
  /** 该历法自己的说法，如「上弦十五」「十五」，用来写进通知正文。 */
  dayLabel: string;
  /** 当天的节日（入雨安居、自恣日…），有就一并提。 */
  festivalKeys: string[];
}

/** 一次最多往后扫多少个月，防止历法异常时空转。 */
const MAX_MONTHS = 18;

/**
 * 从 `from` 当天（含）起，往后找 `count` 个布萨日。
 *
 * 扫到的月数有上限：正常情况下布萨一个月四次，`count` 个只要 `count / 4` 个月，
 * 但万一某套历法在某段时间给不出布萨日，也不能无限扫下去。
 */
export function upcomingUposatha(
  system: CalendarSystem,
  timeZone: string,
  from: Date,
  count: number,
): UposathaDay[] {
  const todayKey = dayKey(from, timeZone);
  const start = toLocalParts(from, timeZone);
  const out: UposathaDay[] = [];

  let year = start.year;
  let month = start.month;

  for (let i = 0; i < MAX_MONTHS && out.length < count; i++) {
    const built = buildMonth(system, { year, month, timeZone });
    // Map 的插入顺序就是日序，但别依赖它：显式按 dayKey 排。
    const days = [...built.values()]
      .filter((d) => d.isUposatha && d.dayKey >= todayKey)
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey));

    for (const d of days) {
      if (out.length >= count) break;
      const [y, m, dd] = d.dayKey.split("-").map(Number);
      out.push({
        dayKey: d.dayKey,
        year: y,
        month: m,
        day: dd,
        dayLabel: d.dayLabel,
        festivalKeys: d.festivalKeys,
      });
    }

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return out;
}

/** `2026-09-30` 的前一天，仍是 `YYYY-MM-DD`。 */
export function previousDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d) - 86400_000);
  return makeDayKey(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/** 前一天这个钟点提醒（当地时间）。 */
export const EVENING_HOUR = 20;
/** 当天这个钟点提醒（当地时间）。 */
export const MORNING_HOUR = 7;
/**
 * 往后排多少个布萨日。每个两条，48 条，留在 iOS 的 64 条上限之内。
 * 布萨一月约四次，24 个约管半年；每次启动重排，用不到排满。
 */
export const HORIZON = 24;

export interface NotifyText {
  /** 通知标题，如「布萨」。 */
  title: string;
  /** 前一天那条的正文，`{date}` / `{label}` 已经替换好。 */
  eveBody: (day: { dayKey: string; dayLabel: string }) => string;
  /** 当天那条的正文。 */
  mornBody: (day: { dayKey: string; dayLabel: string }) => string;
}

export interface PlannedNotification {
  dayKey: string;
  kind: "eve" | "morn";
  at: Date;
  body: string;
}

/**
 * 把布萨日列表摊成一条条待发通知。**纯函数，不碰系统 API** —— 自检能直接跑它。
 *
 * 已经过去的时刻要丢掉：今天就是布萨日的话，「前一天傍晚」早过了，当天早上
 * 也可能过了；排一条立刻就触发的通知只会让人莫名其妙。
 */
export function plannedNotifications(
  days: { dayKey: string; dayLabel: string }[],
  timeZone: string,
  now: Date,
  text: NotifyText,
): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  for (const day of days) {
    const eveKey = previousDayKey(day.dayKey);
    for (const [kind, key, hour, body] of [
      ["eve", eveKey, EVENING_HOUR, text.eveBody(day)],
      ["morn", day.dayKey, MORNING_HOUR, text.mornBody(day)],
    ] as const) {
      const [y, m, d] = key.split("-").map(Number);
      const at = new Date(zonedDayStart(y, m, d, timeZone).getTime() + hour * 3600_000);
      if (at.getTime() <= now.getTime()) continue;
      out.push({ dayKey: day.dayKey, kind, at, body });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}
