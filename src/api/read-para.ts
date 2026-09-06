/**
 * 阅读模式段落接口 `tipitaka-read-para`（见 `docs/reading-content.md` §2）。
 *
 * 后端：`mint/api-v13/app/Http/Controllers/TipitakaReadParaController.php`
 */
import { resolveBaseUrl, toApiV3Base } from "./config";
import { ApiError, request } from "./client";
import { mockReadParas } from "./mock";
import { t } from "../i18n";

/** 单次请求的最大段数。服务端是 `foreach range()` 逐段查库，没有上限保护。 */
export const FETCH_BATCH_PARAS = 200;

export interface ReadParaItem {
  para: number;
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

interface Envelope<T> {
  ok: boolean;
  data: T;
  message?: string;
}

/**
 * 取 `[from, to]`（含）区间的段落 HTML。
 *
 * ⚠️ 服务端会跳过 `display` 为空的段落，返回的条数可能少于请求的段数。
 * 调用方（缓存层）负责把「请求了但没返回」的段记成空，见 §4.2。
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

  let env: Envelope<{ items: ReadParaItem[] }>;
  try {
    env = await request<Envelope<{ items: ReadParaItem[] }>>(url);
  } catch (err) {
    // 仅「网络不可达」回退 mock，保证离线时 UI 走得通；
    // 服务端明确报错（HTTP 4xx/5xx）如实抛出，避免把占位文当成真实译文缓存下来。
    if (err instanceof ApiError && err.status === undefined) {
      return { items: await mockReadParas(book, from, to), mock: true };
    }
    throw err;
  }

  if (!env || env.ok === false) {
    throw new Error(env?.message ?? t("error.backend"));
  }
  return { items: env.data?.items ?? [], mock: false };
}
