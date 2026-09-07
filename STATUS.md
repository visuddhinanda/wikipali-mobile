# wikipali-mobile 进度记录（更新至 2026-09-06）

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
- ⚠️ **Metro 文件监听会撞 inotify 上限**（本机无 watchman，Metro 用 Node `fs.watch` 逐目录监听，`node_modules` 有 8000+ 目录，`fs.watch` 约 3600 个就报 `ENOSPC: System limit for number of file watchers`）。症状：改 JS/TS 后**不触发重编译、设备拿到旧 bundle**（表现为「点了没反应」），或 `expo start --clear` 直接崩。**解决：用 `CI=1` 启动**（`CI=1 npx expo start --lan`）。注意：CI 模式关闭 Metro 监听，且 Metro 把文件地图**只在首次打包时构建一次并缓存**，所以**每次改代码后必须重启 `expo start` 才会生效**（重启后真机再手动 Reload 一次）；没有 Fast Refresh。`--clear` 可加可不加（CI 模式不再触发 `fs.watch`，`--clear` 不会崩，能确保全新构建）。

### 2.5 streamdown/worklets 版本冲突（已 patch-package 修复）

**症状**：输入问题后 AI 开始流式输出 markdown，随即报
`[Worklets] Tried to synchronously call a Remote Function. Called "vn" on the remend-processor Runtime.`

**根因**：`@copilotkit/react-native` 的 `CopilotMarkdown` 用 `react-native-streamdown@0.2.0` 渲染流式 markdown，其 `remendWorklet.js` 依赖 worklets 的 **Bundle Mode**（需要 babel 插件选项 `workletizableModules: ['remend']`，该选项只在 `react-native-worklets@0.8.x` 存在）。而 Expo SDK 57 / RN 0.86 / `react-native-reanimated@4.5.1` 强制安装 `react-native-worklets@0.10.x`，此选项已被移除 → `remend` 被当作 Remote Function，在 worklet 里被同步调用即抛错。

**修复**：用 `patch-package` 给 `react-native-streamdown` 打补丁，把 `remend` 改为在 JS 线程直接执行（remend 是纯 JS，聊天单条消息量级无性能问题）：

- 补丁文件：`patches/react-native-streamdown+0.2.0.patch`
- 已加 `postinstall: "patch-package"` 脚本 + devDependency `patch-package`，`npm install` 后自动重打
- 不要删除 `patches/` 目录（已确认 `.gitignore` 未忽略）

> 注意：这是绕过 worklets Bundle Mode，不是修复 worklets 本身。若以后升级 streamdown 到兼容 worklets 0.10.x 的版本，可移除该补丁并恢复官方 Bundle Mode 配置（`babel.config.js` + `metro.config.js` 的 Bundle Mode 设置）。

### 2.6 CopilotKit 60s 超时导致「tool call 过程报 Network request failed」（已 patch-package 修复）

**症状**：聊天时 tool call 能显示，但工具执行过程中报
`TypeError: Network request failed`（伴随 `[CopilotKit] Error (agent_run_failed)`）。

**根因**：`@copilotkit/react-native` 的 streaming-fetch polyfill（XHR 实现）写死 `xhr.timeout = 6e4`（60 秒）。RN Android 把 `xhr.timeout` 映射成 OkHttp 的 **`callTimeout`（整个请求的总时长上限，不是无数据间隔超时）**；而 agent 一次运行（DeepSeek 流式 + 多次 MCP 工具调用 next.wikipali.org）实测约 **70s+**，超过 60s 就被掐断。且 OkHttp `callTimeout` 抛的是 `InterruptedIOException`（不是 `SocketTimeoutException`），RN 的 `NetworkEventUtil` 只认 `SocketTimeoutException` 才置 `timeOutError=true`，于是被当成普通网络错误 → JS 侧走 `onerror` → 报「Network request failed」（而非「timed out」）。

**修复**：patch 掉 `@copilotkit/react-native` 的 `dist/streaming-fetch-*.mjs`，把 `xhr.timeout = 6e4` 改为 `600000`（10 分钟）：

- 补丁文件：`patches/@copilotkit+react-native+1.69.0.patch`
- 该文件是 `dist/` 下带构建 hash 的文件名，升级 `@copilotkit/react-native` 后补丁可能因路径变化失效，需重新生成

