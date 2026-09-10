/**
 * 航班 API 连通性自检 —— 上真机之前先在这儿跑通。
 *
 *   node scripts/check-flight-api.mjs [航班号] [日期]
 *   node scripts/check-flight-api.mjs UL308 2026-09-11
 *
 * 读 `.env` 里的 `EXPO_PUBLIC_AERODATABOX_API_KEY`（不打印 key 本身）。
 * 把 App 里 `lookupFlight()` 的那套错误分类照抄一遍，所以这里的结论
 * 就是真机上会看到的结论。
 */
import { readFileSync, existsSync } from "node:fs";

const HOST = "aerodatabox.p.rapidapi.com";
const number = (process.argv[2] ?? "UL308").toUpperCase();
const date = process.argv[3] ?? new Date().toISOString().slice(0, 10);

function envKey() {
  if (process.env.EXPO_PUBLIC_AERODATABOX_API_KEY) {
    return process.env.EXPO_PUBLIC_AERODATABOX_API_KEY.trim();
  }
  if (!existsSync(".env")) return "";
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^EXPO_PUBLIC_AERODATABOX_API_KEY=(.*)$/.exec(line.trim());
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

const key = envKey();
if (!key) {
  console.error("✗ .env 里没有 EXPO_PUBLIC_AERODATABOX_API_KEY");
  process.exit(2);
}
console.log(`key 长度 ${key.length}，查 ${number} @ ${date}`);

async function call(path) {
  const res = await fetch(`https://${HOST}${path}`, {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": HOST },
  });
  const text = await res.text();
  return { status: res.status, text };
}

// 1) 订阅状态：额度接口最便宜，403 就说明账号没订阅这个 API
const balance = await call("/health/services/feeds/FlightRadar24");
if (balance.status === 401 || balance.status === 403) {
  console.error(`✗ ${balance.status} ${balance.text.slice(0, 120)}`);
  console.error(
    "  → 到 https://rapidapi.com/aedbx-aedbx/api/aerodatabox 点 Subscribe（Basic 免费档），\n" +
      "    key 才会对这个 API 生效。同一个 RapidAPI key 要对每个 API 单独订阅。",
  );
  process.exit(1);
}

// 2) 真正的航班查询
const flight = await call(`/flights/number/${encodeURIComponent(number)}/${date}`);
console.log(`航班查询 HTTP ${flight.status}`);

if (flight.status === 404) {
  console.log("✓ 服务通了，但这天没有这班（App 会说「核对航班号与日期」）");
  process.exit(0);
}
if (flight.status !== 200) {
  console.error(`✗ ${flight.text.slice(0, 200)}`);
  process.exit(1);
}

const list = JSON.parse(flight.text);
if (!Array.isArray(list) || !list.length) {
  console.log("✓ 服务通了，但返回空（App 会说「核对航班号与日期」）");
  process.exit(0);
}

for (const f of list) {
  const dep = f.departure ?? {};
  const arr = f.arrival ?? {};
  console.log(
    `✓ ${f.number ?? number} ${f.airline?.name ?? ""}\n` +
      `  ${dep.airport?.iata ?? "?"} ${dep.scheduledTime?.utc ?? "?"}\n` +
      `  → ${arr.airport?.iata ?? "?"} ${arr.scheduledTime?.utc ?? "?"}`,
  );
}
