/**
 * 段落区间接口 `tipitaka-read-para`。
 *
 * 后端：`mint/api-v13/app/Http/Controllers/TipitakaReadParaController.php`
 *
 * 成片取正文已经改走章节接口（`read-chapter.ts`，见 `docs/reading-content.md`
 * §2）——「给一段区间、期待里面都有内容」的语义碰上残缺译本会整批回空。
 *
 * 但这个接口**不能删**：它是唯一能**精确取某一段**的口子。章节接口的游标落在
 * 没有译文的段上会自动顺延到下一段有译文的，问「9102-7 有没有」它回的可能是
 * 9102-350 —— 引文角标要的就是「这一段，有就是有、没有就是没有」。
 */
import { resolveBaseUrl, toApiV3Base } from "./config";
import { ApiError, request } from "./client";
import { mockReadParas } from "./mock";
import { unwrapV3Collection } from "./v3";

/** 一段正文：两个取数接口逐段返回的条目形状一致。 */
export interface ReadParaItem {
  para: number;
  /** 整段合并后的 HTML（`view=display`）。服务端已剔掉渲染为空的段。 */
  display: string;
}

export interface ReadParaResult {
  items: ReadParaItem[];
  /**
   * 是否为离线占位数据。缓存层据此**不写盘** —— 否则占位文会冒充真经
   * 永久留在缓存里，比一次加载失败糟得多。
   */
  mock: boolean;
}

/**
 * 取 `[from, to]`（含）区间的段落 HTML。**不会顺延**：请求哪几段就是哪几段。
 *
 * ⚠️ 服务端会跳过 `display` 为空的段落，返回的条数可能少于请求的段数 ——
 * 请求了却没回来的段，就是「该版本没有这一段」。
 *
 * 服务端是 `foreach range()` 逐段查库、没有上限保护，不能传大区间；
 * 现在唯一的调用方是单段取数（`loadOnePara`）。
 */
export async function fetchReadParas(
  book: number,
  from: number,
  to: number,
  channelId: string,
): Promise<ReadParaResult> {
  const base = toApiV3Base(await resolveBaseUrl());
  const url =
    `${base}/tipitaka-read-para?book=${book}&para=${from}&to=${to}` +
    `&channel=${encodeURIComponent(channelId)}&format=html&view=display`;

  let raw: unknown;
  try {
    raw = await request<unknown>(url);
  } catch (err) {
    // 仅「网络不可达」回退 mock，保证离线时 UI 走得通；
    // 服务端明确报错（HTTP 4xx/5xx）如实抛出，避免把占位文当成真实译文缓存下来。
    if (err instanceof ApiError && err.status === undefined) {
      return { items: await mockReadParas(book, from, to), mock: true };
    }
    throw err;
  }

  return { items: unwrapV3Collection<ReadParaItem>(raw).items, mock: false };
}
