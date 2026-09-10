/**
 * 日历页的数据绑定。
 *
 * 位置与月份推算都放这里，屏幕只管画：位置要在多个屏之间共享（月历、日详情、
 * 飞行），月份推算要能缓存（同一个月切回来不重算）。
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CALENDAR_SYSTEMS, buildMonth, type CalendarSystem, type LunarMonth } from "./lunar";
import { locate, isGpsAvailable } from "./location/gps";
import {
  fallbackPlace,
  loadSavedPlace,
  savePlace,
  type Place,
} from "./location/place";
import { sunTimes, type SunTimes } from "./astro";
import { zonedNoon } from "./tz";

export interface PlaceState {
  place: Place;
  /** 首次读取偏好 / 正在定位。 */
  busy: boolean;
  /** 定位失败过（UI 据此显示降级提示条）。 */
  failed: boolean;
  gpsAvailable: boolean;
  locateNow: () => Promise<void>;
  choose: (place: Place) => Promise<void>;
}

/**
 * 观察地是**跨屏共享的一份状态**，不是每个屏各自的 useState。
 *
 * 位置屏选完城镇要立刻反映到月历与日详情上；各屏各持一份 state 的话，
 * 选完返回还是旧地点（存是存下了，但要重进 App 才生效）。所以放模块级，
 * 屏幕通过 `useSyncExternalStore` 订阅。
 */
interface Store {
  place: Place;
  busy: boolean;
  failed: boolean;
}

let store: Store = { place: fallbackPlace(), busy: true, failed: false };
const listeners = new Set<() => void>();
let bootstrapped = false;

function setStore(patch: Partial<Store>): void {
  store = { ...store, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function locateNow(): Promise<void> {
  setStore({ busy: true });
  const result = await locate();
  if (result.place) {
    setStore({ place: result.place, failed: false, busy: false });
    await savePlace(result.place);
  } else {
    setStore({ failed: true, busy: false });
  }
}

async function choose(next: Place): Promise<void> {
  setStore({ place: next, failed: false, busy: false });
  await savePlace(next);
}

/** 首次挂载时读一次偏好；存过就不再问 GPS。 */
async function bootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  const saved = await loadSavedPlace();
  if (saved) {
    setStore({ place: saved, busy: false });
    return;
  }
  if (isGpsAvailable()) {
    await locateNow();
  } else {
    setStore({ failed: true, busy: false });
  }
}

export function usePlace(): PlaceState {
  const snapshot = useSyncExternalStore(subscribe, () => store);
  useEffect(() => {
    void bootstrap();
  }, []);
  return {
    place: snapshot.place,
    busy: snapshot.busy,
    failed: snapshot.failed,
    gpsAvailable: isGpsAvailable(),
    locateNow,
    choose,
  };
}

/**
 * 当前选的历法。
 *
 * 和观察地一样放模块级：从日详情返回时页面会重挂载，用 `useState` 的话
 * 每次回来都跳回默认历法，用户刚切过去的选择就丢了。
 */
let selectedSystem: CalendarSystem | null = null;
const systemListeners = new Set<() => void>();
let systemLoaded = false;

const SYSTEM_STORAGE_KEY = "@wikipali/calendar-system";

function emitSystem(): void {
  for (const listener of systemListeners) listener();
}

export function useCalendarSystem(
  fallback: CalendarSystem,
): [CalendarSystem, (next: CalendarSystem) => void] {
  const current = useSyncExternalStore(
    (listener) => {
      systemListeners.add(listener);
      return () => systemListeners.delete(listener);
    },
    () => selectedSystem,
  );

  // 选过的历法要跨启动记住，跟巴利字体偏好一个道理。
  useEffect(() => {
    if (systemLoaded) return;
    systemLoaded = true;
    void AsyncStorage.getItem(SYSTEM_STORAGE_KEY).then((saved) => {
      if (saved && CALENDAR_SYSTEMS.includes(saved as CalendarSystem)) {
        selectedSystem = saved as CalendarSystem;
        emitSystem();
      }
    });
  }, []);

  const set = (next: CalendarSystem) => {
    selectedSystem = next;
    emitSystem();
    void AsyncStorage.setItem(SYSTEM_STORAGE_KEY, next);
  };
  return [current ?? fallback, set];
}

/** 某历法某个公历月的推算结果；同一个（历法, 年, 月, 时区）只算一次。 */
export function useLunarMonth(
  system: CalendarSystem,
  year: number,
  month: number,
  timeZone: string,
): LunarMonth {
  return useMemo(
    () => buildMonth(system, { year, month, timeZone }),
    [system, year, month, timeZone],
  );
}

/** 某地某日的三时刻。 */
export function useSunTimes(
  place: Place,
  year: number,
  month: number,
  day: number,
): SunTimes {
  return useMemo(
    () =>
      sunTimes(
        { lat: place.lat, lon: place.lon },
        zonedNoon(year, month, day, place.timeZone),
      ),
    [place.lat, place.lon, place.timeZone, year, month, day],
  );
}
