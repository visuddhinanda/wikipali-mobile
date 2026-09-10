/**
 * OurAirports → 内置机场表（飞行计算用）。
 *
 * 用法：
 *   curl -O https://davidmegginson.github.io/ourairports-data/airports.csv
 *   node scripts/gen-airports-table.mjs airports.csv
 *
 * 数据许可：OurAirports，公有领域。
 *
 * 只留**有 IATA 码且有定期航班**的机场 —— 直升机坪与私人跑道对航班号查询没用。
 */
import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2] ?? "airports.csv";
const output = process.argv[3] ?? "src/calendar/flight/airports.json";

/** 极简 CSV 行解析：只需要处理引号包裹与转义引号。 */
function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(input, "utf8").split("\n");
const header = parseLine(lines[0]);
const col = (name) => header.indexOf(name);
const IATA = col("iata_code");
const NAME = col("name");
const LAT = col("latitude_deg");
const LON = col("longitude_deg");
const MUNI = col("municipality");
const COUNTRY = col("iso_country");
const SCHED = col("scheduled_service");
const TYPE = col("type");

const rows = [];
for (const line of lines.slice(1)) {
  if (!line.trim()) continue;
  const f = parseLine(line);
  const iata = f[IATA];
  if (!iata || iata.length !== 3) continue;
  if (f[SCHED] !== "yes") continue;
  if (!/airport/.test(f[TYPE])) continue;
  rows.push([
    iata,
    f[MUNI] || f[NAME],
    Math.round(Number(f[LAT]) * 1000) / 1000,
    Math.round(Number(f[LON]) * 1000) / 1000,
    f[COUNTRY],
  ]);
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync(output, JSON.stringify(rows));
console.log(`${rows.length} 个机场 → ${output}`);
