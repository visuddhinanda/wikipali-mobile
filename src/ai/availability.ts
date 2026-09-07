/**
 * CopilotKit Runtime 可达性探测。
 *
 * Runtime 还没上线，发行包里内联的是开发机地址，手机上必然连不上。
 * 「探索」和「就此段落提问」在进入前先探一次，不可达就弹窗告知，
 * 而不是让用户进到一个永远转圈的对话页。
 */
import { Alert } from "react-native";
import type { MessageKey } from "../i18n/messages/zh-Hans";

const RUNTIME_URL = (
  process.env.EXPO_PUBLIC_RUNTIME_URL || "http://localhost:3001/api/copilotkit"
).replace(/\/+$/, "");

const PROBE_TIMEOUT_MS = 3000;
/** 通了就先信一分钟，省得每次点击都探。 */
const OK_TTL_MS = 60_000;
/** 没通则短时间内不重复探测，但也别缓存太久，免得服务上线后仍被挡住。 */
const FAIL_TTL_MS = 10_000;

let cache: { ok: boolean; at: number } | null = null;

async function probe(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${RUNTIME_URL}/info`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Runtime 是否可达（带 TTL 缓存）。 */
export async function isAiRuntimeReachable(): Promise<boolean> {
  const now = Date.now();
  if (cache && now - cache.at < (cache.ok ? OK_TTL_MS : FAIL_TTL_MS)) {
    return cache.ok;
  }
  const ok = await probe();
  cache = { ok, at: Date.now() };
  return ok;
}

/**
 * 进入 AI 功能前的守卫：可达返回 `true`，否则弹窗告知并返回 `false`。
 *
 * `t` 由调用方从 `useI18n()` 传入 —— 这里是纯模块，拿不到 context。
 */
export async function ensureAiAvailable(
  t: (key: MessageKey) => string,
): Promise<boolean> {
  if (await isAiRuntimeReachable()) return true;
  Alert.alert(t("ai.unavailableTitle"), t("ai.unavailableBody"));
  return false;
}
