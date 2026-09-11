/**
 * 布萨日本地通知的**系统层**（`docs/buddhist-calendar.md` §2.10）。
 *
 * 排哪几条、几点发，是 `./uposatha.ts` 的纯逻辑（自检直接跑它）；这里只负责
 * 权限、Android 渠道、以及把算好的结果交给 `expo-notifications`。
 *
 * **全程离线，不需要任何后端。** 布萨日是算出来的不是查出来的（五套历法都是
 * 纯算法），所以设备自己就能排到任意远的未来；`expo-notifications` 的本地排程
 * 不碰 FCM、不需要 push token、不需要服务器。
 *
 * 每个布萨日排两条：
 *   - **前一天傍晚**（`EVENING_HOUR`）—— 提前一天知道，好安排第二天；
 *   - **当天早上**（`MORNING_HOUR`）—— 当天再提醒一次。
 *
 * 几个刻意的决定：
 *
 * - **不用精确闹钟**。Android 12+ 的 `SCHEDULE_EXACT_ALARM` 在 Play 上架要额外
 *   说明用途，而布萨提醒晚几分钟无所谓，所以走普通通知，也就不申请那个权限。
 *   代价是 Doze 模式下可能推迟一会儿，这是可以接受的。
 * - **排程数量有上限**。iOS 对待发本地通知有 64 条的系统硬限制（超出就丢），
 *   所以只排 `HORIZON` 个布萨日 × 2 条。布萨一月约四次，24 个约管半年，且留了
 *   余量给日后可能加的其他通知。
 * - **每次都先全部取消再重排**。重启后系统是否保留排程、时区变了怎么办、用户
 *   改了历法或观察地怎么办 —— 与其逐条对账，不如无条件重排一遍，成本极低。
 *   这也天然兜住了「Expo 在设备重启后可能丢排程」这个历史问题。
 * - **文案在排程时就定死**。通知是系统投递的，到时候 App 可能没在跑，没法回调
 *   现算文案。所以语言、历法、日名都在排的那一刻写进去，改了语言要重排。
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { MessageKey } from "../i18n";
import type { CalendarSystem } from "./lunar";
import {
  HORIZON,
  plannedNotifications,
  upcomingUposatha,
  type NotifyText,
} from "./uposatha";

/** Android 必须先建通知渠道，否则通知不显示。 */
const CHANNEL_ID = "uposatha";

/**
 * 请求通知权限。
 *
 * 只在用户主动打开开关时调用 —— 启动时静默弹权限框是很差的体验。
 * 已经给过或已经拒过的不再重复请求（`requestPermissionsAsync` 本身幂等，
 * 系统只在第一次真正弹框）。
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Uposatha",
    // DEFAULT 会出声音和横幅但不强插；HIGH 留给真正紧急的事，布萨提醒够不上。
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export interface RescheduleOptions {
  enabled: boolean;
  system: CalendarSystem;
  timeZone: string;
  text: NotifyText;
  /** 注入「现在」，自检用；默认取系统时间。 */
  now?: Date;
}

/**
 * 取消现有排程并重排。返回实际排出去的条数。
 *
 * 关掉开关时传 `enabled: false`，等效于只清空。
 */
export async function rescheduleUposathaNotifications(
  opts: RescheduleOptions,
): Promise<number> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!opts.enabled) return 0;

  const granted = await ensureNotificationPermission();
  if (!granted) return 0;
  await ensureChannel();

  const now = opts.now ?? new Date();
  const days = upcomingUposatha(opts.system, opts.timeZone, now, HORIZON);

  const planned = plannedNotifications(days, opts.timeZone, now, opts.text);
  for (const item of planned) {
    await Notifications.scheduleNotificationAsync({
      content: { title: opts.text.title, body: item.body, data: { dayKey: item.dayKey } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: item.at,
        channelId: CHANNEL_ID,
      },
    });
  }
  return planned.length;
}

/**
 * 按当前界面语言生成通知文案。
 *
 * 单独抽出来是因为排程时要把文案写死（见文件头），调用方拿到 `t` 就能用，
 * 自检里也能塞一个假的 `t` 进去。
 */
export function notifyTextOf(
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): NotifyText {
  return {
    title: t("calendar.notify.title"),
    eveBody: (d) => t("calendar.notify.eve", { label: d.dayLabel || d.dayKey, date: d.dayKey }),
    mornBody: (d) => t("calendar.notify.morn", { label: d.dayLabel || d.dayKey, date: d.dayKey }),
  };
}

/** 当前系统里还挂着多少条待发通知 —— 设置页显示用，也方便真机排查。 */
export async function scheduledCount(): Promise<number> {
  return (await Notifications.getAllScheduledNotificationsAsync()).length;
}
