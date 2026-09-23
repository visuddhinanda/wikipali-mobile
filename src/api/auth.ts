/**
 * 登录 / 当前用户接口（对应 mint 后端 `/v2/sign-in`、`/v2/auth/current`，
 * 与 Web 端 `dashboard-v6/src/components/users/SignIn.tsx` 同一套流程）：
 *
 *   POST /v2/sign-in  { username, password }  ->  { ok, data: <token> }
 *   GET  /v2/auth/current  (Bearer token)     ->  { ok, data: <user> }
 *
 * 已迁移到 openapi-fetch 类型化客户端（`getApiClient`），token 由 `authMiddleware`
 * 统一注入。登录失败时后端可能返回 200 + `ok:false`，也可能直接 401，
 * 这里两种都当成「用户名或密码错误」处理。
 */
import { getApiClient } from "./openapi-client";
import { ApiError } from "./client";
import { getTokenSync, type AuthUser } from "../auth/session";
import { t } from "../i18n";

/** 用用户名（或邮箱）+ 密码换取 token。失败时抛 `ApiError`。 */
export async function signIn(
  username: string,
  password: string,
): Promise<string> {
  const client = await getApiClient();
  const { data, error } = await client.POST("/v2/sign-in", {
    body: { username, password },
  });
  if (error) throw new ApiError(t("signIn.badCredentials"));
  // 服务端的原文（如 `invalid token`）对用户没有意义，一律显示统一文案。
  if (!data?.ok || !data.data) throw new ApiError(t("signIn.badCredentials"));
  return data.data;
}

/**
 * 读取当前登录用户。
 * `token` 省略时用已保存的会话 token（用于冷启动校验）。
 */
export async function fetchCurrentUser(token?: string): Promise<AuthUser> {
  const client = await getApiClient();
  const bearer = token ?? getTokenSync();
  const { data, error, response } = await client.GET("/v2/auth/current", {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
  });
  if (error) throw new ApiError(t("signIn.expired"), response.status);
  if (!data?.ok || !data.data) {
    throw new ApiError(data?.message || t("signIn.expired"));
  }
  return data.data as AuthUser;
}
