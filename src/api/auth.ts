/**
 * 登录 / 当前用户接口（对应 mint 后端 `/v3/sessions`、`/v3/me`，
 * 与 Web 端 `dashboard-v6/src/api/session.ts` 同一套接口）：
 *
 *   POST /v3/sessions  { login, password }  ->  201 { data: { token, user } }
 *   GET  /v3/me        (Bearer token)       ->  200 { data: <user> }
 *
 * 成败只看 HTTP 状态码（v3 不再有 `ok:false` + 200）：账号或密码不对 422，
 * 尝试过频 429，token 无效 / 过期 401。登录一次就拿到用户资料，不必再查 `/me`。
 *
 * 取代原先的 `/v2/sign-in` + `/v2/auth/current`。v3 签出的 token 与 v2 完全相同，
 * 已登录用户升级后不用重新登录。
 */
import { getApiClient } from "./openapi-client";
import { resolveAssetUrl } from "./config";
import { ApiError } from "./client";
import { getTokenSync, type AuthUser } from "../auth/session";
import { t } from "../i18n";
import type { paths } from "./schema";

type Me = NonNullable<
  paths["/v3/me"]["get"]["responses"][200]["content"]["application/json"]["data"]
>;

/**
 * v3 的用户资料 → `AuthUser`。字段名与原来一致（v3 沿用驼峰口径），
 * 只补两件事：可选字段收成必填值；avatar 补成绝对 URL。
 */
async function toAuthUser(me: Me): Promise<AuthUser> {
  return {
    id: me.id ?? "",
    nickName: me.nickName ?? "",
    realName: me.realName ?? "",
    // 后端 avatar 可能是相对路径（`/storage/...`），RN 的 <Image> 解析不了相对地址，
    // 这里按当前 API 服务器补成绝对 URL 再交给 UI（见 config.ts `resolveAssetUrl`）。
    avatar: await resolveAssetUrl(me.avatar),
    roles: me.roles ?? [],
  };
}

/**
 * 用用户名（或邮箱）+ 密码登录，一次拿到 token 与用户资料。失败时抛 `ApiError`。
 *
 * 密码原样提交，不去首尾空格——空格也是密码的一部分（与 Web 端、后端一致）。
 */
export async function signIn(
  login: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
  const client = await getApiClient();
  const { data, error, response } = await client.POST("/v3/sessions", {
    body: { login, password },
  });
  if (error || !data?.data?.token) {
    // 服务端的原文是英文（api 组还没有语言协商），对用户统一显示本地化文案。
    const message =
      response.status === 429
        ? t("signIn.tooManyAttempts")
        : response.status === 422
          ? t("signIn.badCredentials")
          : t("signIn.failed");
    throw new ApiError(message, response.status, error);
  }
  return {
    token: data.data.token,
    user: await toAuthUser(data.data.user ?? {}),
  };
}

/** 校验会话的超时：弱网下别一直挂着，超时按「网络不可达」处理。 */
const CURRENT_USER_TIMEOUT_MS = 10_000;

/**
 * 读取当前登录用户。
 * `token` 省略时用已保存的会话 token（用于冷启动校验）。
 *
 * 失败时：服务端有响应的抛带 `status` 的 `ApiError`，断网 / 超时抛的是 fetch
 * 自己的错误 —— 用 `isTokenRejected()` 区分两者。
 */
export async function fetchCurrentUser(token?: string): Promise<AuthUser> {
  const client = await getApiClient();
  const bearer = token ?? getTokenSync();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CURRENT_USER_TIMEOUT_MS);
  let result;
  try {
    result = await client.GET("/v3/me", {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const { data, error, response } = result;
  if (error || !data?.data) {
    throw new ApiError(t("signIn.expired"), response.status, error);
  }
  return toAuthUser(data.data);
}

/**
 * 服务端是否**明确拒绝**了这个 token（该登出），而不是网络 / 服务故障（该保留会话）。
 *
 * 只认 401 / 403。断网、超时（非 ApiError）、5xx、404（如调试地址填错）都不算 ——
 * 离线优先，不能因为一次连不上就把用户踢下线。
 */
export function isTokenRejected(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status === undefined) return false;
  return err.status === 401 || err.status === 403;
}
