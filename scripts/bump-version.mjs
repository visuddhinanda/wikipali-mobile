#!/usr/bin/env node
/**
 * 升版本号：同时改 app.json 的 expo.version 和 package.json 的 version。
 *
 *   npm run version:bump -- patch      0.1.0 → 0.1.1
 *   npm run version:bump -- minor      0.1.0 → 0.2.0
 *   npm run version:bump -- major      0.1.0 → 1.0.0
 *   npm run version:bump -- 0.3.0      指定版本（必须比当前大）
 *
 * Android versionCode 由 app.config.ts 按 `主×10000 + 次×100 + 修订` 自动算，不用手改。
 * 只改文件，不提交、不打 tag —— 提交与发布由人来做（见 docs/development.md §5）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parse(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`不是「主.次.修订」格式：${version}`);
  return m.slice(1).map(Number);
}

/** 与 app.config.ts 的 versionCodeOf 同一公式（scripts/check-version.mjs 校验一致）。 */
export function versionCodeOf(version) {
  const [major, minor, patch] = parse(version);
  if (minor > 99 || patch > 99) {
    throw new Error(`次版本号与修订号不能超过 99（versionCode 编码限制）：${version}`);
  }
  return major * 10000 + minor * 100 + patch;
}

function next(current, arg) {
  const [major, minor, patch] = parse(current);
  switch (arg) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      parse(arg);
      return arg;
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(join(root, file), "utf8"));
}

function writeJson(file, data) {
  writeFileSync(join(root, file), JSON.stringify(data, null, 2) + "\n");
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("用法：npm run version:bump -- <patch|minor|major|x.y.z>");
    process.exit(1);
  }

  const app = readJson("app.json");
  const pkg = readJson("package.json");
  const current = app.expo.version;
  const target = next(current, arg);

  const from = versionCodeOf(current);
  const to = versionCodeOf(target);
  if (to <= from) {
    throw new Error(`新版本 ${target}（${to}）必须比当前 ${current}（${from}）大`);
  }

  app.expo.version = target;
  pkg.version = target;
  writeJson("app.json", app);
  writeJson("package.json", pkg);

  console.log(`版本 ${current} → ${target}（versionCode ${from} → ${to}）`);
  console.log("下一步：npx expo prebuild -p android，再 ./gradlew assembleRelease");
}

// 被 check-version.mjs import 时不执行
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
