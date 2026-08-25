# 法音 · Wikipali 移动端 App 设计文档

> 版本：v1.1（2026-08-24，已按实际实现更新）
> 定位：巴利三藏阅读 + AI 问答 + 词典/工具的一体化移动端
> 视觉基调：传统庄重 · 古籍感 · 暖色调 / 米黄纸感

> ✅ **已实现（2026-08-24）**：P0 骨架（5 Tab 导航 + 主题 + 三藏目录树 → 章节列表 → 版本列表 → 阅读器）；阅读器接真实章节接口；版本列表按类型分组/折叠 + 环形进度（红→绿渐变）+ 相对更新时间；「AI Chat」改名「探索」并重排首页；聊天页加键盘避让、思考/查资料 loading、引用灰色 tag。细节见 §0.1、§1.3、§3、§6.3、§7。

---

## 0. 现状基线（技术栈盘点）

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
| **导航** | ✅ **React Navigation v7**（bottom-tabs + native-stack + `@react-navigation/elements`） |
| **HTML 渲染** | ✅ **react-native-webview** 13.16（阅读器 HTML） |
| **状态管理/数据请求** | ⚠️ 轻量 `src/api` fetch 封装（超时 + JSON + mock 回退），无 react-query/zustand |
| **离线存储** | ⚠️ `expo-file-system` + `@react-native-async-storage/async-storage`（API 服务器选择），无 SQLite |
| **登录** | ❌ **无** |

### 0.2 后端（工作区相关服务）

| 服务 | 说明 |
|---|---|
| `mint/api-v13`（Laravel） | **成熟的 wikipali Web 后端**：OpenSearch 搜索、逐词词典（WbwLookup/Dict/Term）、三藏目录树（`public/data/category/default.json`）、章节/句/段内容、阅读进度、收藏、下载、Chat/ChatMessage、AI 翻译、罗马转写等 |
| `agent-poc/backend`（FastAPI + LangGraph） | 巴利问答 agent：AG-UI 协议 + DeepSeek（`deepseek-v4-flash`）+ **MCP 真实语料（35 个 wikipali 工具，`USE_MOCK_RETRIEVAL_ONLY=false`）** |
| `agent-poc/runtime`（CopilotKit, :3001） | 转发到 backend（**:8800**），agent `pali_agent` |
| `agent-poc/mcp`（:3000） | wikipali MCP server，API 指向 `https://next.wikipali.org/api`，暴露 wikipali_* 工具 |
| 数据项目 | `D-tipitaka` / `my-tipitaka` / `thai-tipitaka` / `sutta-pitaka-importer` / `pali-translab` 等（各文种/版本三藏内容与转写工具） |

> 注：设计文档中出现的 `RagContextBuilder`（结构化 citations）属目标架构命名。当前 `agent-poc` 的检索已从 mock 平文本升级为 **MCP 真实 wikipali 语料 + DeepSeek**（一次 agent 运行约 70s，含多次工具调用）；`mint` 的 `ChatController` 仍是 **CRUD**（尚无结构化 citations，问答广场/公开问题列表仍需按 §6.2 补齐）。

---

## 1. 整体信息架构（5 Tab 底部导航）

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│  分类     │  书架     │  探索     │  工具     │  我      │
│ (发现)    │          │  (凸起)  │          │          │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

### 1.1 分类（首页 / 发现）
- **顶部常驻**：全局搜索入口（跳转 OpenSearch 搜索页，见 §7.1）
- **顶部主入口**：巴利三藏（经藏 / 律藏 / 论藏 · Sutta / Vinaya / Abhidhamma），点击按传统分类进入下一级目录（细化见 §2）
- **中部**：推荐 / 最近更新内容卡片
- **底部**：作者（语文）筛选 —— Pali / 中文 / 缅文 / 泰文 / 僧伽罗

### 1.2 书架
- Tab 内二级切换：**在读**（含阅读进度条）｜**已下载**（离线内容管理）｜**收藏**
- 每本书卡片：封面 / 书名（多语言）、进度百分比、最后阅读章节、继续阅读按钮
- 长按 / 滑动：删除下载、移出书架

### 1.3 探索（原 AI Chat，视觉突出，中间凸起图标）

