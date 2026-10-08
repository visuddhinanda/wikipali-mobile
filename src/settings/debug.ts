/**
 * 调试模式：在 App 内手工指定后端 API 与 AI Runtime 地址（持久化到 AsyncStorage）。
 *
 * - 开：用这里填的 `apiUrl` / `runtimeUrl`（空的那一项仍走代码默认值）。
 * - 关：完全用代码里的值 —— API 走「API 服务器」选择，Runtime 走线上兜底，
 *   **不再读 `.env`**。这样本地 `assembleRelease` 时 `.env` 里没注释的
 *   `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_RUNTIME_URL` 不会再把开发地址带进 release。
 *
 * `.env` 的两个值只用来当输入框的初始值；开发版（`__DEV__`）且 `.env` 设了值时
 * 开关默认打开，保持原来「改 .env 即联调」的手感。
 *
 * 读取是同步的（`getDebugConfig()`），由 `loadDebugConfig()` 在启动时从
 * AsyncStorage 灌进内存缓存；`resolveBaseUrl()` 等异步入口会先 await 它。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

export const ENV_API_URL = process.env.EXPO_PUBLIC_API_URL?.trim() ?? "";
export const ENV_RUNTIME_URL = process.env.EXPO_PUBLIC_RUNTIME_URL?.trim() ?? "";

export const DEFAULT_RUNTIME_URL = "https://agent.wikipali.cc/api/copilotkit";

export interface DebugConfig {
  enabled: boolean;
  /** 后端基础地址（含 `/api/v2`）。 */
  apiUrl: string;
  /** CopilotKit Runtime 地址。 */
  runtimeUrl: string;
}

const STORAGE_KEY = "@wikipali/debug-config";

const DEFAULT_CONFIG: DebugConfig = {
  enabled: __DEV__ && !!(ENV_API_URL || ENV_RUNTIME_URL),
  apiUrl: ENV_API_URL,
  runtimeUrl: ENV_RUNTIME_URL,
};

let current: DebugConfig = DEFAULT_CONFIG;
let loading: Promise<DebugConfig> | null = null;
const listeners = new Set<(c: DebugConfig) => void>();

export function getDebugConfig(): DebugConfig {
  return current;
}

/**
 * 从 AsyncStorage 读一次进缓存（多次调用共用同一次读取）。
 *
 * 返回的是**当下**的配置，不是读盘那一刻的快照 —— 之后改过开关/地址，
 * 再 await 它也要拿到新值。
 */
export async function loadDebugConfig(): Promise<DebugConfig> {
  if (!loading) {
    loading = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) current = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        listeners.forEach((l) => l(current));
        return current;
      })
      .catch(() => current);
  }
  await loading;
  return current;
}

export async function setDebugConfig(patch: Partial<DebugConfig>): Promise<void> {
  current = { ...current, ...patch };
  listeners.forEach((l) => l(current));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}

function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** 调试模式下生效的 API 地址；未开或没填返回空串（走「API 服务器」选择）。 */
export function debugApiUrl(c: DebugConfig = current): string {
  return c.enabled ? trimUrl(c.apiUrl) : "";
}

/** 实际生效的 Runtime 地址。 */
export function effectiveRuntimeUrl(c: DebugConfig = current): string {
  return (c.enabled && trimUrl(c.runtimeUrl)) || DEFAULT_RUNTIME_URL;
}

/** 订阅调试配置（启动时会先 load 一次）。 */
export function useDebugConfig(): DebugConfig {
  const [config, setConfig] = useState(current);
  useEffect(() => {
    listeners.add(setConfig);
    void loadDebugConfig().then(setConfig);
    return () => {
      listeners.delete(setConfig);
    };
  }, []);
  return config;
}
