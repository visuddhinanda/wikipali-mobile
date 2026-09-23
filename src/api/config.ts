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

export const ENV_API_URL = envUrl;