> 详细设计已独立提取至 **[`DESIGN.chat.md`](./DESIGN.chat.md)**，App / Web 一致。核心两页：
>
> - **首页（探索）**：顶部标语「与ai助手一起探索三藏奥义」+ **输入框（置顶，点击进入新对话页）** + 信息流卡片（问题摘要 / 语言标签 / 引用经文标记）。
> - **问答页（新对话页）**：流式对话 + 工具调用状态（思考/查资料 loading 图标）+ 经文引用（灰色 tag，点击跳转阅读器）。
> - **响应式**：手机单列（输入框底部常驻）；平板竖屏单列限宽 / 左历史右对话；平板横屏=电脑双栏。

摘要要点（详情见 `DESIGN.chat.md`）：
- **首页信息流**：其他用户公开问题列表（问答广场），每条：问题摘要、被引用经文片段（若有）、提问语言标签；点击进入该问题对话详情（先展示已有回答，底部「继续追问」）。
- 与 RAG 对应：`RagContextBuilder` 返回的 `citations` 作为「引用来源」展示。
- **输入框**：点击进入新对话页；**新对话页**流式回复（SSE），经文引用可点击跳转阅读器对应段落。

**当前已实现**（`AiChatScreen` / `NewChatScreen`）：
- 探索首页：去掉「公开问题」标题，标语 + 置顶输入框 + 信息流卡片（占位数据）。
- 新对话页：`KeyboardAvoidingView` 键盘避让；工具调用气泡与「思考中…」指示用 `ActivityIndicator`；引用链接（`/library/tipitaka/`）渲染为灰色 tag（灰字 `#6b7280` + 淡灰底 `#e5e7eb`）。

### 1.4 工具（可扩展列表/宫格）
1. **字典**：搜索框 + 最近查词历史；词条页复用 Term tooltip/drawer 逻辑
2. **佛教日历**：月历视图，标注布萨日、结夏安居等；阴历/公历切换
3. **编码转换**：罗马转写 / 悉昙 / 缅甸文 / 泰文等转换器，实时转换预览

### 1.5 我
- 未登录：大按钮「登录 / 注册」
- 已登录：头像 + 用户名 + 简介；阅读统计（本周时长、连续天数，可选）；我的提问历史（→ 探索 · 个人记录）；设置（语言偏好 / 字号·主题 / 下载管理 / 关于·反馈）

---

## 2. 三藏分类（细化）

> 目录树对应 `mint/api-v13/public/data/category/default.json`。移动端**仅使用 `default.json`**，不引入 CSCD4 数据集，也不做 Default / CSCD4 版本切换。

### 2.1 经藏 · Sutta Piṭaka
- **长部 · Dīgha Nikāya**：戒蕴品 sīlakkhandhavagga · 大品 mahāvagga · 波梨品 pāthikavagga
- **中部 · Majjhima Nikāya**：根本五十篇 mūlapaṇṇāsa · 中五十篇 majjhimapaṇṇāsa · 后五十篇 uparipaṇṇāsa
- **相应部 · Saṃyutta Nikāya**：有偈品 sagāthāvagga · 因缘品 nidānavagga · 蕴品 khandhavagga · 六处品 saḷāyatanavagga · 大品 mahāvagga
- **增支部 · Aṅguttara Nikāya**：一集 ekakanipāta ～ 十一集 ekādasakanipāta（11 集）
- **小部 · Khuddaka Nikāya**：小诵 khuddakapāṭha · 法句 dhammapada · 自说 udāna · 如是语 itivuttaka · 经集 suttanipāta · 天宫事 vimānavatthu · 饿鬼事 petavatthu · 长老偈 theragāthā · 长老尼偈 therīgāthā · 本生 jātaka · 义释（大/小）niddesa · 无碍解道 paṭisambhidāmagga · 譬喻 apadāna · 佛种姓 buddhavaṃsa · 所行藏 cariyāpiṭaka · 导论 nettippakaraṇa · 弥兰王问经 milindapañha · 藏释 peṭakopadesa

### 2.2 律藏 · Vinaya Piṭaka
- **经分别**：比丘分别 mahāvibhaṅga · 比丘尼分别 bhikkhunīvibhaṅga
- **犍度**：大品 mahāvagga · 小品 cūḷavagga
- **附随**：parivāra
- **注疏 ṭīkā**：一切善见律疏 · 波罗提木叉 · 戒本疏 · 律决定 · 律摄 · 律庄严 · 上决定 · 波逸提等（sāratthadīpanī / pātimokkha / vajirabuddhi / vimativinodanī / vinayavinicchayo / vinayasaṅgaha / vinayālaṅkāra / uttaravinicchaya / pācityādiyojanā / khuddasikkhā / mūlasikkhā）

