import { useKeepAwake } from "expo-keep-awake";

/**
 * 无 UI 的「保持屏幕常亮」组件：挂载即常亮、卸载自动释放。
 *
 * 用条件挂载按状态开关：`{cond && <KeepAwake />}` —— cond 为真时常亮，
 * 为假或页面退出（卸载）时自动恢复系统熄屏。阅读页（设置里的「屏幕常亮」）
 * 与 AI 对话页（`isRunning` 生成期间）都这样用。
 *
 * `suppressDeactivateWarnings` 抑制 Android 上 Activity 已销毁时
 * `deactivateKeepAwake` 抛出的 unhandled rejection（见 expo-keep-awake 文档）。
 */
export function KeepAwake() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  return null;
}
