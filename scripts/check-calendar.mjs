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

const { sunTimes, sunAltitude } = require(`${OUT}calendar/astro.js`);
const { buildMonth } = require(`${OUT}calendar/lunar/index.js`);
const { unVesakDayKey } = require(`${OUT}calendar/lunar/vesak.js`);
const { zonedNoon } = require(`${OUT}calendar/tz.js`);
const { flightSunEvents } = require(`${OUT}calendar/flight/events.js`);
const { countdownTo } = require(`${OUT}calendar/countdown.js`);
const { nextFestival, vassaProgress } = require(`${OUT}calendar/festivals.js`);
const { CITY_COUNT, searchCities } = require(`${OUT}calendar/location/cities.js`);
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
  check("时刻先后顺序（明相 < 日出 < 日中 < 日没 < 日落）", ordered);
  check("蒙气差修正量不为负（负值已钳到 0）", positive);
  check("高纬度会走到兜底或极昼分支", fallbackSeen || polarSeen);
}

// 1b. 明相与日落是对称的一对，日没是另一回事（§2.2 的术语表）
//
// 明相 = 民用曙光 − 蒙气差、日落 = 民用日暮 + 同一份量，所以两者的太阳高度角
// 应当几乎相等；而日没取日面上缘切地平，比它们高好几度。这条不变量一旦破了，
// 多半是有人把 atthaṅgama 又挂回 sunset 上了。
{
  let symmetric = true;
  let distinct = true;
  let noonIsMax = true;
  let worstSym = 0;
  for (const [name, lat, lon, tz] of CITIES) {
    for (let day = 1; day <= 365; day += 7) {
      const at = new Date(Date.UTC(2026, 0, day));
      const t = sunTimes({ lat, lon }, zonedNoon(2026, at.getUTCMonth() + 1, at.getUTCDate(), tz));
      if (t.method !== "subtraction" || !t.aruna || !t.dusk || !t.sunset || !t.noon) continue;
      const a = sunAltitude({ lat, lon }, t.aruna);
      const d = sunAltitude({ lat, lon }, t.dusk);
      const s = sunAltitude({ lat, lon }, t.sunset);
      worstSym = Math.max(worstSym, Math.abs(a - d));
      if (Math.abs(a - d) > 0.3) {
        symmetric = false;
        console.log(`  不对称 ${name} 第 ${day} 天 明相 ${a.toFixed(3)}° 日落 ${d.toFixed(3)}°`);
      }
      if (s - d < 5) distinct = false;
      const noonAlt = sunAltitude({ lat, lon }, t.noon);
      for (const dt of [-1800e3, -600e3, 600e3, 1800e3]) {
        if (sunAltitude({ lat, lon }, new Date(t.noon.getTime() + dt)) > noonAlt + 1e-6) {
          noonIsMax = false;
        }
      }
    }
  }
  check(`明相与日落的太阳高度角对称（最大差 ${worstSym.toFixed(3)}°）`, symmetric);
  check("日没比日落高 5° 以上，两者不是同一条", distinct);
  check("日中是当天太阳高度角的极大值（上中天，不是 90°）", noonIsMax);
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

// 7. 雨安居进度：入安居次日为第 1 天，出安居当天 left=0，期外为 null
{
  const tz = "Asia/Yangon";
  // 2026 缅历：Waso 满月 7/29（入安居），Thadingyut 满月 10/26（出安居）。
  const cases = [
    ["2026-07-29", null, "满月当天还没进安居"],
    ["2026-07-30", { day: 1 }, "次日是第 1 天"],
    ["2026-10-26", { left: 0 }, "出安居当天剩 0 天"],
    ["2026-10-27", null, "出安居次日已出期"],
  ];
  for (const [key, expect, why] of cases) {
    const got = vassaProgress("myanmar", key, tz);
    const ok =
      expect === null
        ? got === null
        : got !== null &&
          (expect.day === undefined || got.day === expect.day) &&
          (expect.left === undefined || got.left === expect.left);
    check(`雨安居 ${key}：${why}`, ok, JSON.stringify(got));
  }
  const mid = vassaProgress("myanmar", "2026-09-10", tz);
  check(
    "雨安居期间 day + left = total",
    mid !== null && mid.day + mid.left === mid.total,
    JSON.stringify(mid),
  );
}

// 8. 下一个节日：一个月以内才报
{
  const tz = "Asia/Yangon";
  const near = nextFestival("myanmar", "2026-10-20", tz);
  check(
    "2026-10-20 的下一个节日是 6 天后的自恣日",
    near?.dayKey === "2026-10-26" && near?.inDays === 6,
    JSON.stringify(near),
  );
  const onDay = nextFestival("myanmar", "2026-10-26", tz);
  check("节日当天报 0 天", onDay?.inDays === 0, JSON.stringify(onDay));
  const far = nextFestival("myanmar", "2026-11-05", tz);
  check("一个月以外不报", far === null, JSON.stringify(far));
}

// 9. 倒计时：只在两小时以内给
{
  const now = new Date("2026-09-10T00:00:00Z");
  const at = (minutes) => new Date(now.getTime() + minutes * 60000);
  check("92 分钟后 → 1:32:00", countdownTo(at(92), now) === "1:32:00", String(countdownTo(at(92), now)));
  check("两小时零一分不给", countdownTo(at(121), now) === null);
  check("已经过去不给", countdownTo(at(-1), now) === null);
  check("时刻不存在（极昼）不给", countdownTo(null, now) === null);
}

// 10. 离线城镇表：常量与真表一致（提示文案里的数字靠它，不能脱节）
{
  const cities = require(`${OUT}calendar/location/cities.json`);
  check(
    `城镇数常量 ${CITY_COUNT} 与表一致`,
    CITY_COUNT === cities.rows.length,
    `表里有 ${cities.rows.length} 条`,
  );
  check(
    "本国文字能搜到城镇（缅文 မန္တလေး → Mandalay）",
    searchCities("မန္တလေး", 5).some((c) => c.ascii === "Mandalay"),
  );
}

// 11. 飞行：赫尔辛基 → 曼谷（12 月）必定遇到日暮，且事件按时间排序
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
    "HEL → BKK（12 月）途中遇到日落与明相",
    events.some((e) => e.kind === "dusk") && events.some((e) => e.kind === "aruna"),
    events.map((e) => e.kind).join(","),
  );
}

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项未通过`);
process.exit(failures === 0 ? 0 : 1);
