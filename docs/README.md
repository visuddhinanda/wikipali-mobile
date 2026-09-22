# 法音 · Wikisali 移动端 App 设计文档（总入口）

> 版本：v1.2（2026-09，重组为「总入口 + 子项目文档」结构）
> 定位：巴利三藏阅读 + AI 问答 + 词典/工具的一体化移动端
> 视觉基调：传统庄重 · 古籍感 · 暖色调 / 米黄纸感
>
> **本文档只保留通用内容**：五大栏目简介、响应式策略、技术路线、接口映射。
> 各子项目（三藏分类 / 阅读器 / 探索问答 / 多用户同步 / 日历 / 文字转换等）的设计文档
> **单独成文**，在下方索引里放链接。**新增子项目设计时，请单独建 `docs/<topic>.md` 并在此登记链接，
> 不要往本文档里堆子项目细节**（规则见仓库根 `CLAUDE.md`）。

---

## 子项目设计文档索引

| 文档 | 说明 |
|---|---|
| [`catalog.md`](./catalog.md) | 三藏分类树（经/律/论/藏外）细化 |
| [`reader.md`](./reader.md) | 阅读器形态总览（正文/版本/章节列表/响应式） |
| [`reading-content.md`](./reading-content.md) | 正文获取、阅读单元切分、离线缓存与下载 |
| [`reading-annotations.md`](./reading-annotations.md) | 阅读页段落注释：义注/复注内容内嵌 |
| [`commentary-layers.md`](./commentary-layers.md) | 注释层次与对应章节查询 |
| [`chat.md`](./chat.md) | 探索（AI 问答）栏目设计（App / Web 一致） |
| [`multi-user-sync.md`](./multi-user-sync.md) | **多用户支持与数据同步**（登录/游客隔离 + 阅读/下载/收藏/书签同步，含 API 缺口清单） |
| [`user-data-db.md`](./user-data-db.md) | **用户数据数据库设计**（SQLite 表结构 / 字段语义 / 同步字段 / 迁移） |
| [`pali-script.md`](./pali-script.md) | 巴利文字体（script）转换 |
| [`buddhist-calendar.md`](./buddhist-calendar.md) | 佛教日历（五套历法 + 天文计算 + 飞行计算） |
| [`development.md`](./development.md) | 开发指南（环境 / 构建 / 联调） |
| [`testing.md`](./testing.md) | 功能测试清单（真机） |
| [`troubleshooting.md`](./troubleshooting.md) | 已知问题与排查 |

---

## 1. 五大栏目简介（5 Tab 底部导航）

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│  分类     │  书架     │  探索     │  工具     │  我      │
│ (发现)    │          │  (凸起)  │          │          │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

### 1.1 分类（首页 / 发现）

- **顶部常驻**：全局搜索入口（跳转 OpenSearch 搜索页）
- **顶部主入口**：巴利三藏（经藏 / 律藏 / 论藏 · Sutta / Vinaya / Abhidhamma），点击按传统分类进入下一级目录（细化见 [`catalog.md`](./catalog.md)）
- **中部**：推荐 / 最近更新内容卡片
- **底部**：作者（语文）筛选 —— Pali / 中文 / 缅文 / 泰文 / 僧伽罗

### 1.2 书架

- Tab 内二级切换：**在读**（含阅读进度条）｜**已下载**（离线内容管理）｜**收藏**｜**书签**
- 每本书卡片：封面 / 书名（多语言）、进度百分比、最后阅读章节、继续阅读按钮
- 长按 / 滑动：删除下载、移出书架

### 1.3 探索（原 AI Chat，视觉突出，中间凸起图标）

> 详细设计见 [`chat.md`](./chat.md)，App / Web 一致。

### 1.4 工具（可扩展列表/宫格）

1. **字典**：搜索框 + 最近查词历史；词条页复用 Term tooltip/drawer 逻辑
2. **佛教日历**：月历视图，标注布萨日、结夏安居等；阴历/公历切换（详见 [`buddhist-calendar.md`](./buddhist-calendar.md)）
3. **编码转换**：罗马转写 / 悉昙 / 缅甸文 / 泰文等转换器，实时转换预览（详见 [`pali-script.md`](./pali-script.md)）

### 1.5 我

- 未登录：大按钮「登录 / 注册」
- 已登录：头像 + 用户名 + 简介；阅读统计（本周时长、连续天数，可选）；我的提问历史（→ 探索 · 个人记录）；设置（语言偏好 / 字号·主题 / 下载管理 / 关于·反馈）
- **多用户**：登录 / 登出时的本地数据隔离与同步见 [`multi-user-sync.md`](./multi-user-sync.md)。