> 注意：backend（agent-poc，独立工作区 `/home/deploy/workspace/agent-poc`）一次 agent 运行约 70s 属正常（不是 bug）；runtime→backend 用 node fetch，默认 body/headers 超时 300s，当前够用。若以后问题更长，需同时排查 runtime 侧 undici 超时。

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

## 9. P0（App 架构骨架）—— 2026-08-23 完成

按 `DESIGN.md` 的 P0 落地：5 Tab 导航 + 米黄纸感主题 + 三藏目录树 → 章节列表 → 阅读器（WebView HTML）。

### 9.1 目录结构

```
src/
  theme/index.ts          米黄纸感主题（colors/spacing/type/serif/cardShadow）
  catalog/                三藏目录树（仅 default.json 从 mint 复制）+ 类型 + 中文标签
  api/                    client(config/env) + catalog(真实) + mock(回退) + index(门面)
  navigation/             RootNavigator（根 Stack + 5 Tab）+ types
  components/Screen.tsx   统一纸面容器
  screens/                Discover / CategoryBrowse / ChapterList / Reader + Bookshelf/AiChat/Tools/Profile/NewChat
```

### 9.2 关键改动

- **新增依赖（含原生代码 → 必须 EAS 重建 APK）**：`react-native-screens` 4.26、`react-native-safe-area-context` 5.7、`react-native-webview` 13.16、`@react-native-async-storage/async-storage` 2.2（纯 JS：`@react-navigation/*` 7、`@expo/vector-icons` 15）
- **导航**：React Navigation v7（`@react-navigation/native` + `bottom-tabs` + `native-stack`），AI Chat 为中间凸起 Tab
- **App.tsx**：`GestureHandlerRootView → SafeAreaProvider → CopilotKitProvider → RootNavigator`（CopilotKit 仍包住全树，`NewChat` 屏复用原 `CopilotChat`）
- **数据源**：目录树 JSON 本地打包（离线可用）；书目/正文走 `src/api` 门面——后端地址 = `.env` 的 `EXPO_PUBLIC_API_URL`（测试覆盖）或「我 → 设置 → API 服务器」选择的域名（默认 `next.wikipali.org`）；请求失败回退 `mock.ts`（内置 8 篇知名经文 + Tufte sidenote 示例 HTML）
- **阅读器**：`react-native-webview` 渲染，注入「纸面 + Tufte sidenote」CSS（宽屏右侧边注 / 窄屏行内折叠）
- **设置**：`src/settings/server.ts` 用 AsyncStorage 持久化 API 服务器选择；「我 → 设置」提供 4 个域名选项（next.wikipali.cc / www.wikipali.cc / next.wikipali.org / www.wikipali.org）

### 9.3 真机验证前必做

1. **重建 development build**（新增了 4 个原生依赖，旧 APK 不含这些模块，直接 reload 会崩）
2. 真机选后端：进「我 → 设置 → API 服务器」选域名（默认 `next.wikipali.org`）；`.env` 的 `EXPO_PUBLIC_API_URL` 仅开发测试用，会覆盖该选择
3. `npx expo start`（需 `__UNSAFE_EXPO_HOME_DIRECTORY`、`npm_config_cache` 两个重定向，见下）

### 9.4 沙箱下 Expo/npm 重定向（本会话已踩）

```bash
export __UNSAFE_EXPO_HOME_DIRECTORY="/home/deploy/workspace/wikipali-mobile/.expo-home"
export npm_config_cache="/home/deploy/workspace/wikipali-mobile/.npm-cache"
export EXPO_NO_TELEMETRY=1
```

### 9.5 已核实 / 待办

- ✅ `tsc --noEmit` 通过；`npx expo export --platform android` 打包成功（2505 modules）
- ⏭️ P1：阅读器增强（术语 drawer / 版本切换 / 长按选文本菜单）、书架三态、全局搜索；mint 阅读正文的真实 `chapter-content` 结构化拼装为 HTML（`src/api/catalog.ts` 里已留 best-effort 集成点）

#### 阅读器升级计划（对应 `DESIGN.md` §3）

> 现状核对（§3）：已完成 WebView HTML 渲染、顶栏返回+标题、sidenote CSS（含响应式断点）、单列阅读；**未完成**：顶栏设置（字号/主题/版本切换）、正文内版本切换、术语 drawer、就此段落提问、长按选文本菜单、横屏/桌面双列对照。

