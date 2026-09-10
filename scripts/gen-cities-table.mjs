/**
 * GeoNames cities15000 → 内置离线城镇表。
 *
 * 用法：
 *   curl -O https://download.geonames.org/export/dump/cities15000.zip && unzip cities15000.zip
 *   node scripts/gen-cities-table.mjs cities15000.txt
 *
 * 数据许可：GeoNames，CC BY 4.0。
 *
 * 只留搜索与计算真正要用的列，别名只保留**本 App 界面语言的文字**（汉、缅、泰、
 * 僧伽罗、老挝）—— 拉丁别名由 asciiname 覆盖，不必重复存。
 */
import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2] ?? "cities15000.txt";
const output = process.argv[3] ?? "src/calendar/location/cities.json";

/** 界面语言用到的文字区段。 */
const SCRIPTS = [
  [0x4e00, 0x9fff], // 汉
  [0x3400, 0x4dbf],
  [0x1000, 0x109f], // 缅
  [0x0e00, 0x0e7f], // 泰
  [0x0d80, 0x0dff], // 僧伽罗
  [0x0e80, 0x0eff], // 老挝
];

function keepAlias(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    for (const [lo, hi] of SCRIPTS) if (c >= lo && c <= hi) return true;
  }
  return false;
}

const zones = [];
const zoneIndex = new Map();
function zoneId(tz) {
  let i = zoneIndex.get(tz);
  if (i === undefined) {
    i = zones.length;
    zones.push(tz);
    zoneIndex.set(tz, i);
  }
  return i;
}

const rows = [];
for (const line of readFileSync(input, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const f = line.split("\t");
  const [, name, ascii, alternates, lat, lon] = f;
  const country = f[8];
  const population = Number(f[14]) || 0;
  const tz = f[17];
  if (!tz) continue;
  const alts = [
    ...new Set(
      (alternates ? alternates.split(",") : [])
        .filter(keepAlias)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  rows.push([
    name,
    ascii === name ? "" : ascii,
    Math.round(Number(lat) * 1000) / 1000,
    Math.round(Number(lon) * 1000) / 1000,
    country,
    zoneId(tz),
    population,
    alts.length ? alts.join("|") : "",
  ]);
}

// 人口从多到少：同名前缀下先出现大城市。
rows.sort((a, b) => b[6] - a[6]);

writeFileSync(output, JSON.stringify({ zones, rows }));
console.log(`${rows.length} 个城镇，${zones.length} 个时区 → ${output}`);