---

## 4. 响应式布局策略（总览）

> 本节是全 App 响应式的**唯一真源**。`chat.md` §4、[`reader.md`](./reader.md) 的响应式表格都从这里派生，改断点只改这里。
>
> 📐 **静态界面图（四档等比 mockup + 数值汇总）**：<https://claude.ai/code/artifact/4a3189e4-d0e4-4b76-a714-b43e08169d5a>

### 4.1 基本原则

1. **按窗口宽度分档，不按设备类型判断。** 不用 `Platform.isPad`、不用横竖屏、不用屏幕物理尺寸。理由：分屏（split-screen）、折叠屏、Waydroid/桌面自由窗口、Web 浏览器缩放，都会让「设备」和「可用宽度」脱钩。判定一律基于 `useWindowDimensions().width`（dp）。
2. **阅读体验的核心是行长（measure），不是充满屏幕。** 宽屏下正文**居中限宽**，多出来的宽度用于边注、目录、对照栏，而不是把一行拉到 1200dp。这是阅读类 App 与工具类 App 最大的分野。
3. **渐进增强，单列永远是可用基线。** 每个宽档只在窄档基础上「增加一栏 / 展开一个原本折叠的容器」，不重写页面。任一断点下功能集合相同，只是可见性和位置不同。
4. **窄→宽的容器升级路径固定**：`bottom-sheet 抽屉 → 侧栏 → 常驻双栏`。同一份内容，不写两套组件。

### 4.2 宽度断档

对齐 Material 3 window size class（也就是 Android 的 `sw600dp` / `sw840dp` 资源限定符），避免自造断点在真机上落错档：

| 档位 | 宽度（dp） | 典型场景 |
|---|---|---|
| **compact** | `< 600` | 手机竖屏；手机横屏分屏；小窗 |
| **medium** | `600 – 839` | 小平板竖屏（7–8"）；大平板分屏一半；手机横屏（大屏机） |
| **expanded** | `840 – 1199` | 10" 平板竖屏、**平板横屏（主力宽屏场景）** |
| **large** | `≥ 1200` | 桌面浏览器、大平板横屏、外接显示器 |

> ⚠️ 不要沿用 Web 常见的 768 / 1024。7" 平板竖屏约 600dp，会被 768 误判成手机；而 Android 判定平板的官方线就是 `sw600dp`。

**无障碍修正**：用户放大系统字号时，可容纳的列数应随之减少。分档用**有效宽度** `width / max(1, fontScale)` 计算（`fontScale` 取自 `useWindowDimensions()`），而不是原始 dp。

**高度**：仅一个规则——窗口高度 `< 480dp`（手机横屏、桌面矮窗）时，折叠首页 Hero、隐藏底部 Tab 文字标签，只留图标。

### 4.3 导航容器

| 档位 | 导航形式 | 说明 |
|---|---|---|
| compact | 底部 Tab bar（5 图标 + 文字） | 现状 |
| medium | **左侧 navigation rail**（宽 80，图标 + 短标签，垂直居中） | 底部 Tab 撤掉，纵向空间还给内容 |
| expanded | **同 medium 的 rail**（宽 80） | 见下方说明 |
| large | **常驻左侧边栏**（宽 280，图标 + 文字，可含二级项如「最近阅读」） | 桌面级宽度，导航可以常驻展开 |

**expanded 沿用 rail 而不是展开侧边栏**，这是一个刻意的取舍：本 App 的主力设备是手机和平板，expanded（840–1199）几乎全部是**平板横屏**，我们希望这批用户拿到包括双列对照在内的完整功能。1024dp 减去 280 的侧边栏再减去 320 的列表栏，正文只剩 424，双列对照无从谈起；换成 80 的 rail 并允许列表栏收起（§4.6），正文可得 944，双列每栏 ~470，行长成立。导航的展开态在这个宽度上不值这 200dp。

「探索」的凸起中央图标只在 compact 的底部 Tab 存在；rail / 侧边栏里它退化为普通高亮项（保留强调色）。

### 4.4 页面骨架与限宽

所有页面走同一个容器（`src/components/Screen.tsx`），由容器统一负责限宽与居中，页面自身不关心断点：

| 档位 | 内容区最大宽度 | 左右外边距 |
|---|---|---|
| compact | 不限宽（充满） | 16 |
| medium | 720 | 24，超出居中 |
| expanded | 800 | 32，超出居中 |
| large | 840 | 40，超出居中 |