**阶段 A —— 基础能力（不新增原生依赖，无需重建 APK）**

- **A1 顶栏设置面板**：`ReaderScreen.tsx` 顶栏 settings 按钮（现 `onPress={() => undefined}`）接 `@gorhom/bottom-sheet` 设置面板。
  - 字号：`buildReaderHtml` 的 CSS 增加 `:root { --base: 18px }` 并让正文 `font-size` 引用该变量；选项 15/18/21/24，通过重渲染 `html` 或 `injectedJavaScript` 改根字号；持久化到 AsyncStorage（新增 `src/settings/reader.ts`）。
  - 主题：亮/暗切换。暗色在 `buildReaderHtml` 换 CSS 变量，RN 顶栏/面板配色同步（`src/theme/index.ts` 需补 dark palette，当前仅亮色）。
  - 版本切换入口：见 A2。
- **A2 阅读器内版本切换 Tab**：把「版本选择」从 `BookChannelsScreen` 前移进阅读器。`Reader` 路由参数增加可选 `channels?: ChapterChannel[]`、`activeChannelId?: string`（由 `BookChannelsScreen` 一次传入，避免重复请求）；顶栏下方渲染横向版本 Tab（自绘 `ScrollView + Pressable`，或引纯 JS 的 `react-native-tab-view`），切换时按 `channelId` 复用 `getChapterByChannel` 重载。
- **A3 正文内容完善**：`src/api/catalog.ts` 的 `flattenReadHtml` 按 mint `makeContentObj` 真实结构核对，识别 sidenote / 段落号（`data-para`）/ 句（`data-sentence`），产出带 `.sidenote`、`data-*` 标记的 HTML（当前是 best-effort 递归拼接，未专门处理 sidenote）。

**阶段 B —— 交互增强（术语 + 长按选文本）**

- **B1 术语点击 drawer**：WebView 注入事件委托 JS，点击带 `data-term`/`data-word` 的节点 → `window.ReactNativeWebView.postMessage(...)`；RN 层 `onMessage` → 打开 `@gorhom/bottom-sheet`（手机底部 drawer / 平板居中 popover）。新增 `src/api/terms.ts`（`WbwLookup` / `Term` 接口，复用 `resolveBaseUrl` + `request`）与词条组件 `src/components/TermSheet.tsx`。前提：后端正文 HTML 需在术语节点带标识；若无，先做「长按选词查字典」兜底（见 B2）。
- **B2 长按选文本菜单（查字典 / 提问）**：WebView 注入 `selectionchange` 监听 + 长按触发，把选中文本 `postMessage` 给 RN → RN 弹 action sheet / 自绘浮层。动作：「查字典」→ 选中词走 B1 的 `TermSheet`；「提问」→ 携带选中文本 + 当前段落 id 跳 `NewChat`（见 C1）。

**阶段 C —— 段落提问 + 多版本对照**

- **C1 底部悬浮「就此段落提问」**：`ReaderScreen` 底部悬浮按钮（absolute 定位），点击 `navigation.navigate("NewChat", { passageRef: { book, paragraph, title }, seedText })`。`NewChat` 路由参数由 `undefined` 改为可选 `{ passageRef?; seedText? }`；`NewChatScreen` 用 `useCopilotChatContext().submitMessage` 预置「关于《X》第 N 段…」上下文。
- **C2 双列对照（平板横屏/桌面）**：按**阅读区净宽 ≥ 880dp** 开启（`useLayout()`；expanded 平板横屏收起列表栏后即满足，见 `DESIGN.md` §4.7）→ 左右两个 WebView 并排（原文 | 译文）；窄屏保持单列 + A2 的版本 Tab。先做「双列只读对照」，再按需加「滚动同步」。

**依赖 / 构建影响**

- 本计划**不新增原生依赖**：`@gorhom/bottom-sheet`、`react-native-gesture-handler`、`reanimated`、AsyncStorage 均已安装（`GestureHandlerRootView` 已在 `App.tsx` 包好）；版本 Tab 自绘即可（`react-native-tab-view` 为纯 JS）。按 §2.3 判断标准，**预计无需重建 APK**。
- 后端依赖：术语点击（B1）与 sidenote（A3）依赖 mint 正文 HTML 带结构化标记；`WbwLookup` / `Term` 接口后端已存在（见 `DESIGN.md` §7 映射），仅需前端新增 `src/api/terms.ts`。

