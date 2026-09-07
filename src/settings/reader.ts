/**
 * 阅读器偏好（字号 + 主题），持久化到 AsyncStorage。
 *
 * 主题目前只作用于阅读器（WebView 正文 CSS + 阅读器镶边/抽屉配色），
 * 全局深色主题仍留给「我 → 设置」阶段接入。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MessageKey } from "../i18n";

export type ReaderTheme = "light" | "dark";
export type ReaderFontSize = "sm" | "md" | "lg" | "xl";

export interface ReaderFontOption {
  id: ReaderFontSize;
  labelKey: MessageKey;
  px: number;
}

/**
 * WebView 里的 CSS px 与 RN 的 dp 一一对应（viewport 是 width=device-width,
 * initial-scale=1），所以这里的数字可以直接和界面字号比：阅读页导航按钮
 * （上一章/下一章/版本）是 12，「就此段落提问」是 13 —— 「标准」对齐到 13。
 */
export const FONT_OPTIONS: ReaderFontOption[] = [
  { id: "sm", labelKey: "reader.size.sm", px: 11 },
  { id: "md", labelKey: "reader.size.md", px: 13 },
  { id: "lg", labelKey: "reader.size.lg", px: 16 },
  { id: "xl", labelKey: "reader.size.xl", px: 19 },
];

export function fontSizePx(id: ReaderFontSize): number {
  return FONT_OPTIONS.find((f) => f.id === id)?.px ?? 13;
}

export interface ReaderSettings {
  theme: ReaderTheme;
  fontSize: ReaderFontSize;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "light",
  fontSize: "md",
};

const KEY = "@wikipali/reader-settings";

const FONT_IDS: readonly ReaderFontSize[] = ["sm", "md", "lg", "xl"];

export async function loadReaderSettings(): Promise<ReaderSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      theme: parsed.theme === "dark" ? "dark" : "light",
      fontSize: FONT_IDS.includes(parsed.fontSize as ReaderFontSize)
        ? (parsed.fontSize as ReaderFontSize)
        : "md",
    };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export async function saveReaderSettings(s: ReaderSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}