### 2.3 论藏 · Abhidhamma Piṭaka（七论）
法集论 dhammasaṅgaṇī · 分别论 vibhaṅga · 界论 dhātukathā · 人施设论 puggalapaññatti · 论事 kathāvatthu · 双论 yamaka · 发趣论 paṭṭhāna
- **藏外 añña**：摄阿毗达磨义论 abhidhammatthasaṅgaha · 阿毗达磨入门 · 名色分别 · 胜义决定 · 谛摄 · 阿毗达磨论母 · 断痴论等

### 2.4 藏外 · Añña（非正藏）
清净道论 visuddhimagga（+ 大疏 + 因缘谈）· 结集问答 · 缅甸尊者论集 · 佛陀礼赞集 · 史传集（岛史/教史/大史）· 文法集（迦旃延/目犍连文法等）

### 2.5 分类树在 App 中的交互
- 目录节点带 `tag` 路径（如 `["sutta","dīghanikāya","mahāvagga"]`），用于：命中 OpenSearch 过滤、传给阅读器的章节定位、传给探索（AI 问答）的 `passage id` 上下文
- 三级展开：**藏 → 部/类 → 品/集 → 经/章**；末级进入阅读器
- 「作者筛选」= 平行语文维度（Pali / 中文 / 缅文 / 泰文 / 僧伽罗），与目录树正交，切换后树仍不变、内容按语文过滤

---

## 3. 阅读器页面（核心功能）

- **顶部**：返回、书名/章节名、设置（字号、主题、版本切换）
- **正文**：版本切换按钮、注释侧边栏（Tufte sidenote 风格）、术语点击下方弹出 drawer（平板 popover）
- **底部悬浮**：AI 问答快捷入口「就此段落提问」——把当前段落 `id` 作为上下文传给 Chat
- **内容格式**：HTML（含 sidenote 标注），需 HTML 渲染引擎
- **选择交互**：长按选文本，抬手指后菜单（查字典 / 提问）

**当前已实现（阅读链路 `CategoryBrowse → ChapterList → BookChannels → Reader`）**：
- **章节正文**：经 `GET /api/v3/search/tipitaka_chapter_<book>-<paragraph>_<channel_id>` 获取，响应的 `display` 字段即阅读模式 HTML（`original/translation → para-block → sentence` 结构），`WebView` 注入「古籍纸感 + 段落号（`data-para`）+ 引用标记（`<code>` 上标）+ Tufte sidenote」样式渲染；无频道索引的版本（如 wbw/glossary）显示友好提示而非错误 mock。
- **版本列表（BookChannels）**：按 `channel.type` 分组，顺序 **译文 → Nissaya → 原文 → 逐词 →（其他如 义注 追加）**；每组超过 4 个折叠，可「展开其余 N 个 / 收起」。
- **版本行**：纯 RN 环形进度条（无 svg 依赖）显示 `progress`，颜色按进度 **红→琥珀→绿渐变**，中心只显示数字（无 %）；版本名下方显示 `updated_at` 相对时间（`三天前 / 一个月前 / 一年前`，汉字数字）。
- **章节列表（ChapterList）**：按 **根本 → 义注 → 复注** 排序。

### 响应式关键点
| 设备 | 阅读器 |
|---|---|
| 手机 | 单列，多版本对照 → 版本切换 Tab |
| 平板（竖屏） | 单列 + sidenote |
| 平板（横屏）/桌面 | 双列对照 |

---

## 4. 响应式布局策略（总览）

| 设备 | 导航形式 | 阅读器 | 探索（AI Chat） |
|---|---|---|---|
| 手机 | 底部 Tab bar（5 图标） | 单列，版本切换用 Tab | 全屏对话 |
| 平板（竖屏） | 底部 Tab bar | 单列 + sidenote | 左列表右对话 |
| 平板（横屏）/桌面预览 | 左侧边栏导航 | 双列对照 | 左列表右对话 |

---

## 5. 视觉风格

