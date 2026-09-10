/**
 * GPS 定位（§3.1）。
 *
 * `expo-location` 含原生代码：**旧的 dev client / 安装包里没有这个模块**，
 * 直接 import 会在启动时炸掉整个 App。所以这里懒 require + try/catch，
 * 取不到就当定位不可用，UI 走城镇搜索的降级路径（`calendar.location.unavailable`）。
 *
 * 精度只要 `Low`（1 km）：日出日落对定位极不敏感，纬度差 1 km 只有几秒钟，
 * 用 `High` 纯粹是多耗电。
 */
import type { Place } from "./place";
import { nearestCity } from "./cities";

export type GpsFailure = "unavailable" | "denied" | "timeout" | "error";

export interface GpsResult {
  place?: Place;
  failure?: GpsFailure;
}

interface ExpoLocationModule {
  requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  getLastKnownPositionAsync(): Promise<{
    coords: { latitude: number; longitude: number; accuracy: number | null };
  } | null>;
  getCurrentPositionAsync(options: { accuracy: number }): Promise<{
    coords: { latitude: number; longitude: number; accuracy: number | null };
  }>;
  Accuracy: { Low: number };
}

/**
 * 原生模块在不在这个安装包里。
 *
 * 不能靠 `try { require(...) }` 判断：`expo-location` 的模块代理在**导入求值时**
 * 就抛「Cannot find native module」，虽然被 catch 住了，全局错误处理器仍会把它
 * 当未捕获错误弹红屏。所以先看 `globalThis.expo.modules` 里有没有登记，
 * 有才去 require。
 */
function nativeRegistered(): boolean | null {
  const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo
    ?.modules;
  if (!modules) return null; // 拿不到登记表，只能试着 require
  return Boolean(modules.ExpoLocation);
}

let cached: ExpoLocationModule | null | undefined;

function loadModule(): ExpoLocationModule | null {
  if (cached !== undefined) return cached;
  if (nativeRegistered() === false) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require("expo-location") as ExpoLocationModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** 定位模块在不在这个安装包里。UI 用它决定是否显示「再试一次定位」。 */
export function isGpsAvailable(): boolean {
  return loadModule() !== null;
}

function toPlace(
  coords: { latitude: number; longitude: number; accuracy: number | null },
): Place {
  const city = nearestCity(coords.latitude, coords.longitude);
  return {
    // 名字与时区取最近的城镇；坐标仍用 GPS 的真值，不要用城镇中心去算时刻。
    name: city ? city.name : `${coords.latitude.toFixed(2)}, ${coords.longitude.toFixed(2)}`,
    lat: coords.latitude,
    lon: coords.longitude,
    timeZone: city ? city.timeZone : "UTC",
    source: "gps",
    accuracy: coords.accuracy ?? undefined,
  };
}

/**
 * 取一次当前位置。
 *
 * 先给最后已知位置（立等可取），再等一次真正的定位；两者都拿不到才算失败。
 */
export async function locate(): Promise<GpsResult> {
  const mod = loadModule();
  if (!mod) return { failure: "unavailable" };

  try {
    const permission = await mod.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") return { failure: "denied" };

    const last = await mod.getLastKnownPositionAsync().catch(() => null);
    try {
      const current = await mod.getCurrentPositionAsync({ accuracy: mod.Accuracy.Low });
      return { place: toPlace(current.coords) };
    } catch {
      if (last) return { place: toPlace(last.coords) };
      return { failure: "timeout" };
    }
  } catch {
    return { failure: "error" };
  }
}
