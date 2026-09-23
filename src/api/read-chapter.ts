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
 *
 * 已迁移到 openapi-fetch 类型化客户端（`getApiClient`）。
 */
import { getApiClient, throwHttpError } from "./openapi-client";
import { ApiError } from "./client";
import { metaInt, unwrapV3Collection } from "./v3";
import type { ReadParaItem } from "./read-para";
import { t } from "../i18n";

/**
 * 阅读时的每块大小：3000 字节原文长度，与阅读窗口 `WINDOW_STRLEN` 同一量级。
 */
export const CHAPTER_PAGE_SIZE = 3000;

/**
 * 整本下载的每块大小：5000 字节，**服务端的字节上限**
 * （`TipitakaReadChapterController::MAX_BYTES_PER_PAGE`）。
 */
export const DOWNLOAD_PAGE_SIZE = 5000;

/** 每块大小的单位：按段落原文字节数累加（`para` 是按段数）。 */
export const CHAPTER_PAGE_UNIT = "byte";

/** 服务端取回的一块。 */
export interface ReadChapterBlock {
  /** 本块里真有正文的段（服务端已剔掉渲染为空的段）。 */
  items: ReadParaItem[];
  /** 本块实际覆盖的段落闭区间。 */
  firstPara: number;
  lastPara: number;
  /** 该 channel 在本章节内有译文的段落总数（进度条的分母）。 */
  totalPara: number;
  /** `lastPara` 之后本章节内还剩多少段；0 即本章节取完。 */
  remainingPara: number;
}

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
 * `chapter` 必须是章节的起始段号（本地 `pali_text` 里 `parent = -1` 的顶层行）；
 * `from` 必须落在该章节的段落区间内。
 */
export async function fetchReadChapter(
  book: number,
  chapter: number,
  channelId: string,
  from: number,
  pageSize: number = CHAPTER_PAGE_SIZE,
  unit: string = CHAPTER_PAGE_UNIT,
): Promise<ReadChapterOutcome> {
  const client = await getApiClient();

  let result;
  try {
    result = await client.GET("/v3/tipitaka-read-chapter", {
      params: {
        query: {
          book,
          para: chapter,
          from,
          channel: channelId,
          format: "html",
          view: "display",
          pagesize: pageSize,
          unit: unit as "para" | "byte",
        },
      },
    });
  } catch {
    // fetch 本身抛错（网络不可达）→ 离线占位，不写盘。
    return { status: "offline" };
  }

  const { data, error, response } = result;
  if (error) {
    // 404 = 整章没有译文；422 + errors.from = 游标之后没有译文了。
    if (response.status === 404) return { status: "empty" };
    if (response.status === 422 && isCursorExhausted(error)) {
      return { status: "empty" };
    }
    throwHttpError(error, response);
  }

  const { items, meta } = unwrapV3Collection<ReadParaItem>(data);
  const firstPara = metaInt(meta, "first_para");
  const lastPara = metaInt(meta, "last_para");
  if (firstPara === undefined || lastPara === undefined) {
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
