/**
 * 登录 / 当前用户接口（对应 mint 后端 `/api/v2/sign-in`、`/api/v2/auth/current`，
 * 与 Web 端 `dashboard-v6/src/components/users/SignIn.tsx` 同一套流程）：
 *
 *   POST /sign-in  { username, password }  ->  { ok, data: <token> }
 *   GET  /auth/current  (Bearer token)     ->  { ok, data: <user> }
 *
 * 登录失败时后端可能返回 200 + `ok:false`，也可能直接 401，
 * 这里两种都当成「用户名或密码错误」处理，所以不复用会在 HTTP 错误上抛异常的 `request()`。
 */
import { resolveBaseUrl } from "./config";
import { ApiError } from "./client";
import { getTokenSync, type AuthUser } from "../auth/session";
import { t } from "../i18n";

interface Envelope<T> {
  ok: boolean;
  data: T;
  message?: string;
}

/** 已登录时附带的鉴权头；未登录返回空对象。 */
export function authHeaders(): Record<string, string> {
  const token = getTokenSync();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const TIMEOUT = 12_000;

async function callJson<T>(url: string, init: RequestInit): Promise<Envelope<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : t("error.network"));
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!text) {
    // 没有 body 时只能靠状态码判断
    return { ok: res.ok, data: undefined as T };
  }
  try {
    return JSON.parse(text) as Envelope<T>;
  } catch {
    throw new ApiError(t("error.badJson"), res.status);
  }
}

/** 用用户名（或邮箱）+ 密码换取 token。失败时抛 `ApiError`。 */
export async function signIn(
  username: string,
  password: string,
): Promise<string> {
  const base = await resolveBaseUrl();
  const env = await callJson<string>(`${base}/sign-in`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ username, password }),
  });
  if (!env.ok || !env.data) {
    throw new ApiError(env.message || t("signIn.badCredentials"));
  }
  return env.data;
}

/**
 * 读取当前登录用户。
 * `token` 省略时用已保存的会话 token（用于冷启动校验）。
 */
export async function fetchCurrentUser(token?: string): Promise<AuthUser> {
  const base = await resolveBaseUrl();
  const bearer = token ?? getTokenSync();
  const env = await callJson<AuthUser>(`${base}/auth/current`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
  });
  if (!env.ok || !env.data) {
    throw new ApiError(env.message || t("signIn.expired"));
  }
  return env.data;
}
