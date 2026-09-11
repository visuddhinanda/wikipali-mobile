/**
 * 布萨日提醒的开关（持久化到 AsyncStorage）。
 *
 * 只存「开 / 关」一个布尔值：提醒时刻是固定的（前一天傍晚 + 当天早上，见
 * `src/calendar/notifications.ts`），暂不做成可配置 —— 先把功能立住，真有人
 * 要自定义时刻再加。
 *
 * 默认**关**。通知是打扰，不能装上就自己开；而且 Android 13+ 要运行时权限，
 * 静默地在启动时弹权限框是很差的体验，必须由用户主动打开开关时才请求。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@wikipali/uposatha-notify";

export async function getUposathaNotify(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setUposathaNotify(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // 存不进去不该让开关失灵：这一次的排程已经做了，下次启动恢复成默认而已。
  }
}
