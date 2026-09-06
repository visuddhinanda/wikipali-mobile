/**
 * 真实后端客户端（mint api-v13）。
 *
 * 仅当 `EXPO_PUBLIC_API_URL` 已配置时启用；未配置时走 `mock.ts`。
 * 响应统一是 `{ ok, data, message }` 信封（见 mint `Controller::ok/error`）。
 */
import { resolveBaseUrl } from "./config";
import { request } from "./client";
import { t } from "../i18n";
import type { BookTitle, ChapterChannel, TocItem } from "../catalog";

interface Envelope<T> {
  ok: boolean;
  data: T;
  message?: string;
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env || env.ok === false) {
    throw new Error(env?.message ?? t("error.backend"));
  }
  return env.data;
}

/** 书目清单（含 tags，用于按目录 tag 过滤）。 */
export async function fetchBookTitles(): Promise<BookTitle[]> {
  const base = await resolveBaseUrl();
  const env = await request<Envelope<{ rows: BookTitle[]; count: number }>>(
    `${base}/book-title`,
  );
  return unwrap(env).rows;
}

/** 一本书可读的版本/频道列表（原始频道 + 各译文/逐词版本）。 */
export async function fetchBookChannels(
  book: number,
  paragraph: number,
): Promise<ChapterChannel[]> {
  const base = await resolveBaseUrl();
  const env = await request<Envelope<{ rows: ChapterChannel[]; count: number }>>(
    `${base}/progress?view=chapter_channels&book=${book}&par=${paragraph}`,
  );
  return unwrap(env).rows;
}

/** 一本书的目录（toc 视图）。 */
export async function fetchChapterToc(
  book: number,
  paragraph: number,
): Promise<TocItem[]> {
  const base = await resolveBaseUrl();
  const env = await request<Envelope<{ rows: TocItem[]; count: number }>>(
    `${base}/chapter?view=toc&book=${book}&para=${paragraph}`,
  );
  return unwrap(env).rows;
}
