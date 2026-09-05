/**
 * 响应式布局唯一入口（`DESIGN.md` §4.9）。
 *
 * 页面只读本 hook，不自行比较像素宽度；断点数值集中在 `theme/breakpoints`。
 * 一律基于 `useWindowDimensions()` —— `Dimensions.get('window')` 的一次性取值
 * 在分屏 / 自由窗口下会返回过期尺寸。
 */
import { useWindowDimensions } from "react-native";
import {
  CARD_COLUMNS,
  DUAL_COLUMN_MIN_WIDTH,
  GUTTER,
  LIST_PANE_WIDTH,
  MAX_CONTENT_WIDTH,
  NAV_KIND,
  RAIL_WIDTH,
  SHORT_HEIGHT,
  SIDEBAR_WIDTH,
  widthClassOf,
  type WidthClass,
} from "../theme/breakpoints";

export interface Layout {
  width: number;
  height: number;
  /** 分档所用的有效宽度：原始宽度 ÷ 系统字号倍率（§4.2 无障碍修正）。 */
  effectiveWidth: number;
  widthClass: WidthClass;
  isCompact: boolean;
  /** medium 及以上：底部 Tab 让位给 rail / 侧边栏。 */
  isWide: boolean;
  /** 矮窗口：折叠 Hero、Tab 只留图标。 */
  isShort: boolean;
  navKind: "tabs" | "rail" | "sidebar";
  /** 导航容器占用的宽度（tabs 时为 0）。 */
  navWidth: number;
  /** 单列内容最大宽度；compact 为 undefined（不限宽）。 */
  maxContentWidth?: number;
  gutter: number;
  /** 单列内容区净宽（已扣掉导航容器与左右外边距，并受限宽约束）。 */
  contentWidth: number;
  cardColumns: number;
  /** 卡片网格中单张卡片的宽度（按 cardColumns 与间距均分）。 */
  cardWidth: (gap: number, columns?: number) => number;
  /** expanded 及以上启用 list-detail 双栏（§4.6）。 */
  listDetail: boolean;
  listPaneWidth: number;
  /**
   * 阅读区净宽是否够双列并排对照。按可用宽度判断，不按档位硬编码（§4.7）。
   * @param readerWidth 阅读区实际净宽（onLayout 测得）
   */
  canDualColumn: (readerWidth: number) => boolean;
}

export function useLayout(): Layout {
  const { width, height, fontScale } = useWindowDimensions();

  const effectiveWidth = width / Math.max(1, fontScale);
  const widthClass = widthClassOf(effectiveWidth);
  const navKind = NAV_KIND[widthClass];
  const navWidth =
    navKind === "rail" ? RAIL_WIDTH : navKind === "sidebar" ? SIDEBAR_WIDTH : 0;
  const gutter = GUTTER[widthClass];
  const maxContentWidth = MAX_CONTENT_WIDTH[widthClass];
  const available = width - navWidth - gutter * 2;
  const contentWidth = Math.max(
    0,
    maxContentWidth ? Math.min(available, maxContentWidth) : available,
  );

  return {
    width,
    height,
    effectiveWidth,
    widthClass,
    isCompact: widthClass === "compact",
    isWide: widthClass !== "compact",
    isShort: height < SHORT_HEIGHT,
    navKind,
    navWidth,
    maxContentWidth,
    gutter,
    contentWidth,
    cardColumns: CARD_COLUMNS[widthClass],
    cardWidth: (gap: number, columns = CARD_COLUMNS[widthClass]) =>
      Math.floor((contentWidth - gap * (columns - 1)) / columns),
    listDetail: widthClass === "expanded" || widthClass === "large",
    listPaneWidth: LIST_PANE_WIDTH,
    canDualColumn: (readerWidth: number) => readerWidth >= DUAL_COLUMN_MIN_WIDTH,
  };
}