**验收清单（对齐 `DESIGN.md` §3）**

| §3 设计项 | 完成于 |
|---|---|
| 顶部返回 / 标题 | 已有 |
| 顶部设置（字号/主题/版本） | A1 |
| 正文版本切换 | A2 |
| sidenote 侧边栏 | A3（CSS 已有，补内容拼装） |
| 术语点击 drawer | B1 |
| 长按选文本菜单（查字典/提问） | B2 |
| 底部「就此段落提问」 | C1 |
| 横屏/桌面双列对照 | C2 |

#### 已落地（2026-08-25 会话）

- **目录/章节导航**：新增 `src/catalog/headings.ts`（加载 `src/data/tipitaka_heading.json`，建章节树 + `resolveDisplayNode` 按体量下沉 + `nextHeading/prevHeading`）。阈值 `CHAPTER_STR_LEN_THRESHOLD = 20_000`（字符），先按常规阅读器设定，后续可调。
- **阅读器导航条**：`ReaderScreen.tsx` 新增「目录 / 上一章 / 下一章 / 版本切换」四条；目录按钮打开右侧抽屉 `src/components/ChapterDrawer.tsx`（默认只显示第一层，展开当前章节父层级，高亮当前章节）。
- **A1 顶栏设置**：`ReaderScreen.tsx` 设置按钮 → 底部弹层（字号 15/18/21/24 + 亮/深主题），偏好持久化到 `src/settings/reader.ts`；深色作用于 WebView CSS + 阅读器镶边（`src/theme/reader.ts`）。
- **C1 就此段落提问**：阅读器底部悬浮按钮 → `NewChat` 传 `passageRef`/`seedText`，`NewChatScreen.tsx` 用 `submitMessage` 自动提交一次追问。
- **版本切换**：导航条「版本」打开 `getBookChannels(book, 当前段落)` 列表，选后 `getChapterByChannel` 重载。
- ⚠️ 注意：`tipitaka_heading.json` 5.47MB 以静态 import 打进 bundle（首启解析 + 包体积增大）；若后续觉得慢，可改为 `expo-asset`/`expo-file-system` 惰性加载。
- 标题上下文（面包屑）：阅读器顶栏现显示「当前显示单元标题」为主标题，副标题为「书名 › 中间父标题 · 版本 · 段落 起–止」。例：输入 93-3 下沉到 93-5 时 → 主标题 `Paribbājakakathā`，副标题 `Sīlakkhandhavagga › 1. Brahmajālasuttaṃ · 版本 · 段落 5–11`（即用户所说的「3-11」= 标题 3、4 作上下文 + 正文 5–11）。
- 尚未做：A3 sidenote 结构拼装、B1 术语 drawer、B2 长按选文本、C2 双列对照（仍为待办）。

---

## 10. 响应式布局 + 义注复注对读（2026-09-05 会话）

### 10.1 环境（重要，踩过坑）

- **Metro 必须能监听文件**。此前用 `CI=1` 规避 inotify 上限，代价是 Metro
  **完全不监听文件变化**，一直发启动那一刻的旧包 —— 表现为「改了代码 reload 没反应」。
  正确做法是抬高上限；本机是 LXC 容器，须在**宿主机**执行：
  `sudo sysctl -w fs.inotify.max_user_watches=524288 fs.inotify.max_user_instances=1024`，
  并写入 `/etc/sysctl.d/60-inotify.conf` 持久化（系统自带的
  `30-lxc-inotify.conf` 设的是 65536，靠文件名顺序被 60- 覆盖）。
  已验证：不重启 Metro，改文件后重新取包即可见新代码。
- **Waydroid 调试**：多窗口模式下 dp = 像素 × 160 ÷ density。
  `sudo waydroid shell wm density 160` 后 1dp = 1px，拖窗口即可跨断点。
  安装/启动/多窗口/指定显示器的完整命令见 `docs/development.md` §6。

### 10.2 响应式布局（对应 `DESIGN.md` §4，已重写为断点唯一真源）

静态界面图：<https://claude.ai/code/artifact/4a3189e4-d0e4-4b76-a714-b43e08169d5a>

已落地：

- `src/theme/breakpoints.ts` —— 断点与各档数值唯一来源
  （compact <600 / medium 600–839 / expanded 840–1199 / large ≥1200，对齐 sw600dp）
