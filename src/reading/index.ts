/**
 * 阅读链路门面（见 `docs/reading-content.md`）。
 *
 *   用户点书名 → 算阅读单元区间 → 查缓存 → 补缺口 → 拼 HTML
 */
import { loadReadingHistory } from "../data/history";
import { loadParaHtml, loadParasMap } from "./cache";
import { tipitakaRunner } from "./db";
import {
  allReadingUnits,
  firstReadingParagraph,
  nextReadingUnit,
  prevReadingUnit,
  readingUnit,
  readingUnitContaining,
  type ReadingUnit,
} from "./unit";

export type { ReadingUnit, ReadingUnitMode } from "./unit";
export { getCompanionLayers, getChapterLayers } from "./companion";
export {
  channelNames,
  loadParasMap,
  localChannelsFor,
  rememberChannelName,
  type LocalChannel,
} from "./cache";
export {
  WINDOW_STRLEN,
  bookBounds,
  extendWindow,
  initialWindow,
  windowStrlen,
  type ParaWindow,
} from "./window";
export { paragraphLengths } from "./batch";
export { tipitakaRunner } from "./db";
export type { ChapterLayers, LayerChapter } from "./companion";
export type { CompanionChapter, CompanionLayers } from "./companion";
export { READING_UNIT_MAX, READING_UNIT_MIN } from "./unit";
export type { DownloadProgress, DownloadStatus } from "./download";
export {
  downloadBook,
  getDownloadProgress,
  isDownloading,
  listDownloads,
  pauseDownload,
  percent,
} from "./download";
export {
  cacheUsage,
  clearBookCache,
  enforceCacheQuota,
  CACHE_QUOTA_BYTES,
  EMPTY_PARA_TTL_MS,
} from "./cache";

export interface ReadingUnitContent extends ReadingUnit {
  /** 拼好的段落 HTML（空段已剔除）。 */
  html: string;
  /** 停止章节的标题，用作正文标题。 */
  toc: string | null;
}

/**
 * 一本书的阅读起点（`docs/reading-content.md` §5.1）：
 *
 * 1. 调用方指定了段落（目录点击 / 深链接）→ 用它；
 * 2. 读过这本书 → 上次中断的阅读单元起点；
 * 3. 从未读过 → 本书第一个 `level = 1` 章节行。
 */
export async function resolveStartParagraph(
  book: number,
  requested?: number,
): Promise<number | null> {
  if (requested != null) return requested;

  const history = await loadReadingHistory();
  const last = history.find((r) => r.book === book);
  if (last) return last.paragraph;

  return firstReadingParagraph(await tipitakaRunner(), book);
}

/** 算出从 `startPara` 开始的阅读单元（不取正文）。 */
export async function getReadingUnit(
  book: number,
  startPara: number,
): Promise<ReadingUnit | null> {
  return readingUnit(await tipitakaRunner(), book, startPara);
}

/** 包含指定段落的阅读单元（目录点击 / 恢复阅读位置）。 */
export async function getReadingUnitAt(
  book: number,
  paragraph: number,
): Promise<ReadingUnit | null> {
  return readingUnitContaining(await tipitakaRunner(), book, paragraph);
}

/** 上一个 / 下一个阅读单元。到头返回 null。 */
export async function getNextUnit(unit: ReadingUnit): Promise<ReadingUnit | null> {
  return nextReadingUnit(await tipitakaRunner(), unit);
}

export async function getPrevUnit(unit: ReadingUnit): Promise<ReadingUnit | null> {
  return prevReadingUnit(await tipitakaRunner(), unit);
}

/** 一本书的全部阅读单元（目录定位 / 进度换算）。 */
export async function getAllUnits(book: number): Promise<ReadingUnit[]> {
  return allReadingUnits(await tipitakaRunner(), book);
}

/** 取一个阅读单元的正文：先查缓存，只补缺口。 */
export async function getReadingUnitContent(
  unit: ReadingUnit,
  channelId: string,
): Promise<ReadingUnitContent> {
  const html = await loadParaHtml(channelId, unit.book, unit.from, unit.to);
  return { ...unit, html, toc: unit.chapter?.toc ?? null };
}
