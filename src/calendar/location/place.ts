/**
 * 观察地 —— 日历页所有时刻都按它算。
 *
 * 来源有三种，UI 要能分辨：GPS 定位、用户手选的城镇、以及都没有时的兜底。
 * 选择持久化，选过之后不再每次问。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { City } from "./cities";

export type PlaceSource = "gps" | "city" | "fallback";

export interface Place {
  name: string;
  lat: number;
  lon: number;
  timeZone: string;
  source: PlaceSource;
  /** GPS 的水平精度（米）；手选城镇没有。 */
  accuracy?: number;
}

const STORAGE_KEY = "@wikipali/calendar-place";

/** 都没有时的兜底：菩提伽耶。至少给出一组能自洽的时刻，而不是空页面。 */
export const FALLBACK_PLACE: Place = {
  name: "Bodh Gayā",
  lat: 24.6959,
  lon: 84.9866,
  timeZone: "Asia/Kolkata",
  source: "fallback",
};

export function placeFromCity(city: City): Place {
  return {
    name: city.name,
    lat: city.lat,
    lon: city.lon,
    timeZone: city.timeZone,
    source: "city",
  };
}

export async function loadSavedPlace(): Promise<Place | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Place;
    if (typeof p.lat === "number" && typeof p.lon === "number" && p.timeZone) return p;
  } catch {
    // 存坏了就当没存过
  }
  return null;
}

export async function savePlace(place: Place): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(place));
  } catch {
    // 存不下不影响本次使用
  }
}

/**
 * 兜底地点。
 *
 * 坐标与时区必须是同一个地方的 —— 用设备时区配菩提伽耶的经纬度会得到一组
 * 谁都对不上的时刻，还不如老老实实说「这是菩提伽耶的时间」。
 */
export function fallbackPlace(): Place {
  return { ...FALLBACK_PLACE };
}
