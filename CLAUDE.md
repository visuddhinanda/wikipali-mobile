@AGENTS.md

# 项目目录使用规则（必须遵守）

代码统一在 `src/` 下按职责分层，新增文件放对目录、不要往根目录堆：

| 目录 | 用途 |
|---|---|
| `src/screens/` | 页面组件，一个 Screen 一个文件（`XxxScreen.tsx`） |
| `src/components/` | 跨页面复用的 UI 组件 |
| `src/navigation/` | React Navigation 导航器与路由类型 |
| `src/api/` | 后端接口客户端（一个后端域一个文件，如 `like.ts` / `recent.ts`） |
| `src/data/` | 本地持久化与同步（SQLite / AsyncStorage、同步队列、迁移） |
| `src/auth/` | 登录会话（token / 当前用户） |
| `src/user/` | 多用户作用域与设备身份（`userScope` / `deviceUuid`） |
| `src/reading/` | 阅读链路（正文缓存、阅读单元、下载、章节查询） |
| `src/catalog/` | 三藏目录树 / 书目 |
| `src/i18n/` | 界面语言（按语言分目录、按语义分文件，见下方「i18n 目录结构」规则） |
| `src/theme/` | 主题与响应式断点数值（断点唯一数值来源 `breakpoints.ts`） |
| `src/settings/` | 用户设置项持久化 |
| `src/hooks/` | 跨组件复用 hook（如 `useLayout`） |
| `src/calendar/` `src/pali/` `src/linking/` `src/ai/` | 各自子项目的实现，自成目录、互不串 |
| `scripts/` | 自检脚本（`check-*.mjs`，纯 node 可跑、不依赖 App 运行） |
| `docs/` | 设计文档（见下方规则） |
| `assets/db/` | 打包进 App 的只读数据库（`tipitaka.db3`） |
| `patches/` | patch-package 补丁，随 `postinstall` 应用 |

- 跨层依赖方向：`screens/components` → `api/data/auth/user/reading/...`，底层模块不得反向依赖页面。
- 不改动 `index.ts` 的 polyfill 导入顺序、`metro.config.js`、`patches/`（见 `docs/README.md` §0.3 工程约束）。

# i18n 目录结构（必须遵守）

界面语言统一放在 `src/i18n/`，**按语言分目录、按语义分文件**：

```
src/i18n/
  index.ts          # Locale 类型、MessageKey 推导、translate/t、语言检测
  I18nContext.tsx   # useT() / useI18n() 的 React 绑定
  bookTitles.ts     # 巴利书名查找（book.title.<book>-<para>）
  zh-Hans/          # ← 每个 Locale 一个目录（zh-Hans / zh-Hant / en / my / th / si / vi / lo）
    messages.ts     # 一般消息：标题 / 描述 / 提示 / 空态 / 错误 / 占位
    labels.ts       # 标签：徽标 / Tab / 状态 / 选项 / 分类名（短名词、形容词）
    buttons.ts      # 按钮 / 动作文案（祈使动词，点在按钮上做的事）
    books.ts        # 巴利书名（丛书名 + level=1 实际书名），兜底用
```

- **语义归类**：新增文案先按「消息 / 标签 / 按钮」落对文件，再加到其它 7 个 locale 的同名文件。
- **`MessageKey`**：由 `zh-Hans` 的 `messages + labels + buttons` 三类 key 合并推导（`src/i18n/index.ts`），其它语言缺 key 会在 `tsc` 阶段报错。
- **books.ts 只放本地化译名，不放巴利名**：巴利原名在目录库 `pali_text.toc` 里，书名兜底链是「频道 level=1 译文 → i18n 译名 → 巴利 toc」。某语言还没译 `books.ts` 就不建该文件，`bookTitles.ts` 里也不登记，让它自然回退到巴利名。
- 别把巴利名、目录树节点名（`src/catalog/labels.ts` 那批）或字体名（`src/pali/script/labels.ts`，endonym）塞进 i18n 的 messages/labels/buttons。

# 设计文档使用规则（必须遵守）

