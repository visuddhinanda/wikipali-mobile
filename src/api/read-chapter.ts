/**
 * 阅读模式章节接口 `tipitaka-read-chapter`（见 `docs/reading-content.md` §2）。
 *
 * 后端：`mint/api-v13/app/Http/Controllers/TipitakaReadChapterController.php`
 *
 * 成片取正文用它取代了 `tipitaka-read-para`。根本差别：**按章节 + 游标取数，
 * 服务端只数「该 channel 真有译文的段落」**。区间接口是「给一段区间、期待
 * 里面都有内容」，译文残缺时整批回空 —— 一本书只有后半部有译文，用户点开书
 * 看到的就是一片空白。章节接口的每一块都保证有内容，缺的段落由 meta 的
 * 覆盖区间反推（见 `src/reading/cache.ts`）。
 *
 * 代价是**游标会顺延**：问某一段有没有，它回的是「从这一段往后第一段有的」。
 * 要精确取某一段仍然只能用 `read-para.ts`。
 */
import { resolveBaseUrl, toApiV3Base } from "./config";
import { ApiError, request } from "./client";
import { metaInt, unwrapV3Collection } from "./v3";
import type { ReadParaItem } from "./read-para";
import { t } from "../i18n";

/**
 * 阅读时的每块大小：3000 字节原文长度，与阅读窗口 `WINDOW_STRLEN` 同一量级。
 *
 * 阅读要的是「首屏快」，块大小跟着窗口走：一屏正好一块，多取的部分是给下一次
 * 滚动预热的，再大就是让用户干等。
 */
export const CHAPTER_PAGE_SIZE = 3000;

/**
 * 整本下载的每块大小：5000 字节，**服务端的字节上限**
 * （`TipitakaReadChapterController::MAX_BYTES_PER_PAGE`）。
 *
 * 下载没人盯着首屏，块越大往返次数越少 —— 每块都要一次 HTTP + 一次写事务，
 * 请求数直接决定整本耗时。实测书 94（1557 段）整章取完：
 * 3000 字节 142 块 / 13.8 秒，5000 字节 **91 块 / 10.8 秒**，请求数少 36%。
 *
 * 再往上传也没用，服务端按上限截，`meta.page_size` 回的是截过的值。偈颂类的
 * 书另受每块 200 段的上限约束（一段才二三十字节，光靠字节数能攒出几百段），
 * 两个上限谁先到算谁。
 */
export const DOWNLOAD_PAGE_SIZE = 5000;

/** 每块大小的单位：按段落原文字节数累加（`para` 是按段数）。 */
export const CHAPTER_PAGE_UNIT = "byte";

/** 服务端取回的一块。 */
export interface ReadChapterBlock {
  /** 本块里真有正文的段（服务端已剔掉渲染为空的段）。 */
  items: ReadParaItem[];
  /**
   * 本块实际覆盖的段落闭区间。`items` 可能比它短 —— 区间内渲染为空的段
   * 被剔出了 `items`，但仍算已覆盖，续传必须跨过去，否则原地打转。
   */
  firstPara: number;
  lastPara: number;
  /** 该 channel 在本章节内有译文的段落总数（进度条的分母）。 */
  totalPara: number;
  /** `lastPara` 之后本章节内还剩多少段；0 即本章节取完。 */
  remainingPara: number;
}

/**
 * 一次取数的结果：
 *
 * - `block`   正常取到一块；
 * - `empty`   游标之后本章节没有任何译文（服务端 404 / 422）——
 *             调用方据此把剩下的段整段记空，而不是逐段再试；
 * - `offline` 网络不可达 —— 调用方自己决定是显示离线占位文还是报错，
 *             无论哪种都**不可写盘**。
 */
export type ReadChapterOutcome =
  | { status: "block"; block: ReadChapterBlock }
  | { status: "empty" }
  | { status: "offline" };

/** 422 的正文里点名了 `from` —— 游标之后没有译文了，是取数的终点而非参数错误。 */
function isCursorExhausted(body: unknown): boolean {
  const errors = (body as { errors?: Record<string, unknown> } | null)?.errors;
  return !!errors && Object.prototype.hasOwnProperty.call(errors, "from");
}

/**
 * 取章节 `chapter` 里从游标 `from` 起的一块。
 *
 * `chapter` 必须是章节的起始段号（本地 `pali_text` 里 `parent = -1` 的顶层行，
 * 见 `src/reading/chapter.ts`）；`from` 必须落在该章节的段落区间内，落在没有
 * 译文的段上服务端会顺延到之后的第一段。
 */
export async function fetchReadChapter(
  book: number,
  chapter: number,
  channelId: string,
  from: number,
  pageSize: number = CHAPTER_PAGE_SIZE,
  unit: string = CHAPTER_PAGE_UNIT,
): Promise<ReadChapterOutcome> {
  const base = toApiV3Base(await resolveBaseUrl());
  const url =
    `${base}/tipitaka-read-chapter?book=${book}&para=${chapter}&from=${from}` +
    `&channel=${encodeURIComponent(channelId)}&format=html&view=display` +
    `&pagesize=${pageSize}&unit=${unit}`;

  let raw: unknown;
  try {
    raw = await request<unknown>(url);
  } catch (err) {
    if (err instanceof ApiError) {
      // 仅「网络不可达」回退离线占位；服务端明确报错如实处理，
      // 否则占位文会被当成真实译文缓存下来。
      if (err.status === undefined) return { status: "offline" };
      // 404 = 整章没有译文；422 + errors.from = 游标之后没有译文了。
      if (err.status === 404) return { status: "empty" };
      if (err.status === 422 && isCursorExhausted(err.body)) {
        return { status: "empty" };
      }
    }
    throw err;
  }

  const { items, meta } = unwrapV3Collection<ReadParaItem>(raw);
  const firstPara = metaInt(meta, "first_para");
  const lastPara = metaInt(meta, "last_para");
  if (firstPara === undefined || lastPara === undefined) {
    // 拿不到覆盖区间就无从判断「哪些段确认没有译文」，当成空结果缓存下去
    // 会把整章记成空。宁可报错。
    throw new ApiError(t("error.backend"));
  }

  return {
    status: "block",
    block: {
      items,
      firstPara,
      lastPara,
      totalPara: metaInt(meta, "total_para") ?? items.length,
      remainingPara: metaInt(meta, "remaining_para") ?? 0,
    },
  };
}
