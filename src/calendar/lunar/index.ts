/**
 * 五套历法的统一入口。
 *
 * 各历法自己只管本历法的记法；这里补两件跨历法的事：
 * - **国际卫塞节**（§2.8）：五月第一个望，不随历法切换；
 * - **Δ**：与天文朔望的取日差，用来在日详情里并排说明分歧。
 */
import type { Locale } from "../../i18n";
import { astronomicalMonth, astronomicalPhaseDays } from "./astronomical";
import { chineseMonth } from "./chinese";
import { myanmarMonth } from "./myanmar";
import { sriLankaMonth } from "./srilanka";
import { thaiMonth } from "./thai";
import { unVesakDayKey } from "./vesak";
import type { CalendarSystem, LunarMonth, MonthRequest } from "./types";

export * from "./types";
export { unVesakDayKey } from "./vesak";
export { jdnToMyanmar, sasanaYear } from "./myanmar";

/** 目前五套都能算；留着这个列表是为了将来某套历法要临时下线时 UI 有地方读。 */
export const UNAVAILABLE_SYSTEMS: CalendarSystem[] = [];

export function isSystemAvailable(system: CalendarSystem): boolean {
  return !UNAVAILABLE_SYSTEMS.includes(system);
}

const DAY = 86400_000;

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

const BUILDERS: Record<CalendarSystem, (req: MonthRequest) => LunarMonth> = {
  astro: astronomicalMonth,
  chinese: chineseMonth,
  myanmar: myanmarMonth,
  srilanka: sriLankaMonth,
  thai: thaiMonth,
};

/** 某历法在某个公历月的推算结果，已补好卫塞节标识与 Δ。 */
export function buildMonth(system: CalendarSystem, req: MonthRequest): LunarMonth {
  const month = BUILDERS[system](req);
  if (month.size === 0) return month;

  // 国际卫塞节：只在五月出现，但月历会跨月显示，按当年算一次即可。
  const vesakKey = req.month === 5 ? unVesakDayKey(req.year, req.timeZone) : null;

  // Δ：把本历法的四相日与天文四相日对齐，差几天就是几天。
  const astroEvents = astronomicalPhaseDays(req.year, req.month, req.timeZone);

  for (const day of month.values()) {
    if (vesakKey && day.dayKey === vesakKey) {
      day.festivalKeys = ["calendar.festival.unVesak", ...day.festivalKeys];
    }
    if (system !== "astro" && day.phase !== "none") {
      const same = astroEvents.filter((e) => e.kind === day.phase);
      if (same.length) {
        const n = dayNumber(day.dayKey);
        day.deltaDays = same
          .map((e) => n - dayNumber(e.dayKey))
          .reduce((best, d) => (Math.abs(d) < Math.abs(best) ? d : best));
      }
    }
  }
  return month;
}

/**
 * 默认历法跟随界面语言（与巴利字体的 `auto` 策略一致，`docs/pali-script.md` §3.1）。
 * 泰语暂时落到天文历 —— 泰历还没接入。
 */
export function defaultSystemFor(locale: Locale): CalendarSystem {
  switch (locale) {
    case "my":
      return "myanmar";
    case "si":
      return "srilanka";
    case "th":
      return "thai";
    case "zh-Hans":
    case "zh-Hant":
      return "chinese";
    default:
      return "astro";
  }
}
