/**
 * 天文内核 —— `astronomy-engine` 的薄封装。
 *
 * 全 App 只有这一处直接 import `astronomy-engine`，其余模块走这里的类型。
 * 算法选型与参考文献见 `docs/buddhist-calendar.md` §2.1 / §2.2。
 */
import {
  AstroTime,
  Body,
  Horizon,
  Equator,
  MoonPhase as moonPhaseAngle,
  Observer,
  SearchAltitude,
  SearchHourAngle,
  SearchMoonPhase,
  SearchRiseSet,
  SearchSunLongitude,
} from "astronomy-engine";

export interface GeoPoint {
  lat: number;
  lon: number;
  /** 海拔（米）；不传按 0 算，对分钟级结果无影响。 */
  elevation?: number;
}

/** 一天的太阳三时刻；极昼极夜时对应字段为 `null`。 */
export interface SunTimes {
  /** 明相（民用曙光减去蒙气差，§2.2）—— 与日落 `dusk` 对称。 */
  aruna: Date | null;
  civilDawn: Date | null;
  nauticalDawn: Date | null;
  sunrise: Date | null;
  /** 日中 = 太阳上中天，不是日出日落的中点。 */
  noon: Date | null;
  sunset: Date | null;
  civilDusk: Date | null;
  nauticalDusk: Date | null;
  /** 日落（民用暮光加回蒙气差修正）—— 与明相对称，律上的日落取这一条。 */
  dusk: Date | null;
  /** 早晚各自的蒙气差修正量（秒）；走兜底分支时为 `null`。 */
  refractionMorning: number | null;
  refractionEvening: number | null;
  /** 修正量取自哪条路径，UI 与自检都要能分辨。 */
  method: "subtraction" | "fallback-altitude" | "none";
}

/** 明相的兜底阈值：民用曙光 −6° 加上 0.833°（大气折射 + 日面半径）。 */
export const ARUNA_FALLBACK_ALTITUDE = -6.833;

function observerOf(p: GeoPoint): Observer {
  return new Observer(p.lat, p.lon, p.elevation ?? 0);
}

/** 某个 UTC 瞬间所在「太阳日」的上中天时刻；找不到（极区某些日子）返回 null。 */
function transitOf(p: GeoPoint, near: Date): AstroTime | null {
  try {
    return SearchHourAngle(Body.Sun, observerOf(p), 0, new AstroTime(near)).time;
  } catch {
    return null;
  }
}

function altitudeTime(
  p: GeoPoint,
  start: AstroTime,
  direction: 1 | -1,
  altitude: number,
): Date | null {
  const t = SearchAltitude(Body.Sun, observerOf(p), direction, start, 1, altitude);
  return t ? t.date : null;
}

function riseSetTime(p: GeoPoint, start: AstroTime, direction: 1 | -1): Date | null {
  const t = SearchRiseSet(Body.Sun, observerOf(p), direction, start, 1);
  return t ? t.date : null;
}

const SECOND = 1000;

/**
 * 求某地某个太阳日的三时刻。
 *
 * `anyInstantOfDay` 给该地当日的任意瞬间（通常取当地正午前后），函数自己
 * 找到那一天的上中天，再**以上中天为锚**向前后各搜半天 —— 三个晨昏时刻必须
 * 取自同一个早晨，否则在日界附近会各搜到不同的日子，修正量算出来是十几个小时。
 *
 * 蒙气差修正（§2.2）：
 *   蒙气差 = (民用曙光 − 航海曙光) − (日出 − 民用曙光)
 *   明相   = 民用曙光 − 蒙气差
 * 日落侧对称。修正量为负时钳到 0（高纬度冬季会出现），航海曙光不存在时
 * 退回按 −6.833° 单次搜索。
 */