- 传统庄重、古籍感，暖色调 / 米黄纸感（现有 `#f7f3ea` 底色沿用）
- 中文 / 巴利衬线字体优先；经文章节用旧纸色卡片、细线框、克制留白
- 深色主题可选（「我 → 设置」）

---

## 6. 技术栈可行性评估

### 6.1 逐功能结论

| 功能 | 可行性 | 现有基础 | 需补充 |
|---|---|---|---|
| 5 Tab 导航 + 二级栈 | ✅ 高 | 无 | 引入 **React Navigation**（bottom-tabs + native-stack）或 expo-router；纯 JS，无需重建 APK |
| 三藏目录树 | ✅ 高 | `default.json` + `PaliBookCategoryController` | 移动端解析 JSON 树 + 递归列表组件 |
| 阅读器 HTML + sidenote | ⚠️ 中 | 无 HTML 引擎 | **react-native-webview**（原生依赖，**需重建 APK**）或 `react-native-render-html`；sidenote 用响应式布局/侧栏实现，Tufte 边注在手机上折叠为 drawer |
| 版本/语文对照 | ✅ 高 | 章节/句/段接口 + 平行语文数据 | 前端双列/切换 UI |
| 术语点击 drawer | ✅ 高 | `@gorhom/bottom-sheet` 已装 + WbwLookup/Term 接口 | 抽屉 UI + 词条组件 |
| 长按选文本菜单 | ⚠️ 中 | 无 | RN `Text` 长按 + 选区需自研或 `react-native-selectable-text`；查字典/提问动作接现有接口 |
| 就此段落提问 | ✅ 高 | Chat 可带上下文 | 把段落 `id` 作为消息 context 传入 |
| AI Chat 问答广场/公开问题列表 | ⚠️ 中 | `Chat`/`ChatMessage` 表（mint）已有 | **新增「公开问题 + 结构化 citations」模型与接口**（当前无）；首页信息流为独立列表组件（非 CopilotChat 职责） |
| AI 流式回复（SSE） | ✅ 高 | CopilotKit AG-UI 已 SSE 流式 | 对话层复用现有 `CopilotChat`；引用卡片用 `useRenderTool` 工具渲染（Generative UI）实现，不改 CopilotChat 本体 |
| 引用经文可点击跳转 | ⚠️ 中 | citations 尚无结构化 | 后端返回「出处 ref → passage id」，前端映射到阅读器路由 |
| 书架（在读/下载/收藏） | ✅ 高 | mint `Progress*`/`Collection*`/`Download*` 接口 + `expo-file-system` | 本地元数据用 **AsyncStorage / expo-sqlite**；进度条组件 |
| 字典 | ✅ 高 | `Dict*`/`Term*`/`WbwLookup` 接口 | 搜索 + 历史（本地存储） |
| 佛教日历（布萨日/阴历） | ⚠️ 中 | 无现成 | 需移植阴历/佛历算法（泰/缅历法需数据表）；纯 JS 可做，属独立工作量 |
| 编码转换 | ✅ 高 | `RomanizeService`（后端）+ `pali-translab` 参考 | 前端纯 JS 转换器（罗马转写↔缅甸/泰/僧伽罗/悉昙），可打包复用 |
| 登录/注册/统计 | ✅ 高 | mint `AuthController`/`SignUpController` 等 | 移动端 token 存储 + 请求鉴权 |
| 全局搜索（OpenSearch） | ✅ 高 | `SearchController` + `OpenSearchService`（fuzzy/hybrid） | 移动端搜索页 UI + 结果高亮 |
| 响应式（手机/平板/桌面） | ✅ 高 | RN 平台无关；`app.json` 已 `supportsTablet` | 用 `useWindowDimensions`/`Platform` 分支；桌面预览走 **react-native-web** |

### 6.2 关键结论与风险

1. **可行，但有三个「需新增原生依赖」的动作要一次做完再重建 APK**：
   - `react-native-webview`（阅读器 HTML 渲染，含原生代码）
   - React Navigation 相关（`react-native-screens`、`react-native-safe-area-context` 含原生代码）
   - 其余（zustand、react-query、AsyncStorage/expo-sqlite、render-html）多为 JS 或 Expo 托管模块，影响小。

