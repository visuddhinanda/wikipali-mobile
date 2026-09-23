/**
 * 后端地址解析。
 *
 * 优先级：
 *   1. `.env` 的 `EXPO_PUBLIC_API_URL`（开发/测试临时覆盖，真机不设）
 *   2. 「我 → 设置 → API 服务器」里选择的服务器（默认 next.wikipali.org）
 */
import { getApiServer, serverToBaseUrl } from "../settings/server";

const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? "";

export async function resolveBaseUrl(): Promise<string> {
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const server = await getApiServer();
  return serverToBaseUrl(server);
}

/**
 * 把 v2/v3 基础地址收敛到 `/api` 根，与 dashboard-v6 的 `openapi-fetch`
 * 客户端对齐（其 `baseUrl: "/api"`）。`schema.d.ts` 里的路径（`/v2/...`、
 * `/v3/...`）都以 `/api` 为前缀拼成完整 URL。
 *
 * 要求入参是 `.../api/vN` 形态（线上域名与 `.env` 覆盖都如此）。
 */
export function toApiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/api\/v\d+\/?$/, "/api");
}

/** 解析到 `/api` 根（供类型化客户端 `openapi-client.ts` 使用）。 */
export async function resolveApiRoot(): Promise<string> {
  return toApiRoot(await resolveBaseUrl());
}

/**
 * 把后端返回的资源路径补成绝对 URL。
 *
 * 后端头像字段是相对路径（如 `/storage/attachments-staging/xxx.jpg`），
 * RN 的 `<Image>` 没有浏览器的「页面根」去解析相对地址，直接当 `uri`
 * 会加载失败；已是 `http(s)://` 的（如签名的 S3 链接）原样返回，避免破坏。
 */
export async function resolveAssetUrl(
  path: string | null | undefined,
): Promise<string | undefined> {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  const base = await resolveBaseUrl();
  const origin = base.replace(/\/api\/v\d+\/?$/, "").replace(/\/+$/, "");
  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

export const ENV_API_URL = envUrl;
