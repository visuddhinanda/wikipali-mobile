/**
 * 天文朔望的公共部分：把一段时间窗里的四相时刻找出来，并按指定时区取日。
 * 天文历、锡兰 Poya、以及所有历法的 Δ 都从这里取基准。
 */
import { nextMoonPhase, moonPhase } from "../astro";
import { dayKey, zonedDayStart, zonedNoon } from "../tz";
import type { MoonPhaseKind } from "./types";

export interface PhaseEvent {
  kind: Exclude<MoonPhaseKind, "none">;
  /** 精确时刻（UTC）。 */
  at: Date;
  /** 按给定时区取日得到的日期键。 */
  dayKey: string;
}

const TARGETS: { angle: number; kind: PhaseEvent["kind"] }[] = [
  { angle: 0, kind: "new" },
  { angle: 90, kind: "firstQuarter" },
  { angle: 180, kind: "full" },
  { angle: 270, kind: "lastQuarter" },
];

/**
 * 求 [from, to) 之间的全部四相时刻。
 *
 * 逐个相位各搜一遍：`SearchMoonPhase` 一次只找一个目标角度，朔望月约 29.53 天，
 * 所以每次搜索窗给 40 天足够跨过一个周期。
 */
export function phaseEvents(from: Date, to: Date, timeZone: string): PhaseEvent[] {
  const out: PhaseEvent[] = [];
  for (const { angle, kind } of TARGETS) {
    let cursor = from;
    for (let guard = 0; guard < 8; guard++) {
      const at = nextMoonPhase(angle, cursor, 40);
      if (!at || at >= to) break;
      out.push({ kind, at, dayKey: dayKey(at, timeZone) });
      cursor = new Date(at.getTime() + 60_000);
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** 覆盖某个公历月并前后各留一周的搜索窗。 */
export function monthWindow(year: number, month: number, timeZone: string) {
  const from = new Date(zonedDayStart(year, month, 1, timeZone).getTime() - 7 * 86400_000);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const to = new Date(zonedDayStart(nextYear, nextMonth, 1, timeZone).getTime() + 7 * 86400_000);
  return { from, to };
}

/** 当地正午的月相角，用于画月相图标。 */
export function phaseAngleAt(year: number, month: number, day: number, timeZone: string): number {
  return moonPhase(zonedNoon(year, month, day, timeZone));
}
