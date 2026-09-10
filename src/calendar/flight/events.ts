/**
 * 沿途太阳事件（§4.2）。
 *
 * 把航程按每分钟切一个采样点，对每点用它自己的经纬度求太阳高度角：
 * - 升穿 −6.833° = 明相，降穿 = 日暮（阈值与地面一致，机上判日界用同一个定义）；
 * - 高度角的局部极大 = 日中（对飞行中的观察者，地面那套「上中天」公式不成立）。
 *
 * 巡航高度会让地平线下沉：`dip = arccos(R / (R + h))`，10 km 高空约 3.2°，
 * 也就是比地面早三分多钟见到日出。默认按 11 km 巡航计入，UI 会写明。
 */
import { sunAltitude } from "../astro";
import { ARUNA_FALLBACK_ALTITUDE } from "../astro";
import { EARTH_RADIUS_KM, distanceKm, interpolate, type LatLon } from "./greatcircle";

export type FlightEventKind = "departure" | "aruna" | "noon" | "dusk" | "arrival";

export interface FlightEvent {
  kind: FlightEventKind;
  at: Date;
  position: LatLon;
  /** 该时刻的太阳高度角（度，已含地平线下沉修正）。 */
  altitude: number;
}

export interface FlightLeg {
  from: LatLon;
  to: LatLon;
  departure: Date;
  arrival: Date;
  /** 巡航高度（米）；不传按 11000 m 算。 */
  cruiseAltitudeM?: number;
}

/** 巡航高度带来的地平线下沉（度）。 */
export function horizonDip(altitudeM: number): number {
  const r = EARTH_RADIUS_KM;
  return Math.acos(r / (r + altitudeM / 1000)) * (180 / Math.PI);
}

interface Sample {
  t: number;
  position: LatLon;
  altitude: number;
}

/** 起降之间每分钟一个采样点（航程再长也就几百个点，纯算术）。 */
function samples(leg: FlightLeg, dip: number): Sample[] {
  const start = leg.departure.getTime();
  const end = leg.arrival.getTime();
  const span = end - start;
  const steps = Math.max(2, Math.min(1440, Math.round(span / 60000)));
  const out: Sample[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const t = start + span * f;
    const position = interpolate(leg.from, leg.to, f);
    out.push({ t, position, altitude: sunAltitude(position, new Date(t)) + dip });
  }
  return out;
}

/** 在两个采样点之间二分细化穿越时刻（到秒）。 */
function refine(
  leg: FlightLeg,
  dip: number,
  a: Sample,
  b: Sample,
  threshold: number,
): Sample {
  let lo = a;
  let hi = b;
  const start = leg.departure.getTime();
  const span = leg.arrival.getTime() - start;
  for (let i = 0; i < 20 && hi.t - lo.t > 1000; i++) {
    const t = (lo.t + hi.t) / 2;
    const f = span === 0 ? 0 : (t - start) / span;
    const position = interpolate(leg.from, leg.to, f);
    const altitude = sunAltitude(position, new Date(t)) + dip;
    const mid: Sample = { t, position, altitude };
    const crossesInLower = (lo.altitude - threshold) * (altitude - threshold) <= 0;
    if (crossesInLower) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** 求航程中的太阳事件，按时间排序；起降两点永远在列。 */
export function flightSunEvents(leg: FlightLeg): FlightEvent[] {
  const dip = horizonDip(leg.cruiseAltitudeM ?? 11000);
  const pts = samples(leg, dip);
  const threshold = ARUNA_FALLBACK_ALTITUDE;
  const events: FlightEvent[] = [];

  const first = pts[0];
  const last = pts[pts.length - 1];
  events.push({
    kind: "departure",
    at: new Date(first.t),
    position: first.position,
    altitude: first.altitude,
  });

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];

    // 穿越 −6.833°：升为明相，降为日暮。
    if ((prev.altitude - threshold) * (cur.altitude - threshold) < 0) {
      const hit = refine(leg, dip, prev, cur, threshold);
      events.push({
        kind: cur.altitude > prev.altitude ? "aruna" : "dusk",
        at: new Date(hit.t),
        position: hit.position,
        altitude: hit.altitude,
      });
    }

    // 局部极大 = 日中（端点不算，起降时刻另有条目）。
    if (
      i < pts.length - 1 &&
      cur.altitude > prev.altitude &&
      cur.altitude >= pts[i + 1].altitude &&
      cur.altitude > threshold
    ) {
      events.push({
        kind: "noon",
        at: new Date(cur.t),
        position: cur.position,
        altitude: cur.altitude,
      });
    }
  }

  events.push({
    kind: "arrival",
    at: new Date(last.t),
    position: last.position,
    altitude: last.altitude,
  });
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** 航程大圆距离（km），UI 上和时长一起显示。 */
export function legDistanceKm(leg: FlightLeg): number {
  return distanceKm(leg.from, leg.to);
}
