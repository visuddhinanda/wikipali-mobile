/**
 * 内置机场表（IATA → 坐标）。由 `scripts/gen-airports-table.mjs` 从 OurAirports
 * 生成（公有领域），只含有 IATA 码且有定期航班的机场，约 4000 条 / 160 KB。
 *
 * 机场时区不在原表里，用离机场最近的城镇的时区 —— 城镇表本来就要装（§3.2），
 * 不必再塞一份时区边界数据。
 */
import { nearestCity } from "../location/cities";

export interface Airport {
  iata: string;
  city: string;
  lat: number;
  lon: number;
  country: string;
  timeZone: string;
}

type Row = [string, string, number, number, string];

let table: Row[] | null = null;
function load(): Row[] {
  if (!table) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    table = require("./airports.json") as Row[];
  }
  return table;
}

export function findAirport(iata: string): Airport | null {
  const code = iata.trim().toUpperCase();
  if (code.length !== 3) return null;
  const row = load().find((r) => r[0] === code);
  if (!row) return null;
  const city = nearestCity(row[2], row[3]);
  return {
    iata: row[0],
    city: row[1],
    lat: row[2],
    lon: row[3],
    country: row[4],
    timeZone: city ? city.timeZone : "UTC",
  };
}