- `src/hooks/useLayout.ts` —— 唯一入口 hook；分档用 `width / fontScale`
- `Screen.tsx` —— 统一限宽居中（720/800/840）+ 分档外边距，`fullBleed` 可关闭
- `RootNavigator` —— medium/expanded 左侧 rail(80)，large 侧边栏(280)；
  **下钻页面已移入各 Tab 内部 Stack**，否则最外层 Stack 会盖住导航容器
- 阅读器 —— expanded/large 常驻左侧章节栏（进入时收起，选中后自动收起，
  手动展开则固定）；阅读区净宽改为 `onLayout` 实测；
  **WebView 不再自写 `@media`**，限宽与边注形态由 RN 注入
- 「我 → 布局调试」（仅 `__DEV__`）实时显示断点判定

未做：

- **双列并排对照本身**（条件 `canDualColumn()` 已就位，缺同时取第二 channel
  的正文、版本配对 UI、可选滚动同步）
- 探索页历史侧栏（`DESIGN.chat.md` §4）
- 宽屏术语 popover（依赖尚未实现的术语 drawer）
- expanded 的 list-detail 是否该加高度条件（手机横屏 852pt 会落进 expanded）

### 10.3 义注复注对读

**数据**：`assets/db/tipitaka.db3`（43.9 MB），由 mint/api-v13 的
`php artisan export:mobile.heading --copy-to=…` 生成（mint 提交在 `development` 分支）。
单表 `pali_text` 523284 行：`book, paragraph, level, toc, length,
chapter_len, chapter_strlen, parent, tags, cs_para, book_name`。

- `length` 即原表拼写错误的 `lenght`，导出时已纠正
- `cs_para` / `book_name` 由 `related_paragraphs` 合并而来（每段落至多对应一部
  注释书，已核对无例外）；`cs_para` 取该段落关联区间的 **min**，即起始位置；
  **区间终点未导出**，若之后需要「对应范围」得补 `cs_para_end`
- 无对应注释书时两列为 NULL（523284 行中 408573 行有值）

**算法**：`docs/commentary-layers.md` + `src/catalog/commentary.ts`
（`resolveLayer` / `findRelatedChapters`），校验脚本
`node scripts/check-commentary.mjs [book] [paragraph]`。

- 层次序列：`mūla`/`pāḷi`（两者同层，无区别）→ `aṭṭhakathā` → `ṭīkā`
  → `mūlaṭīkā` → `anuṭīkā`
- 标签只打在书（level 1/2）上，故层次须沿 `parent` 向上找
- `(book_name, cs_para)` 相同即互为对应段落
- 实测 `abhi7/cs_para=1` 可正确列出 4 部原文 + 义注 + 根本复注 + 再复注

### 10.4 下一步（明天从这里继续）

1. **把 SQLite 接进 App**：`expo-sqlite` 打开 `assets/db/tipitaka.db3`。
   需要定：43.9MB 资产的打包方式、首次启动是否要拷贝到可写目录、
   `expo-sqlite` 是原生模块 —— **加依赖后必须重建开发版 APK**。
2. 切换 `src/catalog/headings.ts` 由 JSON 改读 SQLite，然后删除
   `src/data/tipitaka_heading.json`（5.47MB，目前仍在仓库里）。
3. 用户会说明「章节数据如何加载」，据此接入对读的正文获取。
4. 之后才是双列对照 UI（§10.2 未做项第一条）。


## 11. 阅读数据链路重做 + 离线下载（2026-09-06 会话）

**设计文档：`docs/reading-content.md`**（接口契约、算法、表结构、实测数据都在里面，
下次续接先看它，本节只记要点与待办）。

本次提交：`430a069`（链路重做）→ `4873edd`（进度分母修复）→
`207e2da`（下载 UI）→ `c4e7d91`（字符分批）→ `8d093a2`（文档）。

### 11.1 新链路

```
用户点书名
  └─ 本地 SQLite(pali_text) 算阅读单元区间 [from,to]   src/reading/unit.ts
      └─ 查缓存 para_html，列出缺口段落                src/reading/cache.ts
          └─ 缺口按字符数分批                          src/reading/batch.ts
              └─ api/v3/tipitaka-read-para             src/api/read-para.ts
                  └─ 事务写回缓存，拼 HTML 进 WebView
```