限宽仅作用于**单列内容**。进入双栏布局的页面（阅读器对照、探索问答）由该页自己分配宽度，每一栏内部再各自套用上表。

### 4.5 列表与网格

卡片型列表（书架、分类宫格、工具、探索信息流）按档位换列数；纯文本行列表（章节列表、版本列表）**永远单列**，只跟随 §4.4 限宽——多列文本行会破坏扫读节奏。

| 档位 | 卡片列数 |
|---|---|
| compact | 1 |
| medium | 2 |
| expanded | 3 |
| large | 4 |

实现用 `FlatList` 的 `numColumns`（切换列数时需换 `key` 强制重建），或 `flexWrap` + 卡片 `flexBasis` 百分比。

### 4.6 列表-详情（list-detail）双栏

阅读链路 `分类 → 章节列表 → 版本列表 → 阅读器` 在 compact 是四层 push；**expanded 及以上改为左右两栏**（阅读类 App 的标准平板形态）：

- 左栏固定 320–360：当前层级的列表（分类树 / 章节列表 / 版本列表，内部仍可 push）。
- 右栏：阅读器，占剩余宽度，内部再按 §4.4 限宽居中。
- 右栏空态：未选章节时显示「从左侧选择一章开始阅读」+ 最近阅读入口。
- **选中一章后左栏自动收起**（expanded 必须，large 可选）：选中即隐藏列表栏，把全部宽度让给阅读区——这是 expanded 能开双列对照的前提。收起后在阅读器顶栏保留「目录」按钮（以及左边缘滑出手势）随时唤回；再次选章仍自动收起。用户手动展开过一次后，本次会话内不再自动收起，尊重用户的选择。
- 收起/展开走 250ms 宽度动画，不整页重排；阅读区滚动位置不变。
- **选中态**：左栏当前项高亮；从宽档缩回 compact 时，把当前选中项还原成 push 栈顶（用户不应丢失所在位置）。
- 深链接（AI 引用跳转、书架续读）在两种形态下都要能直接落到阅读器，且直接以左栏收起态进入。

medium 档不做双栏——600–839dp 拆两栏后正文只剩不到 500dp，行长不足。

### 4.7 阅读器

| 档位 | 正文 | 边注（sidenote） | 多版本对照 |
|---|---|---|---|
| compact | 单列，限宽不生效 | 行内折叠（点击展开） | 版本切换 Tab |
| medium | 单列居中，measure ≤ 720 | 行内折叠 | 版本切换 Tab |
| expanded | 列表栏收起后单列居中 + 右侧边注栏 | 真 Tufte 边注，栏宽 ~200 | **支持双列并排对照**（原文 \| 译文） |
| large | 左列表 + 右阅读区（§4.6） | 右侧边注栏 | **双列并排对照**，可选滚动同步 |

**双列对照的开启条件按可用正文宽度判断，不按档位硬编码**：阅读区净宽 ≥ 1000 时允许双列（每栏 ≥ 500，够一行 24–30 个汉字）；净宽 840–1000 之间是「单列居中 + 右侧边注栏」（平板竖屏）。expanded 收起列表栏后，较宽机型（如 1200 − 80 rail = 1120）才够双列；列表栏展开时自动退回单列 + 版本 Tab，展开/收起即在两种形态间平滑切换。这样「平板横屏拿到全功能」不依赖具体机型宽度。

**关键约束**：阅读器正文由 WebView 渲染 HTML，RN 的断点管不到 WebView 内部。两侧必须共用同一套阈值——RN 层把当前档位和内容区宽度**注入**到 WebView（注入 CSS 变量或 `data-width-class` 属性），WebView 的 CSS 只用这些变量做媒体切换，不再自己写 `@media (max-width: …)`。否则会出现「RN 认为是平板、WebView 认为是手机」的错档。

术语弹层：compact / medium 用底部 bottom-sheet；expanded 以上用锚定在词旁的 popover。

### 4.8 探索（AI 问答）

见 [`chat.md`](./chat.md) §4，断点沿用本节 4.2。归纳：

| 档位 | 首页 | 问答页 |
|---|---|---|
| compact | 单列，输入框底部悬浮常驻 | 全屏对话；历史问题收在抽屉里 |
| medium | 单列居中限宽 | 左窄侧栏（历史 240–260）+ 右对话区 |
| expanded / large | 居中限宽，卡片流两列 / 三列 | 左侧栏（280–320）+ 右对话区居中限宽 |

