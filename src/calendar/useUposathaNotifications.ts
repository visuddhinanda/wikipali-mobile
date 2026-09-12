/**
 * 启动时重排布萨日通知。
 *
 * 挂在 App 根上跑一次。为什么每次启动都要重排，见
 * `src/calendar/notifications.ts` 的文件头：与其逐条对账（重启后系统是否保留、
 * 时区变没变、历法改没改），不如无条件重排一遍。
 *
 * **不能用 `usePlace()`**：那个 hook 首次挂载时如果没有存过位置就会去问 GPS，
 * 在 App 根上等于一启动就弹定位权限框。这里只需要时区，直接读存下来的位置，
 * 没有就用设备时区。
 */
import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { useI18n } from "../i18n/I18nContext";
import { getUposathaNotify } from "../settings/notifications";
import { defaultSystemFor } from "./lunar";
import { loadSavedPlace } from "./location/place";
import { deviceTimeZone } from "./tz";
import { notifyTextOf, rescheduleUposathaNotifications } from "./notifications";
import { useCalendarSystem } from "./useCalendar";

// App 在前台时收到通知也要显示出来，否则调试时会以为没发。
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function useUposathaNotifications(): void {
  const { t, locale } = useI18n();
  const [system] = useCalendarSystem(defaultSystemFor(locale));

  // locale 进 deps 是必要的：通知文案在排程那一刻就写死了（投递时 App 可能
  // 没在跑，没法回调现算），所以换了界面语言必须重排一遍。
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await getUposathaNotify()) || !alive) return;
      const timeZone = (await loadSavedPlace())?.timeZone ?? deviceTimeZone();
      if (!alive) return;
      await rescheduleUposathaNotifications({
        enabled: true,
        system,
        timeZone,
        text: notifyTextOf(t),
      });
    })();
    return () => {
      alive = false;
    };
  }, [system, locale, t]);
}
