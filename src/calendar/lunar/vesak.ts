/**
 * 国际卫塞节（§2.8）—— 联合国大会第 54/115 号决议：**五月第一个月圆日**。
 *
 * 它**不随历法切换**：缅历 Kason 满月、泰国 Visakha Bucha、锡兰 Vesak Poya
 * 是各自历法里的卫塞，闰年会落到六月；这里只认公历五月的第一个望。两者不
 * 一致时同时显示，不合并。
 */
import { nextMoonPhase } from "../astro";
import { dayKey, zonedDayStart } from "../tz";

/**
 * 某年国际卫塞节的日期键（按观察地时区取日）。
 *
 * 朔望月 29.53 天 < 31 天，五月必然含至少一个望，搜索必有解。
 */
export function unVesakDayKey(year: number, timeZone: string): string | null {
  const mayFirst = zonedDayStart(year, 5, 1, timeZone);
  const at = nextMoonPhase(180, mayFirst, 31);
  return at ? dayKey(at, timeZone) : null;
}
