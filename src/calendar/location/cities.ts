/**
 * 离线城镇表 —— 定位失败时的降级入口（§3.2）。
 *
 * 不用 `expo-location` 的 `geocodeAsync`：它依赖系统服务、要联网，官方文档还
 * 明确警告「资源消耗大，请求过多会报错」。这里内置 GeoNames `cities15000`
 * （CC BY 4.0，人口 ≥ 15000 的城镇），无网也能用。
 *
 * 表由 `scripts/gen-cities-table.mjs` 生成；**懒加载**，进日历页不解析，
 * 真的要搜城镇时才 require。
 */

export interface City {
  name: string;
  /** 罗马转写；与 name 相同时表里存空串。 */
  ascii: string;
  lat: number;
  lon: number;
  /** ISO 3166-1 alpha-2。 */
  country: string;
  timeZone: string;
  population: number;
  /** 本国文字别名（缅 / 泰 / 僧伽罗 / 老挝 / 汉），搜索时一并匹配。 */
  aliases: string[];
}

type Row = [string, string, number, number, string, number, number, string];
interface Table {
  zones: string[];
  rows: Row[];
}

let table: Table | null = null;

function load(): Table {
  if (!table) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    table = require("./cities.json") as Table;
  }
  return table;
}

function toCity(row: Row, zones: string[]): City {
  return {
    name: row[0],
    ascii: row[1] || row[0],
    lat: row[2],
    lon: row[3],
    country: row[4],
    timeZone: zones[row[5]],
    population: row[6],
    aliases: row[7] ? row[7].split("|") : [],
  };
}

/**
 * 按名字搜城镇。
 *
 * 表按人口从多到少排好序，所以「先前缀命中、再子串命中」天然就是大城市在前。
 * 罗马转写与本国文字都能命中（缅文 မန္တလေး 与 Mandalay 都指向同一条）。
 */
export function searchCities(query: string, limit = 20): City[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const { zones, rows } = load();

  const prefix: City[] = [];
  const contains: City[] = [];

  for (const row of rows) {
    const name = row[0].toLowerCase();
    const ascii = (row[1] || row[0]).toLowerCase();
    const aliases = row[7];
    if (name.startsWith(q) || ascii.startsWith(q) || aliases.startsWith(query)) {
      prefix.push(toCity(row, zones));
      if (prefix.length >= limit) break;
    } else if (
      contains.length < limit &&
      (name.includes(q) || ascii.includes(q) || aliases.includes(query))
    ) {
      contains.push(toCity(row, zones));
    }
  }
  return [...prefix, ...contains].slice(0, limit);
}

/** 各界面语言用的文字区段，用来从别名里挑“读者认得的那一个”。 */
const LOCALE_SCRIPTS: Record<string, [number, number][]> = {
  "zh-Hans": [[0x4e00, 0x9fff]],
  "zh-Hant": [[0x4e00, 0x9fff]],
  my: [[0x1000, 0x109f]],
  th: [[0x0e00, 0x0e7f]],
  si: [[0x0d80, 0x0dff]],
  lo: [[0x0e80, 0x0eff]],
};

/**
 * 挑一个该语言读者认得的别名。
 *
 * 别名表里缅、泰、僧伽罗、老挝、汉各种写法混在一起，直接取第一个，中文界面
 * 会显示泰文 —— 没有意义。
 */
export function aliasForLocale(city: City, locale: string): string | null {
  const ranges = LOCALE_SCRIPTS[locale];
  if (!ranges) return null;
  for (const alias of city.aliases) {
    for (const ch of alias) {
      const c = ch.codePointAt(0) ?? 0;
      if (ranges.some(([lo, hi]) => c >= lo && c <= hi)) return alias;
    }
  }
  return null;
}

/** 离给定坐标最近的城镇 —— GPS 拿到坐标后用它反查地名与时区。 */
export function nearestCity(lat: number, lon: number): City | null {
  const { zones, rows } = load();
  let best: Row | null = null;
  let bestScore = Infinity;
  const latScale = Math.cos((lat * Math.PI) / 180);
  for (const row of rows) {
    const dLat = row[2] - lat;
    const dLon = (row[3] - lon) * latScale;
    const score = dLat * dLat + dLon * dLon;
    if (score < bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best ? toCity(best, zones) : null;
}
