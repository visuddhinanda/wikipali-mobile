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
import { resolveAssetUrl } from "./config";
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

/** 校验会话的超时：弱网下别一直挂着，超时按「网络不可达」处理。 */
const CURRENT_USER_TIMEOUT_MS = 10_000;

/**
 * 读取当前登录用户。
 * `token` 省略时用已保存的会话 token（用于冷启动校验）。
 *
 * 失败时：服务端有响应的抛带 `status` 的 `ApiError`（`ok:false` 也带上 HTTP 状态码），
 * 断网 / 超时抛的是 fetch 自己的错误 —— 用 `isTokenRejected()` 区分两者。
 */
export async function fetchCurrentUser(token?: string): Promise<AuthUser> {
  const client = await getApiClient();
  const bearer = token ?? getTokenSync();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CURRENT_USER_TIMEOUT_MS);
  let result;
  try {
    result = await client.GET("/v2/auth/current", {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const { data, error, response } = result;
  if (error) throw new ApiError(t("signIn.expired"), response.status);
  if (!data?.ok || !data.data) {
    throw new ApiError(data?.message || t("signIn.expired"), response.status);
  }
  const user = data.data as AuthUser;
  // 后端 avatar 是相对路径（`/storage/...`），RN 的 <Image> 解析不了相对地址，
  // 这里按当前 API 服务器补成绝对 URL 再交给 UI（见 config.ts `resolveAssetUrl`）。
  return { ...user, avatar: await resolveAssetUrl(user.avatar) };
}

/**
 * 服务端是否**明确拒绝**了这个 token（该登出），而不是网络 / 服务故障（该保留会话）。
 *
 * 只认 401 / 403，以及 2xx 但 `ok:false`（后端对无效 token 返回 401，见
 * `AuthController::getUserInfoByToken`）。断网、超时（非 ApiError）、5xx、404
 * （如调试地址填错）都不算 —— 离线优先，不能因为一次连不上就把用户踢下线。
 */
export function isTokenRejected(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status === undefined) return false;
  return (
    err.status === 401 ||
    err.status === 403 ||
    (err.status >= 200 && err.status < 300)
  );
}
