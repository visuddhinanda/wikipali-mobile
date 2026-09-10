/**
 * 大圆航线插值（§4.2）。
 *
 * 公式取自 Ed Williams, *Aviation Formulary V1.46*：两点间按中心角做球面
 * 线性插值（slerp），比在经纬度上直接线性插值正确得多 —— 跨极区或跨日界线时
 * 后者会画出一条根本不存在的航线。
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
/** 地球平均半径（km）。 */
export const EARTH_RADIUS_KM = 6371.0088;

export interface LatLon {
  lat: number;
  lon: number;
}

/** 两点间的中心角（弧度）。 */
function centralAngle(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const dφ = φ2 - φ1;
  const dλ = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 大圆距离（km）。 */
export function distanceKm(a: LatLon, b: LatLon): number {
  return centralAngle(a, b) * EARTH_RADIUS_KM;
}

/** 航程比例 `f`（0 起点、1 终点）处的坐标。 */
export function interpolate(a: LatLon, b: LatLon, f: number): LatLon {
  const d = centralAngle(a, b);
  if (d < 1e-9) return { ...a };

  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const φ1 = a.lat * RAD;
  const λ1 = a.lon * RAD;
  const φ2 = b.lat * RAD;
  const λ2 = b.lon * RAD;

  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);

  return {
    lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * DEG,
    lon: Math.atan2(y, x) * DEG,
  };
}
