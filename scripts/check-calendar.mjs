/**
 * 佛教日历自检（`docs/buddhist-calendar.md` §7）。
 *
 * 跑在 Node 里，不进 App 包：
 *   npx tsc -p scripts/tsconfig.calendar.json && node scripts/check-calendar.mjs
 *
 * 断言分三类：天文时刻的自洽性、蒙气差修正的性质、各历法与已知日期的对照。
 * 有一条不过就退出码非 0。
 */
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const OUT = new URL("../.calendar-build/", import.meta.url).pathname;
if (!existsSync(OUT)) {
  console.error("先编译：npx tsc -p scripts/tsconfig.calendar.json");
  process.exit(2);
}
// 数据表是 JSON，tsc 不会搬，自己拷过去。
for (const [from, to] of [
  ["src/calendar/flight/airports.json", "calendar/flight/airports.json"],
  ["src/calendar/location/cities.json", "calendar/location/cities.json"],
]) {
  const target = `${OUT}${to}`;
  mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
  copyFileSync(new URL(`../${from}`, import.meta.url).pathname, target);
}

const { sunTimes } = require(`${OUT}calendar/astro.js`);
const { buildMonth } = require(`${OUT}calendar/lunar/index.js`);
const { unVesakDayKey } = require(`${OUT}calendar/lunar/vesak.js`);
const { zonedNoon } = require(`${OUT}calendar/tz.js`);
const { flightSunEvents } = require(`${OUT}calendar/flight/events.js`);
const { findAirport } = require(`${OUT}calendar/flight/airports.js`);

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) {
    failures++;
    console.log(`✗ ${name} ${detail}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

const CITIES = [
  ["Mandalay", 21.98, 96.08, "Asia/Yangon"],
  ["Yangon", 16.8, 96.15, "Asia/Yangon"],
  ["Bangkok", 13.75, 100.5, "Asia/Bangkok"],
  ["Colombo", 6.93, 79.86, "Asia/Colombo"],
  ["Kathmandu", 27.71, 85.32, "Asia/Kathmandu"],
  ["Taipei", 25.03, 121.57, "Asia/Taipei"],
  ["Sydney", -33.87, 151.21, "Australia/Sydney"],
  ["Reykjavik", 64.13, -21.9, "Atlantic/Reykjavik"],
];

// 1. 三时刻的顺序与蒙气差的性质
{
  let ordered = true;
  let positive = true;
  let polarSeen = false;
  let fallbackSeen = false;
  for (const [name, lat, lon, tz] of CITIES) {
    for (let day = 1; day <= 365; day += 7) {
      const at = new Date(Date.UTC(2026, 0, day));
      const t = sunTimes({ lat, lon }, zonedNoon(2026, at.getUTCMonth() + 1, at.getUTCDate(), tz));
      if (t.method === "none") {
        polarSeen = true;
        continue;
      }
      if (t.method === "fallback-altitude") fallbackSeen = true;
      if (t.aruna && t.sunrise && t.noon && t.sunset && t.dusk) {
        if (!(t.aruna < t.sunrise && t.sunrise < t.noon && t.noon < t.sunset && t.sunset < t.dusk)) {
          ordered = false;
          console.log(`  乱序 ${name} ${t.aruna?.toISOString()}`);
        }
      }
      if (t.refractionMorning !== null && t.refractionMorning < 0) positive = false;
    }
  }
  check("三时刻先后顺序（明相 < 日出 < 日中 < 日落 < 日暮）", ordered);
  check("蒙气差修正量不为负（负值已钳到 0）", positive);
  check("高纬度会走到兜底或极昼分支", fallbackSeen || polarSeen);
}

// 2. 明相夹在航海曙光与民用曙光之间，且热带的晨昏段长度合理
//
// 注：与 USNO / timeanddate 的逐分钟比对（文档 §7 第 1 条）要拿真实参考数据来跑，
// 不能凭印象写期望值 —— 这里只断言算法自身站得住的性质。
{
  let bracketed = true;
  let sane = true;
  for (const [name, lat, lon, tz] of CITIES.slice(0, 5)) {
    for (const [m, d] of [[3, 21], [6, 21], [9, 23], [12, 21]]) {
      const t = sunTimes({ lat, lon }, zonedNoon(2026, m, d, tz));
      if (t.method !== "subtraction" || !t.aruna || !t.civilDawn || !t.nauticalDawn) continue;
      if (!(t.nauticalDawn < t.aruna && t.aruna < t.civilDawn)) {
        bracketed = false;
        console.log(`  明相不在两曙光之间：${name} ${m}-${d}`);
      }
      // 热带地区民用曙光到日出约 20–30 分钟。
      const gap = (t.sunrise - t.civilDawn) / 60000;
      if (Math.abs(lat) < 25 && (gap < 18 || gap > 32)) {
        sane = false;
        console.log(`  晨昏段异常：${name} ${m}-${d} ${gap.toFixed(1)} min`);
      }
    }
  }
  check("明相夹在航海曙光与民用曙光之间", bracketed);
  check("热带地区民用曙光到日出 18–32 分钟", sane);
}

// 3. 农历：闰月与春节
{
  // 断言结构化字段，不断言文案 —— 月名与日名按界面语言拼，跟历法推算无关。
  const cases = [
    [2026, 2, "2026-02-17", 1, false],
    [2023, 3, "2023-03-22", 2, true],
    [2020, 5, "2020-05-23", 4, true],
    [2033, 12, "2033-12-22", 11, true],
  ];
  for (const [y, m, key, monthNumber, leap] of cases) {
    const day = buildMonth("chinese", { year: y, month: m, timeZone: "Asia/Shanghai" }).get(key);
    check(
      `农历 ${key} = ${leap ? "闰" : ""}${monthNumber} 月初一`,
      day?.monthNumber === monthNumber && day?.leapMonth === leap && day?.dayOfMonth === 1,
      `得到 月${day?.monthNumber} 闰${day?.leapMonth} 日${day?.dayOfMonth}`,
    );
  }
}

// 4. 缅历：布萨日一个月四次，且落在 8 / 15 / 23 / 月末
{
  const month = buildMonth("myanmar", { year: 2026, month: 9, timeZone: "Asia/Yangon" });
  const uposatha = [...month.values()].filter((d) => d.isUposatha);
  check("缅历 2026-09 布萨日四次", uposatha.length === 4, `得到 ${uposatha.length}`);
  check(
    "缅历布萨日都在半月的第 8 或第 14/15 日",
    uposatha.every((d) => [8, 14, 15].includes(d.fortnightDay)),
    uposatha.map((d) => `${d.dayKey}:${d.fortnightDay}`).join(" "),
  );
}

// 5. 国际卫塞节：五月第一个望
{
  for (const year of [2024, 2025, 2026, 2027]) {
    const key = unVesakDayKey(year, "Asia/Bangkok");
    const full = buildMonth("astro", { year, month: 5, timeZone: "Asia/Bangkok" });
    const firstFull = [...full.values()].find((d) => d.phase === "full");
    check(
      `${year} 国际卫塞节 = 五月第一个望`,
      key === firstFull?.dayKey,
      `${key} vs ${firstFull?.dayKey}`,
    );
  }
}

// 6. 泰历：与泰国官方公布的节日日期对照（含闰月年整体后移一个月）
{
  const cases = [
    [2026, 3, "2026-03-03", "makha", 4, false],
    [2026, 5, "2026-05-31", "vesakLocal", 7, false],
    [2026, 7, "2026-07-29", "vassaStart", 8, true],
    [2026, 10, "2026-10-26", "pavarana", 11, false],
    [2027, 2, "2027-02-21", "makha", 3, false],
    [2027, 5, "2027-05-20", "vesakLocal", 6, false],
    [2028, 2, "2028-02-10", "makha", 3, false],
  ];
  for (const [y, m, key, festival, monthNumber, repeated] of cases) {
    const day = buildMonth("thai", { year: y, month: m, timeZone: "Asia/Bangkok" }).get(key);
    check(
      `泰历 ${key} = ${repeated ? "第二个 " : ""}${monthNumber} 月满月 · ${festival}`,
      day?.monthNumber === monthNumber &&
        day?.repeatedMonth === repeated &&
        day?.phase === "full" &&
        day?.festivalKeys.includes(`calendar.festival.${festival}`),
      `得到 月${day?.monthNumber} 重复${day?.repeatedMonth} ${day?.festivalKeys.join(",")}`,
    );
  }
}

// 7. 飞行：赫尔辛基 → 曼谷（12 月）必定遇到日暮，且事件按时间排序
{
  const leg = {
    from: findAirport("HEL"),
    to: findAirport("BKK"),
    departure: new Date("2026-12-15T16:30:00+02:00"),
    arrival: new Date("2026-12-16T07:15:00+07:00"),
  };
  const events = flightSunEvents(leg);
  const sorted = events.every((e, i) => i === 0 || events[i - 1].at <= e.at);
  check("飞行事件按时间排序", sorted);
  check(
    "HEL → BKK（12 月）途中遇到日暮与明相",
    events.some((e) => e.kind === "dusk") && events.some((e) => e.kind === "aruna"),
    events.map((e) => e.kind).join(","),
  );
}

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项未通过`);
process.exit(failures === 0 ? 0 : 1);
