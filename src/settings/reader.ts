/**
 * 阅读器偏好（字号 / 背景 / 亮度 / 排版 / 注释），持久化到 AsyncStorage。
 *
 * 背景只作用于阅读器（WebView 正文 CSS + 阅读器镶边/抽屉配色），
 * 全局深色主题仍留给「我 → 设置」阶段接入。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  TARGET_SCRIPTS,
  type PaliScriptPreference,
} from "../pali/script";
import type { ReaderBackground } from "../theme/reader";

export type ReaderFontSize = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
/** 手机注释呈现方式：行内（角标 + 行内展开）或 段后（段落脚注列表）。 */
export type AnnotationMode = "inline" | "footnote";
/** 正文行距。 */
export type ReaderLineHeight = "compact" | "standard" | "loose";
/** 正文左右页边距。 */
export type ReaderPageMargin = "narrow" | "standard" | "wide";
/** 亮度模式：跟随系统 或 应用内手动压暗。 */
export type ReaderBrightnessMode = "system" | "app";

export interface ReaderFontOption {
  id: ReaderFontSize;
  px: number;
}

/**
 * WebView 里的 CSS px 与 RN 的 dp 一一对应（viewport 是 width=device-width,
 * initial-scale=1），所以这里的数字可以直接和界面字号比。六档覆盖 11–21，
 * 默认「md」对齐到 15（正文比界面略大一号，阅读更舒适）。
 */
export const FONT_OPTIONS: ReaderFontOption[] = [
  { id: "xs", px: 11 },
  { id: "sm", px: 13 },
  { id: "md", px: 15 },
  { id: "lg", px: 17 },
  { id: "xl", px: 19 },
  { id: "xxl", px: 21 },
];

export function fontSizePx(id: ReaderFontSize): number {
  return FONT_OPTIONS.find((f) => f.id === id)?.px ?? 15;
}

/** 行距档位 → 正文 CSS `line-height`（注释区按比例略缩）。 */
export const LINE_HEIGHT_VALUES: Record<ReaderLineHeight, number> = {
  compact: 1.7,
  standard: 1.95,
  loose: 2.2,
};

/** 页边距档位 → 正文左右 padding（px）。 */
export const PAGE_MARGIN_VALUES: Record<ReaderPageMargin, number> = {
  narrow: 10,
  standard: 18,
  wide: 28,
};

export interface ReaderSettings {
  /** 阅读器背景预设（纸白/米黄/浅灰/夜间），夜间即深色主题。 */
  background: ReaderBackground;
  fontSize: ReaderFontSize;
  /** 巴利原文用哪种字体显示；`auto` = 跟随界面语言（见 `src/pali/script`）。 */
  paliScript: PaliScriptPreference;
  /** 段落脚注默认收起行数（≥1）。 */
  annotationCollapsedLines: number;
  /** 手机注释呈现方式：行内 / 段后。 */
  annotationMode: AnnotationMode;
  /** 阅读时保持屏幕常亮（`expo-keep-awake`），默认开。 */
  keepAwake: boolean;
  /** 亮度模式：跟随系统 / 应用内手动。 */
  brightnessMode: ReaderBrightnessMode;
  /** 应用内亮度（0.3–1），仅 `brightnessMode === "app"` 时生效。 */
  brightness: number;
  /** 正文行距。 */
  lineHeight: ReaderLineHeight;
  /** 正文左右页边距。 */
  pageMargin: ReaderPageMargin;
  /** 冷启动时是否自动回到上次的阅读页与阅读位置（见 useRestoreLastReading）。 */
  restoreLastReading: boolean;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  background: "paper",
  fontSize: "md",
  paliScript: "auto",
  annotationCollapsedLines: 1,
  annotationMode: "inline",
  keepAwake: true,
  brightnessMode: "app",
  brightness: 1,
  lineHeight: "standard",
  pageMargin: "standard",
  restoreLastReading: true,
};

const KEY = "@wikipali/reader-settings";

const FONT_IDS: readonly ReaderFontSize[] = [
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "xxl",
];

function isPaliScript(v: unknown): v is PaliScriptPreference {
  return v === "auto" || TARGET_SCRIPTS.includes(v as never);
}

function isBackground(v: unknown): v is ReaderBackground {
  return v === "paper" || v === "sepia" || v === "gray" || v === "dark";
}

function isLineHeight(v: unknown): v is ReaderLineHeight {
  return v === "compact" || v === "standard" || v === "loose";
}

function isPageMargin(v: unknown): v is ReaderPageMargin {
  return v === "narrow" || v === "standard" || v === "wide";
}

/**
 * 旧版本只存了 `theme: "light" | "dark"`，读入时迁移到 `background`：
 * dark → "dark"，其余 → "paper"。
 */
type LegacyParsed = Partial<ReaderSettings> & { theme?: unknown };

export async function loadReaderSettings(): Promise<ReaderSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    const parsed = JSON.parse(raw) as LegacyParsed;
    return {
      background: isBackground(parsed.background)
        ? parsed.background
        : parsed.theme === "dark"
          ? "dark"
          : "paper",
      fontSize: FONT_IDS.includes(parsed.fontSize as ReaderFontSize)
        ? (parsed.fontSize as ReaderFontSize)
        : "md",
      paliScript: isPaliScript(parsed.paliScript) ? parsed.paliScript : "auto",
      annotationCollapsedLines:
        typeof parsed.annotationCollapsedLines === "number" &&
        parsed.annotationCollapsedLines >= 1
          ? Math.round(parsed.annotationCollapsedLines)
          : 1,
      annotationMode:
        parsed.annotationMode === "footnote" ? "footnote" : "inline",
      keepAwake: parsed.keepAwake !== false,
      brightnessMode:
        parsed.brightnessMode === "system" ? "system" : "app",
      brightness:
        typeof parsed.brightness === "number" &&
        parsed.brightness >= 0.3 &&
        parsed.brightness <= 1
          ? parsed.brightness
          : 1,
      lineHeight: isLineHeight(parsed.lineHeight)
        ? parsed.lineHeight
        : "standard",
      pageMargin: isPageMargin(parsed.pageMargin)
        ? parsed.pageMargin
        : "standard",
      restoreLastReading: parsed.restoreLastReading !== false,
    };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export async function saveReaderSettings(s: ReaderSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}
