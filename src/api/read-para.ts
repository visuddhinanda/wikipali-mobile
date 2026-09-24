/**
 * 段落区间取数 —— 新版 `/v3/tipitaka-reading/{channel}` 的 `para` / `to` 过滤。
 *
 * 后端：`mint/api-v13` `V3\TipitakaReadingController`（旧 `TipitakaReadParaController`）。
 *
 * 与游标接口（`read-chapter.ts`）同属一个新端点：这里用 `para`/`to` 把范围
 * 收窄到段落区间，返回该区间内**有译文**的段（空段跳过）。区间内有多少段
 * 有译文、就回多少段；一段都没有就是 200 空集合，不是 404/422。
 *
 * 用途：精确取某一段（AI 引文角标要「这一段，有就是有、没有就是没有」）与
 * 阅读窗口补缺口 —— 二者都要按段号随机定位，游标接口（`after` 是不透明游标、
 * 只许顺序续传）做不到这一点。
 *
 * 已迁移到 openapi-fetch 类型化客户端（`getApiClient`）。
 */
import { getApiClient, throwHttpError } from "./openapi-client";
import { mockReadParas } from "./mock";
import { unwrapV3Collection } from "./v3";

/** 一段正文：游标接口与区间接口逐段返回的条目形状一致。 */
export interface ReadParaItem {
  para: number;
  /** 整段合并后的 HTML（`include=display`）。服务端已剔掉渲染为空的段。 */
  display: string;
}

export interface ReadParaResult {
  items: ReadParaItem[];
  /**
   * 是否为离线占位数据。缓存层据此**不写盘** —— 否则占位文会冒充真经
   * 永久留在缓存里，比一次加载失败糟得多。
   */
  mock: boolean;
  /**
   * 下一块的游标（原样传回 `after`）；为 null 表示该区间内已取完。
   * 区间足够小（一页装得下）时通常为 null。
   */
  nextCursor: string | null;
}

export interface ReadParaOptions {
  /** 续传游标，取上一次结果的 `nextCursor`。 */
  after?: string | null;
  /** 每块大小，含义由 `unit` 决定（上限 para=200 / byte=5000）。 */
  pageSize?: number;
  unit?: "para" | "byte";
}

/**
 * 取 `[from, to]`（含）区间内有译文的段落 HTML。**不会顺延**：请求哪几段、
 * 就只在这几段里找。
 *
 * ⚠️ 服务端会跳过 `display` 为空的段落，返回的条数可能少于请求的段数 ——
 * 请求了却没回来的段，就是「该版本没有这一段」。
 *
 * 区间超过一页时会分块（`nextCursor` 非 null），调用方用 `after` 续传。
 */
export async function fetchReadParas(
  book: number,
  from: number,
  to: number,
  channelId: string,
  opts?: ReadParaOptions,
): Promise<ReadParaResult> {
  const client = await getApiClient();

  let result;
  try {
    result = await client.GET("/v3/tipitaka-reading/{channel}", {
      params: {
        path: { channel: channelId },
        query: {
          book,
          para: from,
          // 单个 para 只传 `para=<para>`（`to` 缺省即等于 para）；区间才补 `to`。
          ...(from !== to ? { to } : {}),
          ...(opts?.after ? { after: opts.after } : {}),
          ...(opts?.pageSize != null ? { page_size: opts.pageSize } : {}),
          ...(opts?.unit ? { unit: opts.unit } : {}),
          format: "html",
          include: "display",
        },
      },
    });
  } catch {
    // 网络不可达 → 回退 mock，保证离线时 UI 走得通。
    return {
      items: await mockReadParas(book, from, to),
      mock: true,
      nextCursor: null,
    };
  }

  const { data, error, response } = result;
  if (error) throwHttpError(error, response);
  const { items, meta } = unwrapV3Collection<ReadParaItem>(data);
  const nextCursor =
    typeof meta.next_cursor === "string" && meta.next_cursor !== ""
      ? meta.next_cursor
      : null;
  return { items, mock: false, nextCursor };
}
