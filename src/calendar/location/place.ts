/**
 * 观察地 —— 日历页所有时刻都按它算。
 *
 * 来源有两种，UI 要能分辨：GPS 定位、用户手选的城镇。**没有兜底地点**：
 * 定位成功之前不显示任何时刻（占位 `-:-:-`），定位失败就明说「定位失败」，
 * 不拿一个替代地点冒充。只有用户**手工选择**的城镇才持久化，下次启动直接复用；
 * GPS 结果不落盘，下次启动重新定位。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { City } from "./cities";

export type PlaceSource = "gps" | "city";

export interface Place {
  name: string;
  /** 反向地理编码给出的上一级行政区（如「Badulla District」）；离线兜底时没有。 */
  subtitle?: string;
  lat: number;
  lon: number;
  timeZone: string;
  source: PlaceSource;
  /** GPS 的水平精度（米）；手选城镇没有。 */
  accuracy?: number;
}

const STORAGE_KEY = "@wikipali/calendar-place";

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
