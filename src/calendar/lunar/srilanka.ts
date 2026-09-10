/**
 * 斯里兰卡 Poya（§2.7）。
 *
 * 锡兰不用算术历，直接用天文朔望，按 **madhyāhna（正午）规则**取日：
 * 相位时刻在科伦坡正午之后 → 当日；在正午之前 → 前一日。
 *
 * 官方 Poya 由佛教事务部按年公报颁布，个别年份会有决议微调，UI 要标注
 * 「按天文规则推算，以公报为准」。
 */
import type { MessageKey } from "../../i18n";
import { daysInMonth, makeDayKey, toLocalParts, zonedDayStart } from "../tz";
import { monthWindow, phaseAngleAt, phaseEvents } from "./phase";
import type { LunarDay, LunarMonth, MonthRequest, MoonPhaseKind } from "./types";

const COLOMBO = "Asia/Colombo";
const DAY = 86400_000;

/** 十二个满月各有专名；闰（adhi）月的年份沿用公报名，这里按公历月给名。 */
const POYA_NAMES = [
  "Duruthu", "Navam", "Medin", "Bak", "Vesak", "Poson",
  "Esala", "Nikini", "Binara", "Vap", "Il", "Unduvap",
];

/** 正午规则：相位时刻早于科伦坡当天正午，就算前一天。 */
function madhyahnaDayKey(at: Date): string {
  const p = toLocalParts(at, COLOMBO);
  const noon = zonedDayStart(p.year, p.month, p.day, COLOMBO).getTime() + 12 * 3600_000;
  const target = at.getTime() < noon ? new Date(at.getTime() - DAY) : at;
  const q = toLocalParts(target, COLOMBO);
  return makeDayKey(q.year, q.month, q.day);
}

export function sriLankaMonth({ year, month, timeZone }: MonthRequest): LunarMonth {
  const { from, to } = monthWindow(year, month, COLOMBO);
  const events = phaseEvents(from, to, COLOMBO).map((e) => ({
    ...e,
    dayKey: madhyahnaDayKey(e.at),
  }));

  const out: LunarMonth = new Map();
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const key = makeDayKey(year, month, day);
    const hit = events.find((e) => e.dayKey === key);
    const phase: MoonPhaseKind = hit ? hit.kind : "none";
    const festivalKeys: MessageKey[] = [];
    if (phase === "full" && month === 5) festivalKeys.push("calendar.festival.vesakLocal");
    if (phase === "full" && month === 7) festivalKeys.push("calendar.festival.vassaStart");
    if (phase === "full" && month === 10) festivalKeys.push("calendar.festival.pavarana");

    out.set(key, {
      system: "srilanka",
      dayKey: key,
      // 格子只放专名（Binara），「Poya」由 UI 在标题与详情里补 —— 一格 1/7 屏宽，塞不下。
      dayLabel: phase === "full" ? POYA_NAMES[month - 1] : "",
      half: "waxing",
      fortnightDay: 0,
      monthName: phase === "full" ? POYA_NAMES[month - 1] : "",
      monthNumber: 0,
      leapMonth: false,
      repeatedMonth: false,
      dayOfMonth: 0,
      era: "",
      phase,
      phaseAngle: phaseAngleAt(year, month, day, timeZone),
      isUposatha: Boolean(hit),
      festivalKeys,
      deltaDays: 0,
    });
  }
  return out;
}