**已删除的旧路径**（别再找了）：`chapter-content/{book}-{para}?mode=read`、
`search/tipitaka_chapter_*`、`flattenReadHtml`、`getChapterContent`、
`getChapterByChannel` 及其 mock；`headings.ts` 里的 `resolveDisplayNode` /
`nextHeading` / `prevHeading` / `chapterEndParagraph` /
`CHAPTER_STR_LEN_THRESHOLD`（那是另一套阅读单元切分，已被 `unit.ts` 取代）。

### 11.2 阅读单元算法（细节见 `docs/reading-content.md` §3）

阈值 5000 字符上限 / 1500 下限。**起点固定不动，只有下沉指针在动** ——
父标题与首个子标题之间的正文才不会漏。三个必须记住的坑：

- **扩展必须调用「不再扩展」的核心切分**。用完整递归会连锁失控，
  书 42 一路吞到 66444 字符。算法因此拆成 `coreUnit` + `readingUnit` 两层。
- **硬切要吞掉不足下限的尾巴**，否则每个硬切章节末尾都留一个几十字符的单元。
- 三种边界都靠字符硬切兜底：分卷标记导致的过小区间（书 33，26 字符）、
  无子章节的整本书（书 59，28 万字符）、超阈值的前置正文（书 190，3 万字符）。

全库 217 本从头翻到尾：24607 个单元，全部终止、无空洞、无重叠、覆盖到书末。
`node scripts/check-reading-unit.mjs` 可复跑（Node 24 直接 import TS 源码，
App 与脚本共用同一份实现）。

### 11.3 存储

| 文件 | 用途 | 读写 |
|---|---|---|
| `assets/db/tipitaka.db3` | `pali_text` 章节树 | 只读，随版本整体替换 |
| `reading.db3` | `para_html` + `download_state` | 读写，首次启动建表 |

**分开是刻意的**：只读库随 App 更新覆盖，用户数据不受影响，不必写迁移。

- `para_html` **按段落存**，不按区间存 —— 区间边界会随阈值和入口浮动，
  段落是唯一稳定的复用单位。
- `html = ''` 表示「服务端确认该段为空」，与「没请求过」区分。服务端会跳过空段落，
  不记下来的话含空段的章节永远命中不了缓存。
- 离线时 mock 占位数据带 `mock: true` **不写盘**，否则会冒充真经留在库里。

### 11.4 分批：按巴利文字符数，不按段数

30000 字符 / 300 段，谁先到算谁。两个约束缺一不可：字符数管段落大的书
（书 24 旧方案最坏一批 321K 字符、HTML 近 1MB，必超 12 秒超时），
段数管偈颂类的书（光按字符会攒出 1700 段一批，而服务端逐段查库，段数才是成本）。
`node scripts/check-batch.mjs` 可复跑。

### 11.5 下载入口（三处）

- **版本列表每行**（`BookChannelsScreen`）—— 语义最正，选哪个版本下哪个。
  注意该行原有的进度环是**译文完成度**，不是下载进度。
- **阅读器顶栏** —— 一键开始/暂停 + 百分比。
- **阅读器设置弹层 / 书架「已下载」** —— 完整状态与删除。

断点续传与进度不需要状态机，由数据本身推出：分母 = `pali_text` 该书全部行
（**含章节标题行**，标题行也有正文），分子 = `para_html` 已缓存段数。

### 11.6 环境

- 新增原生依赖 **`expo-sqlite` + `expo-asset`**，已重建 dev APK：
  `https://expo.dev/artifacts/eas/GIbw5dtdRjwPrOoHGZNneAcu_vgnZioD6KcATkOw-4A.apk`
  （build `64b25362`，提交 `430a069`）。之后只改 JS 的话不必重建。
- `metro.config.js` 把 `db3` 加进 `assetExts` —— 默认只有 `db`，
  不加则 `require('…/tipitaka.db3')` 解析不到。
- 本容器与宿主机共享网络，waydroid 连 Metro 用 **`http://192.168.240.1:8081`**
  （waydroid0 网桥；备用 `192.168.43.14`）。启动 Metro 要带 `--lan`。

### 11.7 真机验证情况

已验证：首次进阅读器（46MB 库拷贝）、翻页、换版本、缓存命中秒开、
整本下载、进度条、暂停/继续、删除。

