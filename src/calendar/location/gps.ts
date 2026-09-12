/**
 * GPS 定位（§3.1）。
 *
 * `expo-location` 含原生代码：**旧的 dev client / 安装包里没有这个模块**，
 * 直接 import 会在启动时炸掉整个 App。所以这里懒 require + try/catch，
 * 取不到就当定位不可用，UI 走城镇搜索的降级路径（`calendar.location.unavailable`）。
 *
 * 精度必须 `High`：`Low`/`Balanced` 在 Android 上映射为
 * `PRIORITY_BALANCED_POWER_ACCURACY`，只走网络/基站、不启用 GPS 卫星，误差
 * 可达上百公里（实测把 Badulla 判成 Jaffna）。日出日落对精度确实不敏感，
 * 但「离你最近的城市名」和时区都靠它，所以要用 `High` 触发 GPS。
 *
 * `getCurrentPositionAsync` **没有 timeout 参数**，且存在偶尔永久挂住的 bug
 * （expo/expo#10756）。所以每次真正定位都套一个我们能控制的 `withTimeout`
 * 计时器，并遵循「缓存优先 + 重试一次」：
 *
 *   真正定位（20s）→ 失败且有缓存 → 用缓存
 *                    → 失败且无缓存 → 重试一次（20s）
 *                    → 仍失败 → 报 `timeout`
 *
 * 每一处失败都会把「发生了什么、返回值是什么、超时与否、耗时」记进
 * `diagnostics`，供调试弹窗一键复制 —— 定位失败不能静默。
 */
import type { Place } from "./place";
import { nearestCity } from "./cities";
import { isOnline } from "../../api/connectivity";

export type GpsFailure = "unavailable" | "denied" | "timeout" | "error";

/** 单次真正定位（`getCurrentPositionAsync`）的超时上限；GPS 冷启动可能 >10s。 */
export const FRESH_TIMEOUT_MS = 20_000;

/** 反向地理编码（`reverseGeocodeAsync`）的超时上限；它走网络，卡住就放弃。 */
const REVERSE_GEOCODE_TIMEOUT_MS = 5_000;

/** 定位过程中每一个可能失败的环节的现场快照。 */
export interface GpsDiagnostics {
  /** 原生模块是否在 `globalThis.expo.modules` 里登记过（null = 拿不到登记表）。 */
  nativeRegistered: boolean | null;
  /** require 之后模块对象是否可用。 */
  moduleLoaded: boolean;
  /** 权限请求的结果状态（"granted" / "denied" / 其他），没走到这步为 null。 */
  permissionStatus: string | null;
  /** 权限请求抛出的错误（含 message + stack）。 */
  permissionError: string | null;
  /** 最后已知位置的坐标。 */
  lastKnown: { latitude: number; longitude: number; accuracy: number | null } | null;
  /** getLastKnownPositionAsync 的错误。 */
  lastKnownError: string | null;
  /** 最终拿到的当前坐标（成功时）。 */
  current: { latitude: number; longitude: number; accuracy: number | null } | null;
  /** 最后一次真正定位的错误。 */
  currentError: string | null;
  /** 真正定位尝试了几次（不含读缓存）。 */
  attempts: number;
  /** 是否自动重试过一次（第一次失败且无缓存）。 */
  retried: boolean;
  /** 是否有某次尝试撞到了我们自己的超时。 */
  timedOut: boolean;
  /** 从发起定位到出结果的总耗时（毫秒）。 */
  elapsedMs: number;
  /** 最终的失败类型；成功为 null。 */
  failure: GpsFailure | null;
}

export interface GpsResult {
  place?: Place;
  failure?: GpsFailure;
  diagnostics: GpsDiagnostics;
}

/** `reverseGeocodeAsync` 返回的地址里，只取行政区那几个字段。 */
interface GeocodedAddress {
  district: string | null;
  city: string | null;
  subregion: string | null;
  region: string | null;
  country: string | null;
}

