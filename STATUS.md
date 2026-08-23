# wikipali-mobile 进度记录（2026-08-23）

> 本文件记录 mobile 项目的完整进展与交接信息，供后续会话续接使用。

## 1. 项目背景

- 这是「巴利经文 AI 问答助手（POC）」的移动端，从 monorepo `agent-poc` 的 `mobile/` 目录**独立迁移**而来
- 技术栈：Expo SDK 57（React Native 0.86、TypeScript）+ `@copilotkit/react-native` 1.69
- 依赖后端链路：**runtime(:3001) → backend(:8000) → DeepSeek**（mobile 不直连 backend）
- 本机局域网 IP：**172.21.238.212**（podman 容器，host 网络模式）

## 2. 关键架构结论（务必遵守，勿再走弯路）

### 2.1 CopilotChat 必须从 `components` 子路径导入

`@copilotkit/react-native` 有两个入口，导入错了会导致 UI 空白或找不到 agent：

| 导入路径 | CopilotChat 类型 | agent 属性 |
|---|---|---|
| `@copilotkit/react-native`（根入口）| **headless**（只渲染 children，无 UI）| `agentId` |
| `@copilotkit/react-native/components` | **完整 UI 版**（标题/消息/输入框）| `agentName`（旧 API）|

`App.tsx` 当前正确写法：
```tsx
import { CopilotKitProvider } from '@copilotkit/react-native';
import { CopilotChat } from '@copilotkit/react-native/components';
// ...
<CopilotChat agentName="pali_agent" ... />
```

### 2.2 必须用 development build，不能用 Expo Go

项目依赖 `react-native-enriched-markdown`（含 android/ios/cpp **原生代码**），Expo Go 预编译运行时**不含**该原生模块，AI 一输出 markdown 回答就报 `EnrichedMarkdownText ... not found in ViewManagerRegistry` 并闪退。

→ **正式方式就是 development build**（`eas build -p android --profile development`），已走通。

### 2.3 何时需要重新构建 APK（判断标准）

development build 的 APK **基本只装一次**：业务 JS/TS 代码不打包进 APK，而是运行时从 Metro 现拉，保存即 Fast Refresh/Reload。只有动到「原生层」才需要 `eas build` 重新出包并重装。

| 改动 | 是否重建 APK |
|---|---|
| 改 JS/TS 业务代码（`App.tsx`、组件、逻辑、样式） | ❌ 不用，Metro 秒刷 |
| 改 `.env` 的 `EXPO_PUBLIC_*` | ❌ 不用，重启 `expo start` 即可 |
| 改 `metro.config.js` / babel 等打包配置 | ❌ 不用，重启 Metro |
| **新增/升级/删除含原生代码的依赖**（带 android/ios/cpp 的库） | ✅ 要重建 |
| 改 `app.json` 的原生配置（权限、`package`、图标、splash、插件等） | ✅ 要重建 |
| 升级 `expo-dev-client` 或 Expo SDK 大版本 | ✅ 要重建 |

一句话：**只动 JS/TS = 热更到底；动了原生层（原生依赖 / 原生配置）才重建。**

### 2.4 其他已踩过的坑

- `index.ts` 的 polyfill 导入顺序是强制的（`react-native-get-random-values` 第一行 → `@copilotkit/react-native/polyfills`），勿调整
- `metro.config.js` 有官方 jose 的 `node:buffer` 修复，勿删
- Expo CLI/Metro 需写 `~/.expo`，在沙箱环境用 `__UNSAFE_EXPO_HOME_DIRECTORY=<工作区>/.expo-home` 重定向
- EAS CLI 需写 `~/.config`，用 `XDG_CONFIG_HOME=<工作区>/.eas-config` 重定向

### 2.5 streamdown/worklets 版本冲突（已 patch-package 修复）

**症状**：输入问题后 AI 开始流式输出 markdown，随即报
`[Worklets] Tried to synchronously call a Remote Function. Called "vn" on the remend-processor Runtime.`

**根因**：`@copilotkit/react-native` 的 `CopilotMarkdown` 用 `react-native-streamdown@0.2.0` 渲染流式 markdown，其 `remendWorklet.js` 依赖 worklets 的 **Bundle Mode**（需要 babel 插件选项 `workletizableModules: ['remend']`，该选项只在 `react-native-worklets@0.8.x` 存在）。而 Expo SDK 57 / RN 0.86 / `react-native-reanimated@4.5.1` 强制安装 `react-native-worklets@0.10.x`，此选项已被移除 → `remend` 被当作 Remote Function，在 worklet 里被同步调用即抛错。

**修复**：用 `patch-package` 给 `react-native-streamdown` 打补丁，把 `remend` 改为在 JS 线程直接执行（remend 是纯 JS，聊天单条消息量级无性能问题）：

- 补丁文件：`patches/react-native-streamdown+0.2.0.patch`
- 已加 `postinstall: "patch-package"` 脚本 + devDependency `patch-package`，`npm install` 后自动重打
- 不要删除 `patches/` 目录（已确认 `.gitignore` 未忽略）

