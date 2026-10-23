/**
 * 真实后端客户端（mint api-v13）。
 *
 * 响应统一是 `{ ok, data, message }` 信封（见 mint `Controller::ok/error`）。
 * 已迁移到 openapi-fetch 类型化客户端（`getApiClient`）。
 */
import { getApiClient, throwHttpError, unwrapV2 } from "./openapi-client";
import { t } from "../i18n";
import type { BookTitle, ChapterChannel, TocItem } from "../catalog";

/** 书目清单（含 tags，用于按目录 tag 过滤）。 */
export async function fetchBookTitles(): Promise<BookTitle[]> {
  const client = await getApiClient();
  const { data, error, response } = await client.GET("/v2/book-title");
  if (error) throwHttpError(error, response);
  return unwrapV2<{ rows: BookTitle[]; count: number }>(
    data,
    t("error.backend"),
  ).rows;
}

/** 一本书可读的版本/频道列表（原始频道 + 各译文/逐词版本）。 */
export async function fetchBookChannels(
  book: number,
  paragraph: number,
): Promise<ChapterChannel[]> {
  const client = await getApiClient();
  const { data, error, response } = await client.GET("/v2/progress", {
    params: {
      query: {
        view: "chapter_channels",
        book: String(book),
        par: String(paragraph),
      },
    },
  });
  if (error) throwHttpError(error, response);
  return unwrapV2<{ rows: ChapterChannel[]; count: number }>(
    data,
    t("error.backend"),
  ).rows;
}

/** 某一段有内容的版本（`v2/channel?view=paragraphs`），每行带版本类型与最后更新时间。 */
export interface ParagraphChannel {
  uid: string;
  name: string;
  /** `original` / `translation` / `nissaya` … */
  type: string;
  lang: string;
  updated_at?: string;
}

/** 这一段落在哪些版本里有内容（与章节级的 `fetchBookChannels` 不同，按段精确）。 */
export async function fetchParagraphChannels(
  book: number,
  paragraph: number,
): Promise<ParagraphChannel[]> {
  const client = await getApiClient();
  const { data, error, response } = await client.GET("/v2/channel", {
    params: {
      query: { view: "paragraphs", book_id: book, para: String(paragraph) },
    },
  });
  if (error) throwHttpError(error, response);
  return unwrapV2<{ rows: ParagraphChannel[]; count: number }>(
    data,
    t("error.backend"),
  ).rows;
}

/** 系统版本（`v2/channel?view=system`）：按名字找系统版本的 uid 用。 */
export async function fetchSystemChannels(): Promise<ParagraphChannel[]> {
  const client = await getApiClient();
  const { data, error, response } = await client.GET("/v2/channel", {
    params: { query: { view: "system", limit: "500" } },
  });
  if (error) throwHttpError(error, response);
  return unwrapV2<{ rows: ParagraphChannel[]; count: number }>(
    data,
    t("error.backend"),
  ).rows;
}

/** 一本书的目录（toc 视图）。 */
export async function fetchChapterToc(
  book: number,
  paragraph: number,
): Promise<TocItem[]> {
  const client = await getApiClient();
  const { data, error, response } = await client.GET("/v2/chapter", {
    params: {
      query: {
        view: "toc",
        book: String(book),
        para: String(paragraph),
      },
    },
  });
  if (error) throwHttpError(error, response);
  return unwrapV2<{ rows: TocItem[]; count: number }>(
    data,
    t("error.backend"),
  ).rows;
}
