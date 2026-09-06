/**
 * API 门面：先走真实后端（「我 → 设置 → API 服务器」或 .env 覆盖），
 * 请求失败（离线 / 域名不可达）时回退 mock，保证 UI 始终可走通。
 * 上层（屏幕组件）只依赖这个模块，不感知真实 / mock 差异。
 *
 * 书籍列表不走这里：书目标题已内嵌（`src/catalog/book-titles.json`），
 * 由 `src/catalog` 的 `getBooksByTags` 按目录 tag 直接过滤。
 *
 * 阅读正文也不走这里：它要先算阅读单元、再查本地缓存，只补缺口，
 * 见 `src/reading`（`docs/reading-content.md`）。
 */
import type { ChapterChannel, TocItem } from "../catalog";
import { fetchBookChannels, fetchChapterToc } from "./catalog";
import { mockGetChapterToc } from "./mock";

/** 一本书可读的版本/频道列表（原文 + 各译文/逐词版本）。 */
export async function getBookChannels(
  book: number,
  paragraph: number,
): Promise<ChapterChannel[]> {
  return fetchBookChannels(book, paragraph);
}

export async function getChapterToc(
  book: number,
  paragraph: number,
): Promise<TocItem[]> {
  try {
    return await fetchChapterToc(book, paragraph);
  } catch {
    return mockGetChapterToc(book);
  }
}
