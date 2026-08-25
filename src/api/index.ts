/**
 * API 门面：先走真实后端（「我 → 设置 → API 服务器」或 .env 覆盖），
 * 请求失败（离线 / 域名不可达）时回退 mock，保证 UI 始终可走通。
 * 上层（屏幕组件）只依赖这个模块，不感知真实 / mock 差异。
 *
 * 书籍列表不走这里：书目标题已内嵌（`src/catalog/book-titles.json`），
 * 由 `src/catalog` 的 `getBooksByTags` 按目录 tag 直接过滤。
 */
import type {
  ChapterChannel,
  ChapterContent,
  TipitakaChapter,
  TocItem,
} from "../catalog";
import {
  fetchBookChannels,
  fetchChapterByChannel,
  fetchChapterContent,
  fetchChapterToc,
} from "./catalog";
import {
  mockGetChapterByChannel,
  mockGetChapterContent,
  mockGetChapterToc,
} from "./mock";
import { ApiError } from "./client";

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

export async function getChapterContent(
  book: number,
  paragraph: number,
): Promise<ChapterContent> {
  try {
    return await fetchChapterContent(book, paragraph);
  } catch {
    return mockGetChapterContent(book, paragraph);
  }
}

/**
 * 通过「书-段落_频道」读取章节正文。
 * 仅「网络/离线」故障回退 mock；服务端明确报错（HTTP 错误、无该频道索引）如实抛出，
 * 避免把 mock 经文当成真实译文展示。
 */
export async function getChapterByChannel(
  book: number,
  paragraph: number,
  channelId: string,
): Promise<TipitakaChapter> {
  try {
    return await fetchChapterByChannel(book, paragraph, channelId);
  } catch (err) {
    if (err instanceof ApiError && err.status === undefined) {
      return mockGetChapterByChannel(book, paragraph, channelId);
    }
    if (err instanceof Error && /no such index/i.test(err.message)) {
      throw new Error("该版本暂无此章节的在线阅读内容");
    }
    throw err;
  }
}
