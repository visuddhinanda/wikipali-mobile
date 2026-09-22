/**
 * 响应式断点 —— 全 App 唯一数值来源（对应 `docs/README.md` §4.2 / §4.4 / §4.5）。
 *
 * 分档按**窗口宽度**（dp），不按设备类型：分屏、折叠屏、桌面自由窗口、
 * Waydroid 多窗口都会让「设备」与「可用宽度」脱钩。
 * 断档对齐 Material 3 window size class（即 Android 的 sw600dp / sw840dp）。
 */

export type WidthClass = "compact" | "medium" | "expanded" | "large";

/** 各档下界（dp）。compact 为 0 起。 */
export const BREAKPOINTS = {
  medium: 600,
  expanded: 840,
  large: 1200,
} as const;

/** 矮窗口阈值：低于此高度折叠 Hero、Tab 只留图标（§4.2）。 */
export const SHORT_HEIGHT = 480;

/** 单列内容最大宽度；compact 不限宽。 */
export const MAX_CONTENT_WIDTH: Record<WidthClass, number | undefined> = {
  compact: undefined,
  medium: 720,
  expanded: 800,
  large: 840,
};

/** 页面左右外边距。 */
export const GUTTER: Record<WidthClass, number> = {
  compact: 16,
  medium: 24,
  expanded: 32,
  large: 40,
};

/** 卡片型列表的列数；纯文本行列表永远单列（§4.5）。 */
export const CARD_COLUMNS: Record<WidthClass, number> = {
  compact: 1,
  medium: 2,
  expanded: 3,
  large: 4,
};

/** 导航容器形态。 */
export const NAV_KIND: Record<WidthClass, "tabs" | "rail" | "sidebar"> = {
  compact: "tabs",
  medium: "rail",
  expanded: "rail", // 平板横屏把宽度让给正文（§4.3）
  large: "sidebar",
};

/** navigation rail / 常驻侧边栏宽度。 */
export const RAIL_WIDTH = 80;
export const SIDEBAR_WIDTH = 280;

/** list-detail 左侧列表栏宽度（§4.6）。 */
export const LIST_PANE_WIDTH = 320;

/** 阅读区净宽达到该值才允许双列并排对照（每栏 ≥ 420）（§4.7）。 */
export const DUAL_COLUMN_MIN_WIDTH = 1000;

/** 阅读区净宽达到该值，边注从行内折叠升级为右侧 Tufte 边注栏（§4.7）。 */
export const SIDENOTE_MARGIN_MIN_WIDTH = 840;

/** 右侧 Tufte 边注栏宽度。 */
export const SIDENOTE_WIDTH = 200;

/** 由有效宽度得到档位。 */
export function widthClassOf(effectiveWidth: number): WidthClass {
  if (effectiveWidth >= BREAKPOINTS.large) return "large";
  if (effectiveWidth >= BREAKPOINTS.expanded) return "expanded";
  if (effectiveWidth >= BREAKPOINTS.medium) return "medium";
  return "compact";
}