### 4.9 实现约定

- **唯一入口 hook**：`src/hooks/useLayout.ts`，返回 `{ width, height, widthClass, isCompact, panes, columns, maxContentWidth, gutter }`。页面**只读这个 hook**，不自己比较像素宽度；断点数值集中在 `src/theme/breakpoints.ts`。
- 一律用 `useWindowDimensions()`，禁止 `Dimensions.get('window')` 的一次性取值——自由窗口和分屏下它会返回过期尺寸。
- 布局切换必须**无状态丢失**：滚动位置、当前选中章节、输入框草稿在跨断点时保留（拖动窗口大小会实时触发重排）。
- 断点分支写在容器/导航层（`Screen`、导航器、阅读器外壳），叶子组件保持与断点无关，便于测试。
- **验证矩阵**（每档至少过一遍）：手机竖屏、手机横屏、平板竖屏、平板横屏、桌面窗口拖拽缩放、系统字号放大到最大。Waydroid 多窗口模式可以直接拖动窗口宽度覆盖前五项（见 `docs/development.md` §6）。

---

## 5. 视觉风格

- 传统庄重、古籍感，暖色调 / 米黄纸感（现有 `#f7f3ea` 底色沿用）
- 中文 / 巴利衬线字体优先；经文章节用旧纸色卡片、细线框、克制留白
- 深色主题可选（「我 → 设置」）

---

## 0. 现状基线与技术路线（技术栈盘点）

### 0.1 移动端（本仓库 `wikipali-mobile`）

| 项 | 现状 |
|---|---|
| 框架 | Expo SDK 57（React Native 0.86.2，React 19.2.3，TypeScript 6.0.3） |
| 入口 | `index.ts` → `App.tsx`（`GestureHandlerRootView → SafeAreaProvider → CopilotKitProvider → RootNavigator`，5 Tab + 根 Stack，多屏） |
| AI | `@copilotkit/react-native` 1.69（`CopilotKitProvider` + `CopilotChat`；自绘 `ChatUI`，已 patch 60s 超时 → 10min） |
| 抽屉/弹层 | `@gorhom/bottom-sheet` 5.2.14（术语 drawer、popover 的基础） |
| 手势/动画 | `react-native-gesture-handler` 2.32、`react-native-reanimated` 4.5.1 |
| Markdown 流式 | `react-native-streamdown` 0.2.0（已 patch 修复 worklets 0.10.x 冲突） |
| 文件/下载 | `expo-file-system` 57、`expo-document-picker` 57 |
| 校验 | `zod` 4.4.3 |
| **导航** | React Navigation v7（bottom-tabs + native-stack） |
| **HTML 渲染** | react-native-webview 13.16（阅读器 HTML） |
| **状态管理/数据请求** | 轻量 `src/api` fetch 封装（超时 + JSON + mock 回退），无 react-query/zustand |
| **离线存储** | `expo-file-system` + `expo-sqlite`（阅读缓存 / 下载）+ AsyncStorage（设置类） |
| **登录** | `expo-secure-store` 存 token + `src/auth`（`/auth/current` 校验） |
| **多用户** | 见 [`multi-user-sync.md`](./multi-user-sync.md)（按 user_id 分目录 + 同步） |

### 0.2 后端（工作区相关服务）

| 服务 | 说明 |
|---|---|
| `mint/api-v13`（Laravel） | **成熟的 wikipali Web 后端**：OpenSearch 搜索、逐词词典（WbwLookup/Dict/Term）、三藏目录树、章节/句/段内容、阅读进度、收藏、下载、Chat/ChatMessage、AI 翻译、罗马转写等 |
| `agent-poc/backend`（FastAPI + LangGraph） | 巴利问答 agent：AG-UI 协议 + DeepSeek + MCP 真实语料 |
| `agent-poc/runtime`（CopilotKit, :3001） | 转发到 backend（:8800），agent `pali_agent` |
| `agent-poc/mcp`（:3000） | wikipali MCP server |

### 0.3 关键工程约束（不可随意改动）

以下约束原先散落在 `README.md`，属于架构层决定，迁入本文档统一维护；具体报错与排查步骤见 [`docs/troubleshooting.md`](./troubleshooting.md)。

