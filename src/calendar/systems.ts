/** 历法的标题与一句出处 —— 月历卡片与历法选择页共用同一份。 */
import type { MessageKey } from "../i18n";
import type { CalendarSystem } from "./lunar";

export const SYSTEM_TITLE_KEYS: Record<CalendarSystem, MessageKey> = {
  astro: "calendar.system.astro",
  myanmar: "calendar.system.myanmar",
  srilanka: "calendar.system.srilanka",
  thai: "calendar.system.thai",
  chinese: "calendar.system.chinese",
};

export const SYSTEM_DESC_KEYS: Record<CalendarSystem, MessageKey> = {
  astro: "calendar.system.astro.desc",
  myanmar: "calendar.system.myanmar.desc",
  srilanka: "calendar.system.srilanka.desc",
  thai: "calendar.system.thai.desc",
  chinese: "calendar.system.chinese.desc",
};
