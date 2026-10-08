/**
 * 动态配置：在 app.json（静态配置，Expo CLI 先读它再传进来）的基础上补算版本号。
 *
 * 版本号只维护一处：app.json 的 `expo.version`（语义化版本 `主.次.修订`）。
 * Android 判断「能否覆盖升级」看的是整数 `versionCode`，这里由 version 推出来：
 *
 *   versionCode = 主 × 10000 + 次 × 100 + 修订      例：0.2.3 → 203，1.0.0 → 10000
 *
 * 只要 version 往上升，versionCode 就一定变大；代价是次版本号、修订号都不能超过 99。
 * 改版本号用 `npm run version:bump`（scripts/bump-version.mjs，会同步 package.json），
 * 改完要 `npx expo prebuild -p android` 才会写进 android/（见 docs/development.md §5）。
 * 同一公式在 bump 脚本里也有一份，`scripts/check-version.mjs` 校验两边一致。
 */
import type { ConfigContext, ExpoConfig } from "expo/config";

function versionCodeOf(version: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) {
    throw new Error(`app.json expo.version 必须是「主.次.修订」：${version}`);
  }
  const [major, minor, patch] = m.slice(1).map(Number);
  if (minor > 99 || patch > 99) {
    throw new Error(`次版本号与修订号不能超过 99（versionCode 编码限制）：${version}`);
  }
  return major * 10000 + minor * 100 + patch;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const version = config.version ?? "0.0.0";
  const versionCode = versionCodeOf(version);
  return {
    ...config,
    name: config.name ?? "Wikipali",
    slug: config.slug ?? "mobile",
    version,
    android: { ...config.android, versionCode },
    ios: { ...config.ios, buildNumber: String(versionCode) },
  };
};