> 注意：这是绕过 worklets Bundle Mode，不是修复 worklets 本身。若以后升级 streamdown 到兼容 worklets 0.10.x 的版本，可移除该补丁并恢复官方 Bundle Mode 配置（`babel.config.js` + `metro.config.js` 的 Bundle Mode 设置）。

## 3. 当前文件状态

### 3.1 `app.json`（已配好 EAS）
- `android.package: "com.iapt.mobile"`
- `owner: "iapt"`
- `extra.eas.projectId: "97a761eb-3495-419b-aba9-1cc195dd8d5c"`

### 3.2 `eas.json`
- `development` profile：`developmentClient: true` + `distribution: internal` ✅

### 3.3 `.env`
```
EXPO_PUBLIC_RUNTIME_URL=http://172.21.238.212:3001/api/copilotkit
```
（注意：真机必须用电脑局域网 IP，不能用 localhost）

### 3.4 `.easignore`（已排除 node_modules 等，构建包 638KB）
```
node_modules/
.expo/
dist/
web-build/
expo-env.d.ts
.env
.env*.local
/ios
/android
*.log
.DS_Store
*.tsbuildinfo
.metro-health-check*
```

## 4. EAS 构建信息

- **Expo 账号**：`iapt`（robot user `wikipali-agent`，角色 Developer）
- **EAS 项目**：`@iapt/mobile`（projectId `97a761eb-3495-419b-aba9-1cc195dd8d5c`）
- **已装** `expo-dev-client ~57.0.14`（development build 必需）
- **最近一次 development build 成功**：build id `b7da8ed8-060a-443b-965c-e25bf1e0938e`
  - APK 安装链接：https://expo.dev/accounts/iapt/projects/mobile/builds/b7da8ed8-060a-443b-965c-e25bf1e0938e
- 构建打包问题已解决：独立 git 仓库（本项目）后，EAS 打包范围 = 项目根，`.easignore` 排除 node_modules，压缩包 638KB

### EAS 登录方式（token）
- 用 robot user 的 access token + `EXPO_TOKEN` 环境变量非交互登录（token 不外传，需时重新生成或沿用已给的）
- eas-cli 装在**本项目内** `/home/deploy/workspace/wikipali-mobile/eas-tool/`（本地目录，避免全局 npm 缓存 EACCES）
- `.eas-config`、`.expo-home` 也已移入本项目根目录（EAS/Expo 的本地配置与缓存）
- 构建命令参考（均使用本项目内路径）：
```bash
export EXPO_TOKEN="<token>"
export XDG_CONFIG_HOME="/home/deploy/workspace/wikipali-mobile/.eas-config"
export __UNSAFE_EXPO_HOME_DIRECTORY="/home/deploy/workspace/wikipali-mobile/.expo-home"
export CI=1
cd /home/deploy/workspace/wikipali-mobile
/home/deploy/workspace/wikipali-mobile/eas-tool/node_modules/.bin/eas build -p android --profile development --non-interactive
```

## 5. 服务端口与状态（截至迁移时）

| 服务 | 端口 | 说明 |
|---|---|---|
| backend（uvicorn）| 8000 | DeepSeek 真实 key 已配置，模型 `deepseek-v4-flash` |
| runtime（CopilotKit）| 3001 | 转发到 backend，agent id = `pali_agent` |
| web（next dev）| 3000 | 已跑通 |
| Metro | 8081 | **需在本目录（wikipali-mobile）重启** |

## 6. 手机真机测试步骤

1. 手机与电脑同一 WiFi
2. 装 development build APK（上面的安装链接）
3. 打开 app → 输入开发服务器地址：`exp://172.21.238.212:8081`
4. 测试「什么是四圣谛？」，应看到工具调用 `retrieve_sutta_passage` + 流式回答（markdown 正常渲染）

## 7. 待办

- [x] 手机安装 APK 并连 Metro 验证完整链路 ✅（2026-08-23 已通：对话正常渲染）
- [x] 修复 streamdown/worklets 崩溃 ✅（2.5 节的 patch-package 补丁已在真机验证生效）
- [ ] git 提交：`wikipali-mobile` 有大量未跟踪文件（源码全是 `??`），且新增了 `patches/`、`package.json`（postinstall + patch-package），务必一起 commit
- [ ] 可选：app 显示名还是 `mobile`，如需可改 `app.json` 的 `name`/`slug`

## 8. 沙箱权限提示（重要）

- 本项目位于 `/home/deploy/workspace/wikipali-mobile`，若新会话的 workspace 就是这个目录，则无需特殊权限
- 若 workspace 仍是 `agent-poc`，则写本目录（及 `.expo` 日志）需 `danger-full-access` 权限
- backend/runtime/web 仍在 `/home/deploy/workspace/agent-poc/`（monorepo），未迁移
