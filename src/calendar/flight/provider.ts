/**
 * 航班数据（§4.1）。
 *
 * 只需要四样：起降机场 IATA 码与计划起降时刻。默认接 AeroDataBox
 * （免费档 600 units/月），key 走本地设置，不硬编码进包；**没有 key 也能用** ——
 * 手填起降机场与时刻，计算部分完全离线。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { findAirport, type Airport } from "./airports";

const KEY_STORAGE = "@wikipali/flight-api-key";

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

export class NoFlightProviderError extends Error {}

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
 * 按航班号 + 日期查计划时刻。
 *
 * 查不到、没 key、网络不通都抛出来，由 UI 引导用户改用手填 —— 这条路必须
 * 一直可用，不能因为查不到航班整个功能就废了。
 */
export async function lookupFlight(
  flightNumber: string,
  date: string,
): Promise<FlightSchedule> {
  const key = await getFlightApiKey();
  if (!key) throw new NoFlightProviderError("no api key");

  const number = flightNumber.replace(/\s+/g, "").toUpperCase();
  const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(number)}/${date}`;
  const response = await fetch(url, {
    headers: {
      "x-rapidapi-key": key,
      "x-rapidapi-host": "aerodatabox.p.rapidapi.com",
    },
  });
  if (!response.ok) throw new Error(`flight lookup failed: ${response.status}`);

  const list = (await response.json()) as AeroDataBoxFlight[];
  const flight = Array.isArray(list) ? list[0] : null;
  if (!flight) throw new Error("flight not found");

  const from = findAirport(flight.departure?.airport?.iata ?? "");
  const to = findAirport(flight.arrival?.airport?.iata ?? "");
  const departure = parseUtc(flight.departure?.scheduledTime?.utc);
  const arrival = parseUtc(flight.arrival?.scheduledTime?.utc);
  if (!from || !to || !departure || !arrival) throw new Error("incomplete flight data");

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
