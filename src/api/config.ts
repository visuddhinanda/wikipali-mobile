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
 * 把 v2 基础地址（如 `https://next.wikipali.org/api/v2`）切换为 v3。
 * `api/v3/search` 系列接口（章节正文检索）使用 v3 前缀。
 */
export function toApiV3Base(baseUrl: string): string {
  return baseUrl.replace(/\/api\/v\d+\/?$/, "/api/v3");
}

export const ENV_API_URL = envUrl;
