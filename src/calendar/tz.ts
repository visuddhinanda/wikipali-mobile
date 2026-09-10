/**
 * 时区工具 —— 所有时刻都按**观察地时区**显示，不用手机系统时区。
 *
 * 出行时两者常常不一致（在飞机上尤其明显），而律中的日界是观察地的明相，
 * 跟手机设置无关。这里统一用 `Intl.DateTimeFormat` 取某个 IANA 时区的偏移；
 * Hermes 上 Intl 依赖系统 ICU，取不到时退回设备本地时区，并把降级情况暴露给
 * 调用方（`isZoneSupported`），UI 该说明就说明。
 */

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = PART_FORMATTERS.get(timeZone);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    f.format(new Date());
    PART_FORMATTERS.set(timeZone, f);
    return f;
  } catch {
    return null;
  }
}

export function isZoneSupported(timeZone: string): boolean {
  return formatter(timeZone) !== null;
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** 某个 UTC 瞬间在指定时区的日历字段。 */
export function toLocalParts(at: Date, timeZone: string): LocalParts {
  const f = formatter(timeZone);
  if (!f) {
    return {
      year: at.getFullYear(),
      month: at.getMonth() + 1,
      day: at.getDate(),
      hour: at.getHours(),
      minute: at.getMinutes(),
      second: at.getSeconds(),
    };
  }
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    // Intl 在午夜会给出 hour=24，归一到 0。
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour % 24,
    minute: parts.minute,
    second: parts.second,
  };
}

/** 指定时区在某瞬间的 UTC 偏移（分钟，东为正）。 */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const p = toLocalParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/**
 * 指定时区某个日历日 00:00 对应的 UTC 瞬间。
 *
 * 偏移本身依赖时刻（夏令时），所以先用一次估算的偏移求出近似值，再用近似值
 * 处的真实偏移修正一次 —— 两轮足够，除非该时区正好在这一天的 00:00 切换。
 */
export function zonedDayStart(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = new Date(naive);
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMinutes(guess, timeZone);
    guess = new Date(naive - offset * 60000);
  }
  return guess;
}

/** 该时区当天的正午（天文搜索的锚点用它，离日界最远最稳）。 */
export function zonedNoon(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  return new Date(zonedDayStart(year, month, day, timeZone).getTime() + 12 * 3600_000);
}

/** `2026-09-30` 形式的当地日期键。 */
export function dayKey(at: Date, timeZone: string): string {
  const p = toLocalParts(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function makeDayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `05:34` 形式的当地时刻；`at` 为空时返回 `—`。 */
export function formatLocalTime(at: Date | null, timeZone: string): string {
  if (!at) return "—";
  const p = toLocalParts(at, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** `UTC+6:30` 形式的偏移标签。 */
export function formatOffset(at: Date, timeZone: string): string {
  const m = zoneOffsetMinutes(at, timeZone);
  const sign = m < 0 ? "-" : "+";
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const mm = abs % 60;
  return `UTC${sign}${h}${mm ? ":" + String(mm).padStart(2, "0") : ""}`;
}

/** 设备当前时区；取不到时退回 UTC。 */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    /* 忽略：下面退回 UTC */
  }
  return "UTC";
}

/** 儒略日数（JDN），缅历转换用。`at` 取当地正午避免边界抖动。 */
export function julianDayNumber(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** JDN → 公历年月日。 */
export function fromJulianDayNumber(jdn: number): { year: number; month: number; day: number } {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

/** 某个公历月的天数。 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
