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

export const FONT_OPTIONS: ReaderFontOption[] = [
  { id: "sm", labelKey: "reader.size.sm", px: 15 },
  { id: "md", labelKey: "reader.size.md", px: 18 },
  { id: "lg", labelKey: "reader.size.lg", px: 21 },
  { id: "xl", labelKey: "reader.size.xl", px: 24 },
];

export function fontSizePx(id: ReaderFontSize): number {
  return FONT_OPTIONS.find((f) => f.id === id)?.px ?? 18;
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