- 设计文档统一放在 `docs/` 目录。
- 总入口是 `docs/README.md`，**只保留通用内容**：五大栏目简介、响应式策略（§4＝断点唯一真源）、技术路线/技术栈盘点、关键接口映射。
- **每个子项目单独写一份设计文档**（如 `docs/multi-user-sync.md`、`docs/chat.md`、`docs/reading-content.md`），并在 `docs/README.md` 的「子项目设计文档索引」里登记链接。
- 新增子项目设计时：新建 `docs/<topic>.md` → 在 `docs/README.md` 索引里加一行链接；**不要把子项目细节堆进 `docs/README.md`**。
- 修改响应式断点只改 `docs/README.md` §4 与 `src/theme/breakpoints.ts`，其余文档引用它、不重复定义阈值。
- 代码注释里引用设计文档统一用 `docs/README.md`（或对应的子项目文档），不再使用已废弃的根目录 `DESIGN.md`。

# 提交规则（必须遵守）

- **不自动提交**：完成工作后只交付改动、报告结果，`git add` / `git commit` / `git push` 一律不做。
- **人类 review**：提交前由人类审查代码与文档，确认无误后由人类执行提交。
- **按修改内容分批提交**：一次会话的改动若横跨多个主题，拆成多个 commit，每个 commit 只做一件事，例如：
  1. 文档重组（docs 移动 / 拆分子项目文档 / CLAUDE.md 规则）；
  2. 多用户同步功能实现（一个 commit 或按「数据层 / 同步引擎 / auth 集成」再细分）；
  3. i18n 文案、脚本自检等各自独立。
- **提交信息附带 emoji**：提交信息用「emoji + 动词 + 简述」的格式，示例：
  - `✨ 新增多用户数据同步（游客/登录隔离 + 阅读/收藏/书签/下载同步）`
  - `📝 重组设计文档：移入 docs/ 并拆分子项目文档`
  - `🐛 修复 xxx`
  - `♻️ 重构 xxx` / `✅ 新增自检脚本` / `🌐 更新 i18n 文案`

# 领域知识（务必遵守）

- **`pali_texts.level` 语义**：`level = 1` 是「书 / 作品」，`level ≤ 7` 是各级章节标题，`level = 100` 是正文段落。
- **「书」的服务器实体 = `progress_chapters` 里 `para` 指向 `level=1` 的那一行**：`progress_chapters` 表是章节级翻译进度，`(book, para, channel_id) → uid`；当 `para` 对应的 `pali_texts` 行 `level=1` 时，这条 `progress_chapters.uid` 就是「书」本身，**不是「章」**。
- **同步锚点规则（收藏/下载）**：`target_id` 锚定 level=1（书）——从「当前所在段」**向上搜索到 level=1**（`SELECT paragraph WHERE level=1 AND paragraph<=当前段 ORDER BY paragraph DESC LIMIT 1`），**不是**取第一个 level=1（一个 book 文件可能有多个 level=1 作品）。
- **同步锚点规则（书签）**：`target_id` 锚定「包含书签所在段的章节标题段」（`level≤7`，progress_chapters 只有章节级），**精确段（视口顶部段）记在 context**（`para:<n>`），下拉还原时用 context 还原精确位置。
- **同步锚点规则（在读/阅读记录）**：用「当前阅读页面最上面的 para」（视口顶部段），走 recent 的 `article_id = "<book>-<para>"`。
- 移动端 `book`（int）是一个「文件」，一个 book 可能装多部作品（多个 `level=1`）；书架上的「书」= `(book, 某个 level=1 的 para)`。
- **reaction 的 `context`**：收藏记 `book:<book>-<para>`、下载记 `book:<book>-<para>:<channel>`（para=level=1 段）、书签记 `para:<n>`（精确段）；下拉还原时以反查 `target_id`（progress_chapters 表）为准，context 是补充（书签用它还原精确段）。

# 书架测试 skill

- **触发词**：「测试书架功能」/「测试书架」。
- **行为**：自动跑一遍 `scripts/test-bookshelf.sh`，并按 `docs/multi-user-sync.md` §12 检查表逐项验证（三件套：本地 db + 服务器 + 手机 UI dump），最后输出一份测试报告（通过 / 失败 / 边界）。
- **语义区分**：
  - 只说「测试」→ **只测、不改代码**，报告问题即可。
  - 说「测试并改代码」→ 测 + 修 bug，修完再测一遍，报告修复内容。
- **环境前提**：真机经 adb（`ADB_SERVER_SOCKET=tcp:127.0.0.1:5037`）已连、本地服务器 `127.0.0.1:8000` 已开、Metro 已起（dev client 需加载最新 bundle，改代码后要重启 Metro 再测）。
- 测试账号 `visuddhinanda` / `123456`；验证手段见 `docs/testing.md` §0（uiautomator dump、注入点击盲区等）。