### 11.8 下一步（下次从这里继续）

1. **`headings.ts` 由 JSON 改读 SQLite**，删除 `src/data/tipitaka_heading.json`
   （5.47MB，仍在仓库里）。目录抽屉现在是**同步 API**，改 SQLite 要连带改成异步，
   这是主要工作量。对应 `docs/reading-content.md` §6 第 11 步。
2. 缓存配额清理（`enforceCacheQuota` 已写好，200MB LRU，**但还没有任何地方调用它**，
   也没有设置页入口展示占用）。
3. 双列并排对照（§10.2 未做项第一条），现在正文获取已经就绪。
4. 阅读进度改用 wikipali API 同步（`src/data/history.ts` 目前是 AsyncStorage 本地存储）。

---

## 12. 本地 release 构建 + 真机联调（2026-09-07 会话）

### 12.1 本地出 release 包（不再走 EAS）

容器里 JDK 17 + Android SDK 已齐，直接：

```bash
cd android && ./gradlew assembleRelease
# 产物：android/app/build/outputs/apk/release/app-release.apk（157MB，全 ABI）
```

首次全量约 16 分钟，改 JS 后增量约 30 秒~8 分钟。

⚠️ release 目前用的仍是模板默认的 **debug keystore**（`android/app/debug.keystore`），
只能自测/内测，上架前必须换成自己的 keystore 并改 `signingConfigs.release`。

⚠️ 157MB 是因为打包了所有 ABI。需要瘦身可加
`-PreactNativeArchitectures=arm64-v8a` 或开 splits（约 60~70MB）。

### 12.2 `android/` 是生成目录，改 app.json 后必须重跑 prebuild

`android/` 在 `.gitignore` 里，图标、`app_name`、`versionName` 全部由
`npx expo prebuild -p android` 从 `app.json` 生成。上个会话只换了 `assets/`
里的图标就直接打包，结果装出来仍是默认名 `mobile` + Expo 默认图标。

**改了 `app.json`（名称/版本/图标/插件）→ 先 `npx expo prebuild -p android` 再 assembleRelease。**

当前：`name: Wikipali`、`version: 0.1.0`、`versionCode 1`。

### 12.3 真机调试：容器没有 USB 透传，走宿主机 adb server

本容器 `/dev/bus/usb` 不存在，`lsusb` 无输出 —— 插线也看不到设备。
无线调试同样不通（手机热点开了客户端隔离，ARP 都不通）。可行路径：

```bash
# 宿主机（连着数据线的那台）
adb kill-server
adb -a -P 5037 nodaemon server

# 容器内
export ADB_SERVER_SOCKET=tcp:127.0.0.1:5037
adb devices -l          # 能看到设备
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb logcat -v brief
```

小米/红米还需在开发者选项里额外打开 **「USB 调试（安全设置）」**，
否则 `adb shell input tap/swipe` 报
`SecurityException: Injecting input events requires ... INJECT_EVENTS`。

坐标换算：`adb shell wm size` 拿 override 尺寸（本机 1080x2400）；
`adb shell uiautomator dump` 拿到的 bounds 就是这套坐标，直接喂给 `input tap`。
注意底部 Tab 栏要点 y≈2300（更低会被手势导航条吃掉）。

### 12.4 本次修掉的三个 release 专属 bug

| 现象 | 根因 | 修复 |
|---|---|---|
| 阅读页 `no such table: pali_text` | 首次把 46MB 库从 APK 拷到 `SQLite/` 时拷贝失败留下空文件，`ensureTipitakaFile()` 只判断「文件存在」就返回，SQLite 把空文件当合法空库打开 | 拷完比对源/目标字节数；打开后查 `sqlite_master`，缺表就删掉重拷一次（`bc48172`） |
| 翻章报 `cannot rollback - no transaction is active` | `withTransactionAsync` 是裸的 `BEGIN`/`COMMIT`，共用一个连接；三层同时预取时第二个 `BEGIN` 嵌套失败 | `withReadingTransaction()` 用 promise 链把写事务串行化（`e49b7d5`） |
| 点「探索」进到永远失败的对话页 | CopilotKit Runtime 未上线，包里内联的是开发机局域网地址 | `src/ai/availability.ts` 探测 `{RUNTIME_URL}/info`，不可达时三个入口弹窗拦截（`26817aa`） |

### 12.5 第四个 bug：请求超时没覆盖 body

