/**
 * 游标式成片取正文 —— 新版 `/v3/tipitaka-reading/{channel}` 的游标分块。
 *
 * 后端：`mint/api-v13` `V3\TipitakaReadingController`（旧 `TipitakaReadChapterController`）。
 *
 * 与区间接口（`read-para.ts`）同属一个新端点：这里用 `book`（可加 `chapter`）
 * 过滤 + 不透明游标 `after` 顺序取数。服务端只回**有译文**的段、按 (book, para)
 * 升序，`meta.next_cursor` 指到下一块、为 null 表示取完。
 *
 * 语义变化（对比旧 `tipitaka-read-chapter`）：
 * - 游标从「段号 `from`」变成「不透明 `after`」：只能把上次的 `next_cursor`
 *   原样传回，**不要自己拼游标**（其内部形式是实现细节，会变）。
 * - meta 的 `first_para` / `last_para` / `total_para` / `remaining_para` /
 *   `current_para` 换成了 `next_cursor` / `total` / `remaining`；后两者只在带
 *   `book` 过滤时给。
 * - 没有译文 / 游标越界都是 200 空集合，**不再是 404/422**。
 *
 * 用途：整本书下载（`book` 过滤 + 游标推进），分母直接取 `total`，不再逐章探测。
 *
 * 已迁移到 openapi-fetch 类型化客户端（`getApiClient`）。
 */
import { getApiClient, throwHttpError } from "./openapi-client";
import { metaInt, unwrapV3Collection } from "./v3";
import type { ReadParaItem } from "./read-para";

/** 整本下载的每块大小：5000 字节原文长度，**服务端的字节上限**。 */
export const DOWNLOAD_PAGE_SIZE = 5000;

/** 每块大小的单位：按段落原文字节数累加（`para` 是按段数）。 */
export const CHAPTER_PAGE_UNIT = "byte";

/** 服务端取回的一块。 */
export interface ReadChapterBlock {
  /** 本块里有正文的段（服务端已剔掉渲染为空的段）。 */
  items: ReadParaItem[];
  /** 下一块的游标，原样传回 `after`；为 null 表示取完。 */
  nextCursor: string | null;
  /** 过滤范围内已翻译的段落总数（进度分母）。仅在带 `book` 过滤时给。 */
  total?: number;
  /** 本块之后过滤范围内还剩多少段有译文。仅在带 `book` 过滤时给。 */
  remaining?: number;
}

export type ReadChapterOutcome =
  | { status: "block"; block: ReadChapterBlock }
  | { status: "empty" }
  | { status: "offline" };

export interface ReadChapterOptions {
  /** 章节起始段落号，服务端按 `chapter_len` 展开成段落区间。可省略（整本书）。 */
  chapter?: number;
  /** 每块大小，含义由 `unit` 决定。 */
  pageSize?: number;
  unit?: "para" | "byte";
}

/**
 * 取 `book` 里从游标 `after` 起的一块有译文的段落。
 *
 * `after` 传 null 表示从头取；之后每次把上次的 `nextCursor` 原样传回。
 * 没有更多内容时返回 `status: "empty"`（200 空集合）。
 */
export async function fetchReadChapter(
  book: number,
  channelId: string,
  after: string | null,
  opts?: ReadChapterOptions,
): Promise<ReadChapterOutcome> {
  const client = await getApiClient();

  let result;
  try {
    result = await client.GET("/v3/tipitaka-reading/{channel}", {
      params: {
        path: { channel: channelId },
        query: {
          book,
          ...(opts?.chapter != null ? { chapter: opts.chapter } : {}),
          ...(after ? { after } : {}),
          format: "html",
          include: "display",
          page_size: opts?.pageSize ?? DOWNLOAD_PAGE_SIZE,
          unit: opts?.unit ?? CHAPTER_PAGE_UNIT,
        },
      },
    });
  } catch {
    // fetch 本身抛错（网络不可达）→ 离线占位，不写盘。
    return { status: "offline" };
  }

  const { data, error, response } = result;
  if (error) throwHttpError(error, response);

  const { items, meta } = unwrapV3Collection<ReadParaItem>(data);
  if (items.length === 0) return { status: "empty" };

  const nextCursor =
    typeof meta.next_cursor === "string" && meta.next_cursor !== ""
      ? meta.next_cursor
      : null;
  return {
    status: "block",
    block: {
      items,
      nextCursor,
      total: metaInt(meta, "total"),
      remaining: metaInt(meta, "remaining"),
    },
  };
}
