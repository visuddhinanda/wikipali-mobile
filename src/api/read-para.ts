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
 *
 * 已迁移到 openapi-fetch 类型化客户端（`getApiClient`）。
 */
import { getApiClient, throwHttpError } from "./openapi-client";
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
 */
export async function fetchReadParas(
  book: number,
  from: number,
  to: number,
  channelId: string,
): Promise<ReadParaResult> {
  const client = await getApiClient();

  let result;
  try {
    result = await client.GET("/v3/tipitaka-read-para", {
      params: {
        query: {
          book,
          para: from,
          to,
          channel: channelId,
          format: "html",
          view: "display",
        },
      },
    });
  } catch {
    // 网络不可达 → 回退 mock，保证离线时 UI 走得通。
    return { items: await mockReadParas(book, from, to), mock: true };
  }

  const { data, error, response } = result;
  if (error) throwHttpError(error, response);
  return { items: unwrapV3Collection<ReadParaItem>(data).items, mock: false };
}