export function sunTimes(p: GeoPoint, anyInstantOfDay: Date): SunTimes {
  const empty: SunTimes = {
    aruna: null,
    civilDawn: null,
    nauticalDawn: null,
    sunrise: null,
    noon: null,
    sunset: null,
    civilDusk: null,
    nauticalDusk: null,
    dusk: null,
    refractionMorning: null,
    refractionEvening: null,
    method: "none",
  };

  const transit = transitOf(p, anyInstantOfDay);
  if (!transit) return empty;

  const morningStart = transit.AddDays(-0.5);
  const sunrise = riseSetTime(p, morningStart, 1);
  const civilDawn = altitudeTime(p, morningStart, 1, -6);
  const nauticalDawn = altitudeTime(p, morningStart, 1, -12);

  const sunset = riseSetTime(p, transit, -1);
  const civilDusk = altitudeTime(p, transit, -1, -6);
  const nauticalDusk = altitudeTime(p, transit, -1, -12);

  let method: SunTimes["method"] = "none";
  let refractionMorning: number | null = null;
  let refractionEvening: number | null = null;
  let aruna: Date | null = null;
  let dusk: Date | null = null;

  if (civilDawn && nauticalDawn && sunrise) {
    const seconds = Math.max(
      0,
      (civilDawn.getTime() - nauticalDawn.getTime() -
        (sunrise.getTime() - civilDawn.getTime())) / SECOND,
    );
    refractionMorning = seconds;
    aruna = new Date(civilDawn.getTime() - seconds * SECOND);
    method = "subtraction";
  } else if (sunrise) {
    // 航海曙光不存在（中高纬度夏季）：退回角度阈值。
    aruna = altitudeTime(p, morningStart, 1, ARUNA_FALLBACK_ALTITUDE);
    method = "fallback-altitude";
  }

  if (civilDusk && nauticalDusk && sunset) {
    const seconds = Math.max(
      0,
      (nauticalDusk.getTime() - civilDusk.getTime() -
        (civilDusk.getTime() - sunset.getTime())) / SECOND,
    );
    refractionEvening = seconds;
    dusk = new Date(civilDusk.getTime() + seconds * SECOND);
    if (method === "none") method = "subtraction";
  } else if (sunset) {
    dusk = altitudeTime(p, transit, -1, ARUNA_FALLBACK_ALTITUDE);
    if (method === "none") method = "fallback-altitude";
  }

  return {
    aruna,
    civilDawn,
    nauticalDawn,
    sunrise,
    noon: transit.date,
    sunset,
    civilDusk,
    nauticalDusk,
    dusk,
    refractionMorning,
    refractionEvening,
    method,
  };
}

/**
 * 太阳在某时某地的**视**高度角（度，含大气折射）—— 肉眼看上去的位置。
 */
export function sunAltitude(p: GeoPoint, at: Date): number {
  const time = new AstroTime(at);
  const eq = Equator(Body.Sun, time, observerOf(p), true, true);
  return Horizon(time, observerOf(p), eq.ra, eq.dec, "normal").altitude;
}

/**
 * 太阳的**几何**高度角（度，不含大气折射）。
 *
 * 晨昏的各种定义用的都是这一个：民用曙光 = 几何中心在地平线下 6°、航海曙光
 * −12°、`ARUNA_FALLBACK_ALTITUDE` −6.833° 也是几何角。拿含折射的视高度去跟
 * 这些阈值比会差 0.5°–0.6°，换算成时间是好几分钟，所以凡是**与阈值比较或
 * 标注判据角度**的地方，一律用这一个，别用 `sunAltitude`。
 */
export function sunAltitudeGeometric(p: GeoPoint, at: Date): number {
  const time = new AstroTime(at);
  const eq = Equator(Body.Sun, time, observerOf(p), true, true);
  return Horizon(time, observerOf(p), eq.ra, eq.dec, undefined).altitude;
}

/** 月相角（度）：0 朔、90 上弦、180 望、270 下弦。 */
export function moonPhase(at: Date): number {
  return moonPhaseAngle(new AstroTime(at));
}

/** 从 `after` 起搜下一个指定月相的时刻。 */
export function nextMoonPhase(targetAngle: number, after: Date, limitDays = 40): Date | null {
  const t = SearchMoonPhase(targetAngle, new AstroTime(after), limitDays);
  return t ? t.date : null;
}

/** 从 `after` 起搜太阳到达某个黄经的时刻（农历定气用）。 */
export function nextSunLongitude(degrees: number, after: Date, limitDays = 400): Date | null {
  const t = SearchSunLongitude(degrees, new AstroTime(after), limitDays);
  return t ? t.date : null;
}
