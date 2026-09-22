# 阅读器页面（核心功能）

> 本文从总设计入口 [`README.md`](./README.md) 的「阅读器」一节独立出来，是阅读器的**形态总览**。
> 正文获取 / 阅读单元切分 / 缓存的实现细节见 [`reading-content.md`](./reading-content.md)；
> 段级注释（义注/复注内容内嵌）见 [`reading-annotations.md`](./reading-annotations.md)；
> 注释层次与对应章节查询见 [`commentary-layers.md`](./commentary-layers.md)。

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

## 响应式关键点

按窗口宽度分档（定义见 [`README.md`](./README.md) §4.2），不按设备类型判断：

| 档位 | 阅读器 |
|---|---|
| compact（< 600） | 单列；多版本对照 → 版本切换 Tab；边注行内折叠 |
| medium（600–839） | 单列居中限宽；边注行内折叠 |
| expanded（840–1199） | 单列居中 + 右侧 Tufte 边注栏 |
| large（≥ 1200） | 左列表 + 右阅读区；双列并排对照 |

完整规则与 WebView 注入约定见 [`README.md`](./README.md) §4.7。
