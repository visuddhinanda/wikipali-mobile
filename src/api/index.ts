/**
 * API 门面：上层（屏幕组件）只依赖这个模块，不感知具体后端客户端。
 *
 * 书籍列表不走这里：书目标题已内嵌（`src/catalog/book-titles.json`），
 * 由 `src/catalog` 的 `getBooksByTags` 按目录 tag 直接过滤。
 *
 * 阅读正文也不走这里：它要先算阅读单元、再查本地缓存，只补缺口，
 * 见 `src/reading`（`docs/reading-content.md`）。
 */
import type { ChapterChannel } from "../catalog";
import {
  fetchBookChannels,
  fetchParagraphChannels,
  fetchSystemChannels,
  type ParagraphChannel,
} from "./catalog";

export type { ParagraphChannel };

/** 某一段有内容的版本（按段精确，带版本最后更新时间）。 */
export function getParagraphChannels(
  book: number,
  paragraph: number,
): Promise<ParagraphChannel[]> {
  return fetchParagraphChannels(book, paragraph);
}

/** 系统版本列表（按名字找 `_System_Pali_VRI_` 等系统版本的 uid）。 */
export function getSystemChannels(): Promise<ParagraphChannel[]> {
  return fetchSystemChannels();
}

/** 一本书可读的版本/频道列表（原文 + 各译文/逐词版本）。 */
export async function getBookChannels(
  book: number,
  paragraph: number,
): Promise<ChapterChannel[]> {
  return fetchBookChannels(book, paragraph);
}