2. **RAG 结构化 citations 是当前最大缺口**：设计中的 `RagContextBuilder`→`citations` 尚未落地。现状是 `agent-poc` 的 `retrieve_sutta_passage` 返回**平文本**（mock），`mint` 的 `ChatController` 只是 CRUD。落地「问答广场 + 引用经文片段 + 可点击跳转」需：
   - 定义 citation schema（`{ ref, passageId, pali, zh }`）
   - 让检索工具返回结构化 citations（替换 mock，接 `mint` 的 `OpenSearchService`/`EmbeddingService` 做真实 RAG）
   - 引用卡片展示：CopilotKit **无一等 `citations` 字段**，经 **Generative UI / tool-call 渲染**实现——`useRenderTool({ name: "retrieve_sutta_passage", render })` 注册渲染器，`CopilotChat` 按工具名自动内联渲染（已核实本地 1.69 源码与官方文档）
   - 新增公开问题存储/列表接口，AI Chat 历史落库

3. **AI Chat 是「引流层 + 对话层」两层，职责分离（无冲突）**：`CopilotChat` 只负责对话层（流式 chat）。「问答广场信息流、公开问题只读详情 + 继续追问、引用卡片」属首页引流层，用独立的列表/详情组件实现，本来就不由 `CopilotChat` 承担。二者衔接点仅是：从详情页「继续追问」→ 以该问题为上下文进入 `CopilotChat` 对话；聊天回复内的经文引用卡片 → 点击跳转阅读器。

4. **佛教日历**是唯一无现成依赖的纯业务算法，建议独立排期（泰历/缅历需引入历法数据表，或先只做公历 + 农历布萨日推算）。

5. **离线下载**：`expo-file-system` 足以存 HTML/封面；建议加 **expo-sqlite** 建本地索引（书架、进度、词典历史），否则大量本地元数据无结构。

### 6.3 建议实现路线（分阶段）

- ✅ **P0（基建，已基本完成）**：React Navigation 5 Tab 骨架 + 主题（米黄纸感）；三藏目录树 → 章节列表（**根本 → 义注 → 复注** 排序）→ 版本列表（**按类型分组/折叠 + 环形进度红→绿渐变 + 相对更新时间**）→ 阅读器（WebView 渲染真实章节 `display` HTML）。「AI Chat」改名「探索」并重排首页；聊天页加键盘避让、思考/查资料 loading、引用灰色 tag。
- **P1（核心）**：阅读器增强（sidenote 样式已内置，术语 drawer、版本切换、长按选文本菜单、就此段落提问尚未做）；书架三态；全局搜索。
- **P2（AI）**：结构化 citations（当前为 MCP 真实检索 + markdown 引用链接，尚无结构化 citations 卡片）；自绘 AI Chat（问答广场、公开问题详情、继续追问、引用跳转）。
- **P3（工具与账户）**：字典、编码转换、佛教日历、登录/统计、设置。

---

## 7. 附：关键接口映射（移动端 ↔ mint api-v13）

| 设计模块 | 现有后端 |
|---|---|
| 三藏目录树 | 本地打包 `src/catalog/default.json`（离线可用；线上 `GET /api/pali-book-category/default` 同构） |
| 版本/频道列表 | `GET /api/v2/progress?view=chapter_channels&book=<book>&par=<paragraph>`（rows 含 `channel_id` / `type` / `progress` / `updated_at`） |
| **章节正文（阅读，当前使用）** | `GET /api/v3/search/tipitaka_chapter_<book>-<paragraph>_<channel_id>`（`display`=阅读模式 HTML，`content`=纯文本；无该频道索引时返回 `ok:false` + `no such index`） |
| 章节/段落内容（旧/备用） | `ChapterContentController` / `ParagraphContentController` / `SentenceController` |
| 逐词词典 / 术语 | `WbwLookupController` / `DictController` / `Term*` / `DhammaTermController` |
| 全局搜索 | `SearchController` + `OpenSearchService` |
| 阅读进度 | `ProgressController` / `ProgressChapterController` |
| 收藏 | `CollectionController` |
| 下载 / 离线 | `DownloadController` / `OfflineIndexController` |
| 罗马转写 | `RomanizeService`（`TransferController`） |
| AI 翻译 / 问答 | `AiTranslateService` / `OpenAIService` / `EmbeddingService`（+ agent-poc LangGraph） |
| 聊天 | `ChatController` / `ChatMessageController`（需扩展公开问题 + citations） |
| 登录 | `AuthController` / `SignUpController` / `EmailCertificationController` |
