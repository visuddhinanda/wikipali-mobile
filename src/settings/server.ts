/**
 * API 服务器选择（持久化到 AsyncStorage）。
 *
 * 真机默认走线上域名；开发联调可用 `.env` 的 `EXPO_PUBLIC_API_URL`
 * 临时覆盖（见 `src/api/config.ts`）。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ApiServer {
  id: string;
  label: string;
  /** 基础 URL（含 /api/v2 前缀）。 */
  baseUrl: string;
}

export const API_SERVERS: ApiServer[] = [
  { id: "next.wikipali.cc", label: "next.wikipali.cc", baseUrl: "https://next.wikipali.cc/api/v2" },
  { id: "www.wikipali.cc", label: "www.wikipali.cc", baseUrl: "https://www.wikipali.cc/api/v2" },
  { id: "next.wikipali.org", label: "next.wikipali.org", baseUrl: "https://next.wikipali.org/api/v2" },
  { id: "www.wikipali.org", label: "www.wikipali.org", baseUrl: "https://www.wikipali.org/api/v2" },
];

export const DEFAULT_SERVER = "next.wikipali.org";

const STORAGE_KEY = "@wikipali/api-server";

export async function getApiServer(): Promise<string> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    return value ?? DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

export async function setApiServer(server: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, server);
}

export function serverToBaseUrl(server: string): string {
  return API_SERVERS.find((s) => s.id === server)?.baseUrl ?? `${server}/api/v2`;
}
