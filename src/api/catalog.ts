/**
 * 真实后端客户端（mint api-v13）。
 *
 * 仅当 `EXPO_PUBLIC_API_URL` 已配置时启用；未配置时走 `mock.ts`。
 * 响应统一是 `{ ok, data, message }` 信封（见 mint `Controller::ok/error`）。
 */
import { resolveBaseUrl, toApiV3Base } from "./config";
import { request } from "./client";
import { t } from "../i18n";
import type {
  BookTitle,
  ChapterChannel,
  ChapterContent,
  TipitakaChapter,
  TocItem,
} from "../catalog";

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

/**
 * 章节正文（阅读模式）。
 *
 * ⚠️ 集成点（P1）：mint 的 `chapter-content/{book}-{para}?mode=read` 返回的
 * `content` 是**结构化内容对象的 JSON 字符串**（`content_type: 'json'`），
 * 由段落 → 句子的 `html` 字段组成，而不是扁平 HTML。下面做了 best-effort
 * 递归拼装；正式接入时需按线上真实结构核对 `makeContentObj` 输出。
 */
export async function fetchChapterContent(
  book: number,
  paragraph: number,
): Promise<ChapterContent> {
  const base = await resolveBaseUrl();
  const env = await request<
    Envelope<{
      title: string;
      sub_title?: string;
      content: string;
      content_type?: string;
      toc?: TocItem[];
      lang?: string;
    }>
  >(`${base}/chapter-content/${book}-${paragraph}?mode=read`);
  const data = unwrap(env);

  return {
    title: data.title,
    sub_title: data.sub_title,
    content:
      data.content_type === "html"
        ? data.content
        : flattenReadHtml(data.content),
    content_type: "html",
    toc: data.toc,
    lang: data.lang,
  };
}

/**
 * 通过「书-段落_频道」拉取章节正文（api/v3/search）。
 *
 * URL：`/api/v3/search/tipitaka_chapter_<book>-<paragraph>_<channel_id>`
 * 返回的 `display` 即阅读模式 HTML，`content` 为纯文本。
 */
export async function fetchChapterByChannel(
  book: number,
  paragraph: number,
  channelId: string,
): Promise<TipitakaChapter> {
  const base = await resolveBaseUrl();
  const v3 = toApiV3Base(base);
  const env = await request<Envelope<TipitakaChapter>>(
    `${v3}/search/tipitaka_chapter_${book}-${paragraph}_${encodeURIComponent(
      channelId,
    )}`,
  );
  return unwrap(env);
}

/** 把 mint 阅读模式的结构化 content（JSON 字符串）拼成扁平 HTML。 */
function flattenReadHtml(content: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.html === "string" && obj.html.length > 0) {
      parts.push(obj.html);
    }
    if (Array.isArray(obj.sentences)) obj.sentences.forEach(walk);
    if (Array.isArray(obj.children)) obj.children.forEach(walk);
  };
  walk(parsed);
  return parts.length > 0 ? parts.join("\n") : "";
}
