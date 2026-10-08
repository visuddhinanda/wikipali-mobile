#!/usr/bin/env node
/**
 * 版本号自检：
 *   1. app.json 与 package.json 的版本一致；
 *   2. Expo 解析出的最终配置（含 app.config.ts）里 android.versionCode / ios.buildNumber
 *      与 bump 脚本的公式一致 —— 防止两份公式改歪；
 *   3. 公式本身的边界（单调、超 99 报错）。
 *
 *   node scripts/check-version.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { versionCodeOf } from "./bump-version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (f) => JSON.parse(readFileSync(join(root, f), "utf8"));

// 1. 两处版本一致
const appVersion = readJson("app.json").expo.version;
const pkgVersion = readJson("package.json").version;
assert.equal(pkgVersion, appVersion, `package.json ${pkgVersion} ≠ app.json ${appVersion}`);

// 2. Expo 最终配置
const out = execFileSync("npx", ["expo", "config", "--json", "--type", "public"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});
const config = JSON.parse(out.slice(out.indexOf("{")));
const expected = versionCodeOf(appVersion);
assert.equal(config.version, appVersion);
assert.equal(config.android.versionCode, expected, "android.versionCode 与公式不一致");
assert.equal(config.ios.buildNumber, String(expected), "ios.buildNumber 与公式不一致");

// 3. 公式边界
assert.equal(versionCodeOf("0.1.0"), 100);
assert.equal(versionCodeOf("0.2.3"), 203);
assert.equal(versionCodeOf("1.0.0"), 10000);
assert.ok(versionCodeOf("0.99.99") < versionCodeOf("1.0.0"), "跨主版本必须单调");
assert.throws(() => versionCodeOf("0.100.0"));
assert.throws(() => versionCodeOf("1.0"));

console.log(`OK  version ${appVersion} → versionCode ${expected}`);
