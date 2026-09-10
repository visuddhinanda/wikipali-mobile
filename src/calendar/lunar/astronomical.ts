/**
 * 天文朔望历（§2.3）—— 直接用真朔望时刻，按**观察地时区**取日。
 *
 * 它是中性基准：其余四套历法的 Δ 都以它为参照。
 */
import { daysInMonth, makeDayKey } from "../tz";
import { monthWindow, phaseAngleAt, phaseEvents, type PhaseEvent } from "./phase";
import type { LunarDay, LunarMonth, MonthRequest } from "./types";

const DAY = 86400_000;

/** 半月起点：朔为上半月之始，望为下半月之始。 */
function anchorsOf(events: PhaseEvent[]): PhaseEvent[] {
  return events.filter((e) => e.kind === "new" || e.kind === "full");
}

function dayIndex(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

export function astronomicalMonth({ year, month, timeZone }: MonthRequest): LunarMonth {
  const { from, to } = monthWindow(year, month, timeZone);
  const events = phaseEvents(from, to, timeZone);
  const anchors = anchorsOf(events);
  const out: LunarMonth = new Map();

  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const key = makeDayKey(year, month, day);
    const idx = dayIndex(key);

    // 找该日之前（含当日）最近的一个朔或望，半月内的第几日由它数起。
    let anchor: PhaseEvent | undefined;
    for (const a of anchors) {
      if (dayIndex(a.dayKey) <= idx) anchor = a;
      else break;
    }

    const hit = events.find((e) => e.dayKey === key);
    const half: LunarDay["half"] =
      anchor && anchor.kind === "full" ? "waning" : "waxing";
    const fortnightDay = anchor ? idx - dayIndex(anchor.dayKey) + 1 : 0;

    out.set(key, {
      system: "astro",
      dayKey: key,
      dayLabel: "",
      half,
      fortnightDay,
      monthName: "",
      monthNumber: 0,
      leapMonth: false,
      repeatedMonth: false,
      dayOfMonth: 0,
      era: "",
      phase: hit ? hit.kind : "none",
      phaseAngle: phaseAngleAt(year, month, day, timeZone),
      isUposatha: Boolean(hit),
      festivalKeys: [],
      deltaDays: 0,
    });
  }
  return out;
}

/** 天文历里这一天是不是某个四相日（Δ 计算与卫塞节判定都要用）。 */
export function astronomicalPhaseDays(
  year: number,
  month: number,
  timeZone: string,
): PhaseEvent[] {
  const { from, to } = monthWindow(year, month, timeZone);
  return phaseEvents(from, to, timeZone);
}