`src/api/client.ts` 的 12 秒 `AbortController` 只包住 `fetch()`，
`clearTimeout` 在 `finally` 里就执行了 —— 服务端发完响应头后卡住时，
`await res.text()` 永久挂起。整本下载卡在某一批后，循环再也回不到
`flag.cancelled` 检查点，`running` 标记不释放，之后点「继续」全是空操作，
必须杀进程才能恢复。已把 `res.ok` 判断和 `res.text()` 移进 try（`e00ee75`）。

### 12.6 全功能真机测试结果（2026-09-07）

测试机：Redmi 2304FPN6DC（Android 16，1080x2400），release 包，经宿主 adb server 驱动。

**通过**：冷启动、五个 Tab、三藏树四级导航、书架三个分页与空态、
版本列表（43 个版本）、阅读正文渲染、上一章/下一章、目录抽屉跳转、
版本切换（Claude ↔ deepseek）、层切换（原文/义注/复注）、字号四档、
深色/亮色主题、整本下载 1507/1507 完成、暂停/继续、飞行模式下离线阅读与翻章、
语言切换（简中 ↔ English）、API 服务器列表、关于页、登录页错误处理、
AI 三个入口的不可用拦截。

**未实现（占位，非 bug）**：分类页搜索框、工具页三项（字典/佛教日历/编码转换）、
设置页「显示设置」「下载管理」。

**注入点击的盲区（已由人工补测通过）**：阅读页「就此段落提问」FAB 对
`adb shell input tap` 始终无响应，怀疑被 WebView 吞掉；人工点击确认会正常弹出
「AI 功能暂未开放」。同理，段号与有序列表序号不再重叠也由人工确认。
以后测阅读页正文区域内的控件，别只信注入点击的结果。

**收尾修复（同日）**：段号绝对定位（不再压住有序列表序号）、长标题可断行、
登录错误统一文案、关于页名称取自 app.json、AI 弹窗去重、正文字号档位
15/18/21/24 → 11/13/16/19（「标准」对齐按钮字号）。注意系统字体缩放会同时
放大 WebView 与 RN 文字（测试机 1.45×），排查「字太大」时先看这个。

**更正**：曾记为「离线时只剩原文一层」的现象与网络无关 —— 直接打开义注书
（sumaṅgalavilāsinī）时对读链条从它自身起算，本来就没有上层；联网复测同样只有一层。
是否允许从义注直接向下挂复注，属于设计决定。

**记录待定的问题**：见本次会话报告 —— 段号与有序列表序号重叠、长标题横向裁切、
登录失败提示直接显示服务端原文 `invalid token`、关于页仍写「法音」而应用名已是
Wikipali、离线时只剩「原文」一层、连点 AI 入口会叠多个弹窗。

### 12.7 已知未决

- `.env` 的 `EXPO_PUBLIC_RUNTIME_URL` 仍是开发机地址，Runtime 上线后要改成正式地址再出包。
- release 用 debug keystore 签名（见 §12.1）。

---

## 13. 书架/对读/进度四处修复（2026-09-07 续）

| 现象 | 根因 | 修复 |
|---|---|---|
| 书架标题是丛书名 | 一个 `book` 文件可能装多部作品（281 条 level=1 对 217 个 book），原来取文件里第一条 | `bookEntryAt(book, paragraph)` 按段落取 level=1 的 `toc`；副标题开头加层次 tag（`9ff0e9f`） |
| 从义注/复注条目进入，标签停在「原文」 | `ReaderScreen` 写死第 0 页是根本 | `getChapterLayers()` 先判入口自己的层，`selfIndexRef` 取代写死的 0（`a9db851`） |
| 从义注/复注版本进入只显示一个「原文」 | 同上；义注开头在根本里本就没有对应章节 | 标签栏按实际存在的层生成，没有根本就不显示「原文」（`a9db851`） |
| 版本列表进入总是从头开始 | 只用目录锚点，不看阅读记录 | 进列表时用 `useFocusEffect` 重读阅读记录（用 `useEffect` 会慢一拍）（`749f3bb`） |

真机验证：书架标题/tag、书架与分类两条义注入口、根本入口三层、翻章后退出
重进恢复到 225–246，全部通过。

功能测试清单见 **`docs/testing.md`**（12 组、约 70 项，含注入点击的已知盲区）。