| 约束 | 说明 |
|---|---|
| **必须 development build** | 依赖含原生代码的模块，Expo Go 预编译运行时不含这些模块；已装 `expo-dev-client` |
| **polyfill 导入顺序强制** | `index.ts`：`react-native-get-random-values`（第 1 行）→ `@copilotkit/react-native/polyfills` |
| **Metro 的 jose 修复** | `metro.config.js` 用官方 `resolveRequest` 把 `jose` 解析到 browser 构建 |
| **patch-package 补丁** | `patches/` 两个补丁随 `postinstall` 应用 |
| **APK 何时重建** | 只动 JS/TS = Metro 热更；动了原生依赖或 `app.json` 原生配置才需 `eas build` |

**服务端口**：Metro 8081（本仓库）· CopilotKit runtime 3001 · backend 8000 · MCP 3000。
真机调试用电脑局域网 IP（模拟器用 `10.0.2.2`），不能用 `localhost`。

---

## 6. 技术栈可行性评估（路线）

### 6.1 逐功能结论（摘要）

| 功能 | 结论 |
|---|---|
| 5 Tab 导航 + 二级栈 | ✅ 已实现（React Navigation v7） |
| 三藏目录树 | ✅ 已实现（本地 `default.json` + 递归列表） |
| 阅读器 HTML + sidenote | ✅ 已实现（WebView） |
| 版本/语文对照 | ✅ 已实现 |
| 术语点击 drawer | ⚠️ 部分（`@gorhom/bottom-sheet` 已装，词条组件待接） |
| 长按选文本菜单 | ⚠️ 待做 |
| 就此段落提问 | ✅ 已实现 |
| AI Chat 问答广场/公开问题 | ⚠️ 依赖后端「公开问题 + citations」接口 |
| 引用经文可点击跳转 | ⚠️ 依赖结构化 citations |
| 书架（在读/下载/收藏/书签） | ✅ 本地已实现；**跨设备同步见 [`multi-user-sync.md`](./multi-user-sync.md)** |
| 字典 / 佛教日历 / 编码转换 | ✅ 日历、转写已实现；字典待做 |
| 登录/多用户 | ✅ 登录已实现；**多用户隔离 + 同步见 [`multi-user-sync.md`](./multi-user-sync.md)** |
| 全局搜索（OpenSearch） | ⚠️ 后端已有，移动端搜索页待做 |
| 响应式（手机/平板/桌面） | ✅ 已实现（§4） |

### 6.2 建议实现路线（分阶段）

- ✅ **P0（基建）**：React Navigation 5 Tab 骨架 + 主题；三藏目录树 → 章节列表 → 版本列表 → 阅读器；「AI Chat」改名「探索」。
- **P1（核心）**：阅读器增强（术语 drawer、长按选文本菜单）；书架三态 + **多用户同步**；全局搜索。
- **P2（AI）**：结构化 citations；自绘 AI Chat（问答广场、公开问题详情、继续追问、引用跳转）。
- **P3（工具与账户）**：字典、登录/统计、设置。

---

## 7. 附：关键接口映射（移动端 ↔ mint api-v13）

| 设计模块 | 现有后端 |
|---|---|
| 三藏目录树 | 本地打包 `src/catalog/default.json`（离线可用；线上 `GET /api/pali-book-category/default` 同构） |
| 版本/频道列表 | `GET /api/v2/progress?view=chapter_channels&book=<book>&par=<paragraph>` |
| **章节正文（阅读，当前使用）** | `GET /api/v3/search/tipitaka_chapter_<book>-<paragraph>_<channel_id>` |
| 章节/段落内容（旧/备用） | `ChapterContentController` / `ParagraphContentController` / `SentenceController` |
| 逐词词典 / 术语 | `WbwLookupController` / `DictController` / `Term*` / `DhammaTermController` |
| 全局搜索 | `SearchController` + `OpenSearchService` |
| 阅读进度 | `ProgressController` / `ProgressChapterController` |
| **阅读记录（同步）** | `RecentController`（`/api/v2/recent`） |
| **收藏 / 书签 / 下载（同步）** | `MeReactionV3Controller`（`/api/v3/me/reactions`，type=favorite/bookmark/download） |
| 下载 / 离线 | `DownloadController` / `OfflineIndexController` |
| 罗马转写 | `RomanizeService`（`TransferController`） |
| AI 翻译 / 问答 | `AiTranslateService` / `OpenAIService` / `EmbeddingService` |
| 聊天 | `ChatController` / `ChatMessageController` |
| 登录 | `AuthController`（`/sign-in`、`/auth/current`）/ `SignUpController` |

> 多用户同步的接口契约、数据映射与**服务端需补齐的 API 缺口**，见 [`multi-user-sync.md`](./multi-user-sync.md)。