interface ExpoLocationModule {
  requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  getLastKnownPositionAsync(): Promise<{
    coords: { latitude: number; longitude: number; accuracy: number | null };
  } | null>;
  getCurrentPositionAsync(options: { accuracy: number }): Promise<{
    coords: { latitude: number; longitude: number; accuracy: number | null };
  }>;
  reverseGeocodeAsync(location: {
    latitude: number;
    longitude: number;
  }): Promise<GeocodedAddress[]>;
  Accuracy: { High: number };
}

/** 我们自己的超时哨兵，用来和原生抛出的错误区分。 */
class GpsTimeoutError extends Error {
  constructor() {
    super("location request timed out");
    this.name = "GpsTimeoutError";
  }
}

function emptyDiagnostics(): GpsDiagnostics {
  return {
    nativeRegistered: null,
    moduleLoaded: false,
    permissionStatus: null,
    permissionError: null,
    lastKnown: null,
    lastKnownError: null,
    current: null,
    currentError: null,
    attempts: 0,
    retried: false,
    timedOut: false,
    elapsedMs: 0,
    failure: null,
  };
}

/** 把任意 throw 出来的东西转成可读的字符串（message + stack 都保留）。 */
function stringifyError(e: unknown): string {
  if (e instanceof Error) {
    return e.stack ? `${e.message}\n${e.stack}` : e.message;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function coordsOf(c: {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}): GpsDiagnostics["current"] {
  return { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy };
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

/**
 * 用系统反向地理编码取「最小行政区」和它的上一级。
 *
 * `expo-location` 的 `reverseGeocodeAsync` 底层是系统 Geocoder（Android 走
 * Google、iOS 走 Apple），**要联网**且某些设备（无 GMS）上不可用。所以先探网、
 * 再调用，失败就返回 null，由调用方回落离线城镇表。
 *
 * 行政区层级从小到大：district(街道/社区) → city(市/镇) → subregion(县/区)
 * → region(省/州) → country(国家)。取第一个非空作 name，第二个作 subtitle。
 */
async function reverseGeocodeName(
  lat: number,
  lon: number,
): Promise<{ name: string; subtitle?: string } | null> {
  const mod = loadModule();
  if (!mod) return null;
  try {
    const list = await withTimeout(
      mod.reverseGeocodeAsync({ latitude: lat, longitude: lon }),
      REVERSE_GEOCODE_TIMEOUT_MS,
    );
    const first = list?.[0];
    if (!first) return null;
    const levels = [first.district, first.city, first.subregion, first.region, first.country].filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
    if (levels.length === 0) return null;
    const [name, subtitle] = levels;
    return subtitle ? { name, subtitle } : { name };
  } catch {
    return null;
  }
}

async function toPlace(
  coords: { latitude: number; longitude: number; accuracy: number | null },
): Promise<Place> {
  // 时区始终取最近的城镇 —— 系统反查在 Android 上不返回时区（timezone 恒为 null）。
  const city = nearestCity(coords.latitude, coords.longitude);
  const timeZone = city ? city.timeZone : "UTC";

  // 有网时优先用系统反向地理编码给更精确的地名，拿不到再回落离线城镇表。
  if (await isOnline()) {
    const geocoded = await reverseGeocodeName(coords.latitude, coords.longitude);
    if (geocoded) {
      return {
        name: geocoded.name,
        subtitle: geocoded.subtitle,
        lat: coords.latitude,
        lon: coords.longitude,
        timeZone,
        source: "gps",
        accuracy: coords.accuracy ?? undefined,
      };
    }
  }

  return {
    // 名字与时区取最近的城镇；坐标仍用 GPS 的真值，不要用城镇中心去算时刻。
    name: city ? city.name : `${coords.latitude.toFixed(2)}, ${coords.longitude.toFixed(2)}`,
    lat: coords.latitude,
    lon: coords.longitude,
    timeZone,
    source: "gps",
    accuracy: coords.accuracy ?? undefined,
  };
}

/** 给一个 Promise 套上我们能控制的超时：超时未决就 reject 成 `GpsTimeoutError`。 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GpsTimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface LocateOptions {
  /** 真正定位的超时（毫秒），默认 `FRESH_TIMEOUT_MS`。 */
  timeoutMs?: number;
  /** 第一次失败且无缓存时是否自动重试一次，默认 true。 */
  retry?: boolean;
  /** 开始重试前回调（UI 用来显示「正在重试」）。 */
  onRetry?: () => void;
}

/**
 * 取一次当前位置：真正定位（带超时）→ 缓存兜底 → 重试一次 → 失败。
 */
export async function locate(options: LocateOptions = {}): Promise<GpsResult> {
  const timeoutMs = options.timeoutMs ?? FRESH_TIMEOUT_MS;
  const shouldRetry = options.retry ?? true;
  const started = Date.now();

  const diagnostics = emptyDiagnostics();
  diagnostics.nativeRegistered = nativeRegistered();

  const mod = loadModule();
  diagnostics.moduleLoaded = mod !== null;
  if (!mod) {
    diagnostics.failure = "unavailable";
    diagnostics.elapsedMs = Date.now() - started;
    return { failure: "unavailable", diagnostics };
  }

  try {
    let permission: { status: string };
    try {
      permission = await mod.requestForegroundPermissionsAsync();
      diagnostics.permissionStatus = permission.status;
    } catch (e) {
      diagnostics.permissionError = stringifyError(e);
      diagnostics.failure = "error";
      diagnostics.elapsedMs = Date.now() - started;
      return { failure: "error", diagnostics };
    }
    if (permission.status !== "granted") {
      diagnostics.failure = "denied";
      diagnostics.elapsedMs = Date.now() - started;
      return { failure: "denied", diagnostics };
    }

    // 缓存：最后已知位置，立等可取，作为「缓存优先」的兜底。
    let last: { coords: { latitude: number; longitude: number; accuracy: number | null } } | null =
      null;
    try {
      last = await mod.getLastKnownPositionAsync();
      if (last) diagnostics.lastKnown = coordsOf(last.coords);
    } catch (e) {
      diagnostics.lastKnownError = stringifyError(e);
    }

    const tryFresh = (): Promise<{ coords: { latitude: number; longitude: number; accuracy: number | null } }> =>
      withTimeout(mod.getCurrentPositionAsync({ accuracy: mod.Accuracy.High }), timeoutMs);

    const recordFailure = (e: unknown): void => {
      diagnostics.currentError =
        e instanceof GpsTimeoutError ? `timed out after ${timeoutMs}ms` : stringifyError(e);
      if (e instanceof GpsTimeoutError) diagnostics.timedOut = true;
    };

    // 第一次真正定位。
    diagnostics.attempts = 1;
    try {
      const current = await tryFresh();
      diagnostics.current = coordsOf(current.coords);
      diagnostics.elapsedMs = Date.now() - started;
      return { place: await toPlace(current.coords), diagnostics };
    } catch (e) {
      recordFailure(e);
      // 缓存优先：新鲜定位失败时，先拿最后已知位置兜底，而不是急着重试。
      if (last) {
        diagnostics.elapsedMs = Date.now() - started;
        return { place: await toPlace(last.coords), diagnostics };
      }
    }

    // 无缓存，自动重试一次。
    if (shouldRetry) {
      diagnostics.retried = true;
      options.onRetry?.();
      diagnostics.attempts = 2;
      try {
        const current = await tryFresh();
        diagnostics.current = coordsOf(current.coords);
        diagnostics.elapsedMs = Date.now() - started;
        return { place: await toPlace(current.coords), diagnostics };
      } catch (e) {
        recordFailure(e);
      }
    }

    diagnostics.failure = diagnostics.timedOut ? "timeout" : "error";
    diagnostics.elapsedMs = Date.now() - started;
    return { failure: diagnostics.failure, diagnostics };
  } catch (e) {
    diagnostics.failure = "error";
    diagnostics.permissionError = diagnostics.permissionError ?? stringifyError(e);
    diagnostics.elapsedMs = Date.now() - started;
    return { failure: "error", diagnostics };
  }
}
