/**
 * 常用地点。
 *
 * 一个人常算的地点就那么几个：自己的寺院、常去挂单的道场、家人所在的城市。
 * 每次都重新搜一遍太笨，所以存一份清单，点一下就切过去。
 *
 * 存 AsyncStorage，按 `lat,lon` 去重（同名不同地的城镇不少）。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Place } from "./place";

const STORAGE_KEY = "@wikipali/calendar-favorites";

/** 上限：再多就该做搜索而不是列表了。 */
export const MAX_FAVORITES = 12;

function idOf(place: Place): string {
  return `${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
}

export function isSamePlace(a: Place, b: Place): boolean {
  return idOf(a) === idOf(b);
}

export async function loadFavorites(): Promise<Place[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Place[];
    return Array.isArray(list)
      ? list.filter((p) => typeof p?.lat === "number" && typeof p?.lon === "number" && p.timeZone)
      : [];
  } catch {
    return [];
  }
}

async function save(list: Place[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 存不下不影响本次使用
  }
}

/** 加入常用；已经在里面就原样返回。新的排在最前面。 */
export async function addFavorite(place: Place): Promise<Place[]> {
  const list = await loadFavorites();
  if (list.some((p) => isSamePlace(p, place))) return list;
  // GPS 定位的精度是一次性的，存进常用没有意义，去掉。
  const next = [{ ...place, source: "city" as const, accuracy: undefined }, ...list].slice(
    0,
    MAX_FAVORITES,
  );
  await save(next);
  return next;
}

export async function removeFavorite(place: Place): Promise<Place[]> {
  const next = (await loadFavorites()).filter((p) => !isSamePlace(p, place));
  await save(next);
  return next;
}
