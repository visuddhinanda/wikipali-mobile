/**
 * 阅读器镶边配色（顶栏 / 导航条 / 抽屉 / 底部弹层）。
 *
 * 亮色沿用全局 `colors`；深色为阅读器专用的纸面反色。
 * 全局深色主题仍留给「我 → 设置」阶段接入。
 */
import { colors } from "./index";

export interface ReaderChrome {
  paper: string;
  paperRaised: string;
  paperSunken: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  vermilion: string;
  ochre: string;
  hairline: string;
  border: string;
  backdrop: string;
}

const LIGHT: ReaderChrome = {
  paper: colors.paper,
  paperRaised: colors.paperRaised,
  paperSunken: colors.paperSunken,
  ink: colors.ink,
  inkSoft: colors.inkSoft,
  inkFaint: colors.inkFaint,
  vermilion: colors.vermilion,
  ochre: colors.ochre,
  hairline: colors.hairline,
  border: colors.border,
  backdrop: "rgba(0,0,0,0.35)",
};

const DARK: ReaderChrome = {
  paper: "#211d17",
  paperRaised: "#2a251d",
  paperSunken: "#181511",
  ink: "#e8dfd0",
  inkSoft: "#bfb198",
  inkFaint: "#8f8166",
  vermilion: "#d17a67",
  ochre: "#c9924a",
  hairline: "#3a3227",
  border: "#4a4030",
  backdrop: "rgba(0,0,0,0.5)",
};

export function readerColors(dark: boolean): ReaderChrome {
  return dark ? DARK : LIGHT;
}

/**
 * 阅读器背景预设（纸白 / 米黄护眼 / 浅灰 / 夜间）。
 *
 * 前三个共用亮色 chrome（墨色、朱砂、线色不变），只换纸面色；
 * 夜间单独一套深色 chrome（见 `docs/reader-settings.md` §4.4.2）。
 */
export type ReaderBackground = "paper" | "sepia" | "gray" | "dark";

export const READER_BACKGROUND_PAPER: Record<ReaderBackground, string> = {
  paper: "#f7f3ea", // 现有亮色纸面
  sepia: "#f0e6cf", // 米黄护眼
  gray: "#e8e6e1", // 中性浅灰
  dark: "#211d17", // 夜间（同 DARK.paper）
};

export function readerColorsFor(background: ReaderBackground): ReaderChrome {
  const dark = background === "dark";
  const chrome = dark ? DARK : LIGHT;
  return { ...chrome, paper: READER_BACKGROUND_PAPER[background] };
}
