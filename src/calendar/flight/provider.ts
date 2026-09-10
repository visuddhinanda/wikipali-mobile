/**
 * 航班数据（§4.1）。
 *
 * 只需要四样：起降机场 IATA 码与计划起降时刻。默认接 AeroDataBox
 * （免费档 600 units/月），key 走本地设置，不硬编码进包；**没有 key 也能用** ——
 * 手填起降机场与时刻，计算部分完全离线。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { resolveBaseUrl } from "../../api/config";
import { findAirport, type Airport } from "./airports";

const KEY_STORAGE = "@wikipali/flight-api-key";

/** 构建期注入的 key（`.env` 的 `EXPO_PUBLIC_FLIGHT_API_KEY`），不进仓库。 */
const ENV_FLIGHT_KEY = process.env.EXPO_PUBLIC_FLIGHT_API_KEY?.trim() ?? "";

export interface FlightSchedule {
  flightNumber: string;
  airline?: string;
  from: Airport;
  to: Airport;
  /** 计划起飞 / 降落（UTC 瞬间）。 */
  departure: Date;
  arrival: Date;
  /** 数据是查来的还是手填的 —— UI 要能分辨，手填的没有免责声明问题。 */
  source: "network" | "manual";
}

export async function getFlightApiKey(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export async function setFlightApiKey(key: string): Promise<void> {
  await AsyncStorage.setItem(KEY_STORAGE, key.trim());
}

/** 联不上网 —— 由 UI 直接切到手填，不当成「查询失败」。 */
export class OfflineError extends Error {}
/** 联上了但查不到这个航班（号码或日期不对）。 */
export class FlightNotFoundError extends Error {}
/** 联上了但查询服务不可用（没配 key、额度用尽、服务端出错）。 */
export class LookupUnavailableError extends Error {}

interface AeroDataBoxFlight {
  number?: string;
  airline?: { name?: string };
  departure?: { airport?: { iata?: string }; scheduledTime?: { utc?: string } };
  arrival?: { airport?: { iata?: string }; scheduledTime?: { utc?: string } };
}

/** AeroDataBox 的 UTC 时刻形如 `2026-09-30 01:30Z`。 */
function parseUtc(value: string | undefined): Date | null {
  if (!value) return null;
  const iso = value.trim().replace(" ", "T").replace(/Z?$/, "Z");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 有没有网。
 *
 * 不引 `expo-network`（又一个原生依赖，还要重新出包）：拿一个极短超时的
 * HEAD 请求探一下就够了，反正紧接着就要发真正的查询。
 */
async function isOnline(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    // 探本 App 自己的后端，不探航班服务商：那个域名被墙或被 DNS 污染时
    // 会把「有网但查不了航班」误报成「没网」，用户就白等一次手填。
    // 只要有响应就算通，404 也算 —— 我们要的是「包能出去」。
    await fetch(await resolveBaseUrl(), { method: "HEAD", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 按航班号 + 日期查计划时刻。
 *
 * **联网就查在线实时计划**，联不上才退到手填 —— 判据是网络，不是有没有配好
 * 服务：用户不该为了看一眼航班先去设置页填 key。key 的来源依次是构建期
 * 的 `EXPO_PUBLIC_FLIGHT_API_KEY` 与本地设置。
 *
 * 三种失败分开抛，UI 的说法完全不同：没网、查不到、服务不可用。
 */
export async function lookupFlight(
  flightNumber: string,
  date: string,
): Promise<FlightSchedule> {
  const number = flightNumber.replace(/\s+/g, "").toUpperCase();
  const key = ENV_FLIGHT_KEY || (await getFlightApiKey());
  if (!key) {
    // 没 key 也要先分清是「没网」还是「没配服务」，否则离线时会误报配置问题。
    if (!(await isOnline())) throw new OfflineError();
    throw new LookupUnavailableError("no api key");
  }

  const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(number)}/${date}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": "aerodatabox.p.rapidapi.com",
      },
    });
  } catch {
    throw new OfflineError();
  }

  if (response.status === 404) throw new FlightNotFoundError();
  if (!response.ok) throw new LookupUnavailableError(`HTTP ${response.status}`);

  const list = (await response.json()) as AeroDataBoxFlight[];
  const flight = Array.isArray(list) ? list[0] : null;
  if (!flight) throw new FlightNotFoundError();

  const from = findAirport(flight.departure?.airport?.iata ?? "");
  const to = findAirport(flight.arrival?.airport?.iata ?? "");
  const departure = parseUtc(flight.departure?.scheduledTime?.utc);
  const arrival = parseUtc(flight.arrival?.scheduledTime?.utc);
  if (!from || !to || !departure || !arrival) throw new FlightNotFoundError();

  return {
    flightNumber: number,
    airline: flight.airline?.name,
    from,
    to,
    departure,
    arrival,
    source: "network",
  };
}

/** 手填：给两个 IATA 码与当地时刻，自己组成一段航程。 */
export function manualSchedule(
  fromIata: string,
  toIata: string,
  departure: Date,
  arrival: Date,
): FlightSchedule | null {
  const from = findAirport(fromIata);
  const to = findAirport(toIata);
  if (!from || !to) return null;
  return { flightNumber: "", from, to, departure, arrival, source: "manual" };
}
