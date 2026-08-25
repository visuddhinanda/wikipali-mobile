/**
 * 全局主题 —— 传统庄重 / 古籍感 / 暖色调米黄纸感。
 *
 * P0 只提供亮色主题；深色主题留给「我 → 设置」阶段接入。
 */
import { Platform } from "react-native";

export const colors = {
  // 纸面
  paper: "#f7f3ea", // 页面底色（沿用现有 App 底色）
  paperRaised: "#fdfaf1", // 卡片 / 浮层
  paperSunken: "#efe8d8", // 凹陷 / 输入框底
  // 墨色
  ink: "#3a3128", // 主文字
  inkSoft: "#6b5f4e", // 次文字
  inkFaint: "#9a8c76", // 弱文字 / 占位
  // 朱砂 / 赭石（佛典主色）
  vermilion: "#8c3b2e",
  ochre: "#a06b2c",
  gold: "#b8860b",
  // 线
  hairline: "#e4dbc6",
  border: "#d8cdb4",
  // 语义
  success: "#4a7c59",
  danger: "#9c3b32",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
};

export const type = {
  title: { fontSize: 22, fontWeight: "700" as const, color: colors.ink },
  heading: { fontSize: 17, fontWeight: "600" as const, color: colors.ink },
  body: { fontSize: 16, lineHeight: 24, color: colors.ink },
  caption: { fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  small: { fontSize: 12, lineHeight: 16, color: colors.inkFaint },
};

export const serifFont = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "serif",
});

/** 页面统一的阴影（卡片轻浮感，克制使用） */
export const cardShadow = Platform.select({
  ios: {
    shadowColor: "#8a7a5a",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
  },
  android: {
    elevation: 1,
  },
  default: {},
});
