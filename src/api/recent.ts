/**
 * `recents` 接口客户端（对应 mint `RecentController`，`/api/v2/recent`）。
 *
 * 阅读记录同步走这里。唯一键是 `(type, article_id, user_uid)`。
 * 契约与数据映射见 `docs/multi-user-sync.md` §6.1 / §7.2。
 */
import { resolveBaseUrl } from "./config";
import { request } from "./client";
import { authHeaders } from "./auth";
import { t } from "../i18n";

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
  const base = await resolveBaseUrl();
  const env = await request<Envelope<RecentPushResult>>(`${base}/recent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...authHeaders(),
    },
    body: JSON.stringify(params),
  });
  return unwrap(env);
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
  const base = await resolveBaseUrl();
  let url = `${base}/recent?view=user&id=${encodeURIComponent(userId)}&limit=1000`;
  if (type) url += `&type=${encodeURIComponent(type)}`;
  const env = await request<Envelope<{ rows: RecentRow[]; count: number }>>(url);
  return unwrap(env).rows;
}
