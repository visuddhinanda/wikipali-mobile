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
import { t } from "../i18n";
import { metaInt, unwrapV3Collection } from "./v3";
import type { ReadParaItem } from "./read-para";

/**
 * 整本下载的每块大小：按段落累加的**巴利原文**字节数，不是响应体大小 —— 返回的是渲染好的
 * HTML，实际一块约为它的 4～8 倍（50000 → 约 200～400 KB）。块越大往返越少；下载单写者逐本跑，
 * 往返延迟是速度的大头。依赖服务端放宽 `page_size` 上限（原上限 5000）。
 */
export const DOWNLOAD_PAGE_SIZE = 50000;

/** 阅读补缺口（区间接口）的每块大小：只取一个阅读单元的范围，保持小块、首屏快。 */
export const READ_PAGE_SIZE = 5000;

/**
 * 整本下载每块请求的超时。服务端发完响应头后卡住时，没有超时的话这一块会永远挂着，
 * 而下载是单写者逐本跑的，整个队列都会停住（`docs/download-manager.md` §5.2）。
 * 一块约 200～400 KB：本地实测 1 秒内；慢速移动网络（约 10 KB/s）也要在 40 秒内，取 60 秒。
 */
export const DOWNLOAD_TIMEOUT_MS = 60_000;

/** 请求超时（区别于「没网」：调度器按失败退避重试，而不是当作等网络）。 */
export class RequestTimeoutError extends Error {
  constructor() {
    super(t("error.timeout"));
    this.name = "RequestTimeoutError";
  }
}

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
  /**
   * 本块传输的数据量（字节）：优先响应头 `Content-Length`；压缩 / 分块传输时
   * 没有该头，退回按响应 JSON 文本长度估算。用于下载管理的数据量与速度。
   */
  bytes: number;
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
  /** 超时（毫秒），覆盖请求和读响应体；超时抛 `RequestTimeoutError`。不传不设超时。 */
  timeoutMs?: number;
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
  // 超时不只靠 abort：这个 App 的 fetch 被 CopilotKit 的 streaming polyfill 接管
  // （见 openapi-client.ts），abort 能否让 promise 落地取决于 polyfill 的实现。
  // 所以和计时器赛跑，计时器先到就按超时失败；abort 尽力把底层连接也断掉。
  const controller = opts?.timeoutMs ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = controller
    ? new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new RequestTimeoutError());
        }, opts!.timeoutMs);
      })
    : null;

  let result;
  try {
    const request = client.GET("/v3/tipitaka-reading/{channel}", {
      signal: controller?.signal,
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
    // 赛跑输掉的那个请求之后若再失败，不要成为未处理的 rejection。
    request.catch(() => undefined);
    // openapi-fetch 在 GET 里就把响应体读完了，赛跑同时覆盖「卡在读体」的情况。
    result = await (timeout ? Promise.race([request, timeout]) : request);
  } catch (err) {
    // 超时：服务端连上了但没回完，按失败重试；其余 fetch 抛错（网络不可达）→ 离线占位，不写盘。
    if (err instanceof RequestTimeoutError) throw err;
    return { status: "offline" };
  } finally {
    if (timer) clearTimeout(timer);
  }

  const { data, error, response } = result;
  if (error) throwHttpError(error, response);

  const { items, meta } = unwrapV3Collection<ReadParaItem>(data);
  if (items.length === 0) return { status: "empty" };

  const header = Number(response.headers.get("content-length"));
  const bytes =
    Number.isFinite(header) && header > 0 ? header : JSON.stringify(data).length;

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
      bytes,
    },
  };
}
