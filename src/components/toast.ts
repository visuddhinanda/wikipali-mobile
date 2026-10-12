/**
 * 轻提示：Android 用系统 Toast；iOS 没有原生 Toast，暂不提示（操作结果在页面上可见）。
 */
import { Platform, ToastAndroid } from "react-native";

export function toast(message: string): void {
  if (Platform.OS === "android") ToastAndroid.show(message, ToastAndroid.SHORT);
}
