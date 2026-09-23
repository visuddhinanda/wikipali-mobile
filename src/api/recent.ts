/**
 * `recents` 接口客户端（对应 mint `RecentController`，`/v2/recent`）。
 *
 * 阅读记录同步走这里。唯一键是 `(type, article_id, user_uid)`。
 * 契约与数据映射见 `docs/multi-user-sync.md` §6.1 / §7.2。
 *
 * 已迁移到 openapi-fetch 类型化客户端（`getApiClient`）。
 */
import { getApiClient, throwHttpError, unwrapV2 } from "./openapi-client";
import { t } from "../i18n";

export interface RecentPushResult {
  id: string;
  type: string;
  article_id: string;
  param: string | null;
  updated_at?: string;
}

/** 新增 / 更新一条阅读记录（幂等，服务器 `firstOrNew`）。 */
export async function recentUpsert(params: {
  type: string;
  article_id: string;
  param?: string;
}): Promise<RecentPushResult> {
  const client = await getApiClient();
  const { data, error, response } = await client.POST("/v2/recent", {
    body: params,
  });
  if (error) throwHttpError(error, response);
  return unwrapV2<RecentPushResult>(data, t("error.backend"));
}

export interface RecentRow {
  id: string;
  type: string;
  article_id: string;
  param: string | null;
  updated_at?: string;
  title?: string;
}

/** 拉取某用户的全部阅读记录（`recent?view=user&id=...`）。 */
export async function recentListByUser(
  userId: string,
  type?: string,
): Promise<RecentRow[]> {
  const client = await getApiClient();
  const { data, error, response } = await client.GET("/v2/recent", {
    params: {
      query: {
        view: "user",
        id: userId,
        limit: "1000",
        ...(type ? { type } : {}),
      },
    },
  });
  if (error) throwHttpError(error, response);
  return unwrapV2<{ rows: RecentRow[]; count: number }>(data, t("error.backend"))
    .rows;
}
