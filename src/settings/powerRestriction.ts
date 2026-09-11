/**
 * 「这台设备会不会把后台提醒推迟掉」的判断。
 *
 * 起因是真机实测：小米 2304FPN6DC 上把布萨通知排好之后，`dumpsys alarm` 显示
 * 闹钟确实登记了、时刻也分毫不差，但最终生效时间被系统改成了**三天后**：
 *
 *     tag=*walarm*:expo.modules.notifications.NOTIFICATION_EVENT
 *     origWhen=2026-09-24 20:00:00.000   window=+1h
 *     policyWhenElapsed: requester=+13d10h33m  ...  power_pending=+16d10h33m
 *     whenElapsed=+16d10h33m            ← 最终按这个发
 *
 * `power_pending` 是 MIUI 自家省电框架加的，**不是 AOSP 的策略**：把应用调到
 * `active` standby bucket、加进 doze 白名单都清不掉它，`appops` 里也没有对应的
 * op。只能由用户在系统设置里把该应用的省电策略改成「无限制」。
 *
 * 所以代码层面无解，只能**明说**。这件事比 iOS 的 64 条上限严重得多：那个只是
 * 排不了太远，这个是提醒直接迟到几天，而且**失败得很安静** —— 用户不会知道。
 *
 * 判断靠厂商名单而不是去探测实际限制：Android 没有公开 API 能查「我的闹钟会不会
 * 被推迟」（`isIgnoringBatteryOptimizations` 只覆盖 AOSP 的 doze，查不到 MIUI 这
 * 一层）。名单宁可宽一点 —— 多提示一句的代价，远小于提醒静默失效。
 */
import { Linking, Platform } from "react-native";

/**
 * 后台限制激进、默认会推迟闹钟的厂商。
 *
 * 名单参考社区长期维护的 dontkillmyapp.com 分类，取其中限制最重的几家。
 */
const AGGRESSIVE = [
  "xiaomi",
  "redmi",
  "poco",
  "huawei",
  "honor",
  "oppo",
  "realme",
  "oneplus",
  "vivo",
  "iqoo",
  "meizu",
  "samsung",
  "asus",
  "letv",
  "zte",
  "nubia",
  "tecno",
  "infinix",
];

export function hasAggressivePowerManagement(): boolean {
  if (Platform.OS !== "android") return false;
  const { Manufacturer = "", Brand = "" } = Platform.constants as {
    Manufacturer?: string;
    Brand?: string;
  };
  const id = `${Manufacturer} ${Brand}`.toLowerCase();
  return AGGRESSIVE.some((vendor) => id.includes(vendor));
}

/**
 * 打开本应用的系统设置页（`ACTION_APPLICATION_DETAILS_SETTINGS`）。
 *
 * 各家 ROM 把「省电策略 / 自启动」藏在不同层级，没法直接深链到那一项，
 * 但都能从应用详情页点进去，这已经是能做到的最近一步。
 */
export async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
}
