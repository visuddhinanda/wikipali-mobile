# 阅读页段落注释：义注 / 复注内容内嵌

> 版本：v2.0（2026-09-19，对齐实现：译文内嵌、`{{note}}` 的 `cite`/`citelink` 参数、段后脚注编号与角标↔脚注联动）
> 范围：阅读器「段落阅读」内嵌注释书内容 —— 根本中内嵌义注、义注中内嵌复注。
> 前置文档：`DESIGN.md`（§3 阅读器、§4 响应式断点＝唯一真源）；`docs/commentary-layers.md`（注释层次与对应章节查询）；`docs/reading-content.md`（正文获取、阅读单元切分与缓存）。
> 后端参照：mint/api-v13 的 `TipitakaReadParaController`、`PaliContentService`、`MdRender` / `TemplateRender`、`discussions` 表；锚定规范参照 [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)。

## 1. 定位

现有「义注复注对读」（`src/screens/ReaderScreen.tsx` 的 [原文 / 义注 / 复注] 标签栏）是**整页对读**：三层各自是独立整页，窄屏一屏一层左右滑、宽屏双列并排，对应关系是**章级**（一个章节 ↔ 另一层的整个章节）。

本功能是**段级内嵌**：在某一层正文内，把**它下一层注释书里对应的段落**嵌进正文一起读，不必切层：

| 当前层 | 内嵌内容 |
|---|---|
| 根本（mūla） | 义注（aṭṭhakathā） |
| 义注（aṭṭhakathā） | 复注（ṭīkā） |
| 复注（ṭīkā） | 再复注（依对应关系而定） |

只向下嵌一层，且链路顺着走（根本→义注→复注→…），不跳层、不反向嵌（`docs/commentary-layers.md` §1）。

借用 W3C 注释模型的语言：每一条内嵌注释 = 一个 **target（锚定位置，在根本句子里）+ body（义注内容）**。target 用 TextPositionSelector / TextQuoteSelector 精确定位；body 用义注的句子模板引用，渲染时再解析。

## 2. 实现方法总览（数据流）

```
根本正文句子（Sentence 表，content 含 {{sent|id=…}} 模板）
   │
   ▼ 渲染时（TipitakaReadParaController → PaliContentService::readParagraph → renderReadSentences）
   │   对每个句子，查 discussions（res_type='sentence'，res_id=该句 uid，type='note'）
   │   每条记录：pos_start/pos_end + quote_exact/prefix/suffix  → 锚定位置
   │             content = {{book-para-start-end}}              → 义注句子模板
   │
   ▼ injectAnnotationNotes（按 pos_end 倒序插入，避免位置漂移）
   │   ① 先把义注模板转成译文模板：{{book-para-start-end}} → {{sent|id=…|text=translation}}
   │   ② 用 text 格式预渲染成纯文本译文（只要中文译文，不含巴利原文、不含 HTML）
   │   ③ 在锚定位置插入：
   │        {{note|text=<纯文本译文>|cite=义注|citelink=book-para-start-end}}
   │
   ▼ 整句交给 MdRender 渲染（format=html）
   │   render_note() → 生成 tufte sidenote 标记（角标 + 可展开边注）
   │   由 citelink 生成 data-book/para/start/end，挂到角标 <label> 与 <cite> 上
   │   <cite class="anno-jump">义注</cite> 追加在 .sidenote 内（点它跳义注/复注整页）
   │
   ▼ 段落后追加 renderFootnoteList()（.anno-footnotes 脚注列表，每条默认收起 1 行）
   └─ 返回给 App（tipitaka-read-chapter 的 display 字段）
```

要点：**译文内嵌**（义注只显示译文，不显示巴利原文）；**模板复用**（sidenote 外壳由 `render_note()` 统一生成，`injectAnnotationNotes` 不再手拼 `<label>/<input>/<span>`）。

## 3. 存储：`discussions` 表扩展

在 `discussions` 表新增五列（migration `2026_09_18_100000_add_annotation_selectors_in_discussions`）：

```sql
-- 精定位：TextPositionSelector
pos_start    integer,      -- 可为空：锚点在句子文本内的起始字符位（0 起）
pos_end      integer,      -- 可为空：锚点的结束字符位（不含）

-- 精定位：TextQuoteSelector
quote_exact  text,         -- 可为空：被锚定文本的原文摘录
quote_prefix text,         -- 可为空：前缀上下文，建议 32~64 字符
quote_suffix text,         -- 可为空：后缀上下文
```

每条记录表达「某个句子的义注信息」，分两部分：

| 部分 | 字段 | 含义 |
|---|---|---|
| **target：义注锚定的位置** | `res_type` / `res_id` + 五个新列 | `res_type='sentence'`、`res_id=<根本句子的 uid>`；五个新列把锚点精确定位到句子内的一段文本 |
| **body：义注的内容** | `content` | **不是义注译文**，而是义注对应这个位置的**句子模板** `{{book-para-start-end}}`（§5） |

- 与普通用户讨论区分：`type='note'`（注释记录专用值）。
- `res_id` 沿用既有约定：`res_type='sentence'` 时 `res_id` 存 `Sentence.uid`（见 `DiscussionResource`）。
- 完整字段与插入 SQL 见 §15「discussions 插入数据格式」。

## 4. 锚定：W3C Web Annotation 选择器

参照 [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) 的文本选择器，两个选择器配合使用：

| 选择器 | 字段 | 映射列 | 作用 |
|---|---|---|---|
| **TextPositionSelector** | `start` / `end` | `pos_start` / `pos_end` | 字符位偏移，定位快 |
| **TextQuoteSelector** | `exact` / `prefix` / `suffix` | `quote_exact` / `quote_prefix` / `quote_suffix` | 摘录原文 + 上下文，抗文本位移 |

- **TextPositionSelector 快但脆**：正文一旦增删字符，偏移量就失效。
- **TextQuoteSelector 稳但慢**：靠原文摘录 + 前后缀（`prefix` / `suffix`）区分重复文本，正文小幅改动仍能定位。
- 两者并存：先用 position 快速定位，用 quote 校验 / 校正。

**倒序插入（关键约束）**：同一句子里可能有多条注释。插入模板**按位置从后往前（倒序）**——先插靠后的，再插靠前的。否则先插入的模板会改变其后所有文本的字符偏移，导致 `pos_start` / `pos_end` 全部错位。

**字符位口径**：`pos_start` / `pos_end` 是**该句译文文本**里的字符偏移（含标点，按 UTF-8 字符计，`mb_strlen`），不是字节偏移。

## 5. 内容：义注句子模板 + 译文渲染

义注内容**不用义注的译文**，而是存义注对应这个位置的**句子模板**：

```
{{book-para-start-end}}
```

- 即 `{{书号-段号-起始词位-结束词位}}`，与 `Sentence` 表的 `sid`（`book_id-paragraph-word_start-word_end`）同构。
- **可能是多个句子**：`start` 取第一句的 `word_start`、`end` 取末句的 `word_end`，覆盖一个句子区间。
- 模板在**渲染时**由 `MdRender` 解析，因此内容始终跟随当前频道 / 语言（切版本后义注内容也跟随切换），不把某次译文烘焙进去。

渲染义注正文时**只取译文、不取巴利原文**：先把裸句模板转成译文模板

```
{{book-para-start-end}}  →  {{sent|id=book-para-start-end|text=translation}}
```

再用 `text` 格式渲染（`MdRender::render(..., 'text')`），得到**纯文本译文**。`render_sent()` 的 `text` 分支按 `text=` 参数过滤，只输出 translation；`text` 格式也避免 `1.` 之类被 markdown 解释成有序列表、产生 `<ol></p></p>` 坏 HTML。

## 6. 渲染管线：`{{note|text=…|cite=…|citelink=…}}`

App 用 `TipitakaReadChapterController`（`GET /api/v3/tipitaka-read-chapter`，见 `docs/reading-content.md` §2）拿 HTML；两个接口共用 `PaliContentService::readParagraph`，注释是在**渲染句子**时注入的，与走哪个接口无关，流程：

1. `PaliContentService::renderReadSentences()` 逐句渲染（见 `docs/reading-content.md` §2）。
2. 渲染某句时，查该句的注释记录：`Discussion::where('res_type','sentence')->where('res_id', $sentence->uid)->where('type','note')->orderByDesc('pos_end')`。
3. 对每条记录，`injectAnnotationNotes()` 先预渲染义注译文（§5），再在锚定位置插入模板：

   ```
   {{note|text=<纯文本译文>|cite=义注|citelink=book-para-start-end}}
   ```

   同一句多条时**倒序插入**（§4）。
4. 整句交给 `MdRender`（`format=html`）：
   - `render_note()` 把 `{{note|…}}` 渲染成 tufte sidenote 标记（`.sidenote-number` 角标 + `.sidenote` 可展开边注）；
   - 由 `citelink`（`book-para-start-end`）拆出坐标，生成 `data-book/para/start/end`，同时挂到角标 `<label>` 与 `<cite>` 上；
   - `<cite class="anno-jump" data-…>义注</cite>` 追加在 `.sidenote` 内（点它跳义注/复注整页并高亮）。
5. 段落渲染完后，`readParagraph()` 追加 `renderFootnoteList()`（`.anno-footnotes` 脚注列表，供「段后」模式显示）。

`{{note}}` 模板的参数（`TemplateRender::render_note`）：

| 参数 | 位置 | 含义 |
|---|---|---|
| `text` | 1 | 注释正文（这里传**已预渲染的纯文本译文**） |
| `trigger` | 2 | 角标内的文字（阅读页留空，编号由 App 端 JS 生成） |
| `cite` | 3 | 跳转链接文字（`义注` / `复注`） |
| `citelink` | 4 | 跳转目标 `book-para-start-end`，拆出 `data-book/para/start/end` |

⚠️ **为什么 `text` 传预渲染纯文本、而不是嵌套模板**：`{{note|text={{sent|…}}}}` 这种嵌套会被 `wiki2xml` 的平铺替换破坏（实测输出 `<ol></p><li>…` 坏 HTML）。所以必须先渲染成纯文本再塞进 `text`。

## 7. 注释条目

一条「注释条目」= 义注/复注里的一段（或连续几段）对应正文，经 §6 渲染后呈现。它携带：

- 来源坐标（义注的 `book` / `para` / `word_start`–`word_end`，由句子模板给出）；
- 义注译文（`{{sent|…|text=translation}}` 渲染所得，纯译文）；
- 跳转锚点（`<cite>`，指向义注/复注整页对应位置）。

同一段正文可能对应多条注释，脚注按条列出、角标按序编号。

## 8. 呈现模式（两维：用户偏好 × 宽度）

呈现由**两个正交维度**决定，注释条目是同一份内容，差别仅在「放哪」：

| 维度 | 取值 | 来源 |
|---|---|---|
| **注释呈现方式**（`ReaderSettings.annotationMode`） | `inline`（行内）/ `footnote`（段后） | 用户设置，默认 `inline` |
| **边注栏**（`sidenote` 模式） | `inline`（角标折叠）/ `margin`（右侧常驻栏） | 阅读区净宽自动判定 |

- `annotationMode="inline"`：注释以 sidenote 形态显示 —— 窄屏点角标就地展开，宽屏（净宽 ≥ `SIDENOTE_MARGIN_MIN_WIDTH`=840dp）常驻右侧边注栏。
- `annotationMode="footnote"`：注释以**段后脚注列表**显示，正文只保留数字角标（`.sidenote` 强制隐藏，`display:none !important`）。

宽度阈值沿用 `theme/breakpoints.ts`（`DESIGN.md` §4.1），不按设备类型硬编码：

- 净宽 < `SIDENOTE_MARGIN_MIN_WIDTH`（840dp）→ 角标折叠（行内）；
- 净宽 ≥ 840 且未开双列 → 右侧边注栏（仅 `annotationMode="inline"` 生效）；
- 双列时（净宽 ≥ `DUAL_COLUMN_MIN_WIDTH`=1000dp）每栏**各自**按自己的净宽判定（见 §11）。

## 9. 行内模式（手机）

### 9.1 角标

- 在需要注释的位置显示数字角标 `[1]` `[2]`…（`.sidenote-number` 上标）。
- 编号由 **App 端 JS 显式生成**：按段落（`div[data-para]`）分组、按文档顺序给 `.sidenote-number` 与 `.anno-footnote` 依次写 `[1] [2]…`，并写 `data-idx` 互相关联。**不用 CSS counter** —— 部分 WebView 里 `counter-reset` 在嵌套结构下作用域不按预期重置，会出现角标全是 `[1]`。
- 点击角标：`annotationMode="inline"` 时**在当前行下方展开**该条注释，再点收起（tufte `margin-toggle` 折叠）；`annotationMode="footnote"` 时**滚到段后对应脚注并短暂高亮**（§9.4）。

### 9.2 段落脚注（`annotationMode="footnote"`）

- 本段的注释条目**显示在本段后面**（段号之后、下一段之前），逐条列出。
- 每条前面有对应数字 `[N]`，与正文角标一一对应（§9.1 的 `data-idx`）。
- 每条默认**收起为 1 行**（`ReaderSettings.annotationCollapsedLines`，§12），点击正文展开全文、再点收起。
- 灰色细边框、字号比正文小一点（`font-size:0.85em`），跟随全局字号设置。

### 9.3 跳转链接（`<cite>`）

- 注释展开后（角标展开态或脚注展开态），条目内显示链接（`<cite>` 渲染的点击锚点）。
- 点击 → 跳到**该层注释书的整页对读**（既有层级标签栏），并滚动到对应句子、**高亮**。
- 跳转后可经标签栏正常切回。段级内嵌是「快读」，跳转是「进入全页细读」，两者共用同一套层级对读。

### 9.4 角标 ↔ 脚注联动（段后模式）

纯 App 端 WebView 内实现，不经过 RN 往返：

- 点正文角标 `[N]` → 同段内滚到对应 `.anno-footnote`，加 `.anno-highlight` 短暂高亮（约 2.2s）。
- 点脚注编号 `[N]` → 滚回对应正文角标并高亮；`preventDefault` 避免误触发脚注展开/收起。
- 按 `data-idx` 在**同一段落**（`div[data-para]`）作用域内查找，避免跨段误命中同名编号。

## 10. 边注模式（平板竖屏）

- `annotationMode="inline"` 且净宽 ≥ 840 时，注释条目常驻**右侧边注栏**（宽度沿用 `SIDENOTE_WIDTH`=200dp，样式对齐 `buildReaderHtml` 的 `data-sidenote="margin"` 边注浮排）。
- 正文里仍保留角标 `[1]`，点击角标把右侧栏滚动到/高亮对应条目。
- 每条注释右下角同样有 `<cite>` 跳转链接（§9.3）。

## 11. 双栏（平板横屏 / 大平板横屏）

复用既有层级标签栏的双列形态（`ReaderScreen` 的 `canDualColumn`，净宽 ≥ `DUAL_COLUMN_MIN_WIDTH`=1000dp）：

| 场景 | 宽度档 | 左栏（根本） | 右栏（义注/复注） |
|---|---|---|---|
| 平板横屏 | expanded（840–1199） | 行内模式；点角标 → 右栏高亮对应句 | 行内模式（内嵌自己的下一层） |
| 大平板横屏 | large（≥ 1200） | 行内模式（同上） | **边注模式** |

- **平板横屏**：左右两栏都窄（各约 440dp < 840），都走行内模式。左侧根本点角标，右侧义注**滚动到对应句并高亮**（按句子模板坐标对齐）；反之亦然 —— 这是「左边点、右边看」的对照体验。
- **大平板横屏**：左栏仍行内模式（窄栏），右栏更宽（≥ 840）走边注模式。左栏点角标 → 右栏高亮对应句，语义同平板横屏。
- 双栏的两栏**各自**判定模式（每栏自己的净宽过 840 才开边注），阈值仍从 `breakpoints.ts` 取，不另造断点。

## 12. 设置项

阅读偏好（`src/settings/reader.ts`）新增两项：

| 字段 | 取值 | 默认 |
|---|---|---|
| `annotationMode` | `inline`（行内）/ `footnote`（段后） | `inline` |
| `annotationCollapsedLines` | 段后脚注默认收起行数（≥1） | **1** |

- `annotationCollapsedLines` 可选项：1 / 2 / 3 / 5。
- `annotationCollapsedLines` 只作用于**段后脚注**；角标展开、边注栏不受影响。

## 13. 注释文本对应方法（如何建立「根本 ↔ 义注」对应）

义注（aṭṭhakathā）的行文特征是**先引根本词句、再解释**：它常把根本里要解释的短语原样引出（lemma），其后接「即……」「：……」的释义。因此对应关系是**「根本句的某个片段 ↔ 义注的某段文字」**，建立分两步：

**A. 数据准备（离线 / 人工 + LLM）**

1. 取根本段落的**译文**（带句子坐标 `book-para-word_start-word_end`）和义注段落的**译文**（同样带句子坐标）。
2. 让 LLM 阅读义注译文，识别每一段义注「引用/解释了根本的哪个片段」：
   - 输出该片段的原文摘录（`quote_exact`）＋ 前后缀（`quote_prefix`/`quote_suffix`）；
   - 输出该片段在**根本句译文文本里的字符位置**（`pos_start`/`pos_end`，含标点）；
   - 输出该段义注的**句子模板** `{{book-para-start-end}}`。
3. 按 §15 的格式插入 `discussions` 记录。

**B. 渲染时解析**

- 根本句按 `pos_start`/`pos_end` 倒序插入 `{{note}}`（§4 / §6）。
- 义注内容由 `{{book-para-start-end}}` 模板渲染，跟随当前频道（§5）。
- 这样「对应关系」只存坐标与模板，不烘焙任何译文正文，句子更新后无需改注释记录。

**位置口径（关键）**：`pos_start`/`pos_end` 必须按**给 LLM 的那份根本句译文文本**来数（0 起、含标点）。若根本句译文被更新，位置可能失效，需用 `quote_exact` 重新定位（§4）。

## 14. discussions 插入数据格式

一条注释 = 一条 `discussions` 记录。以「根本句 89-8-41-59 里嵌义注 101-507-2-23」为例：

```sql
INSERT INTO discussions (
    id, res_id, res_type, type, content, content_type, status,
    pos_start, pos_end, quote_exact, quote_prefix, quote_suffix, editor_uid
) VALUES (
    '6cf001da-b37a-11f1-8588-1331e03ff0c9',      -- id：uuid（默认 uuid_generate_v1mc()，可省略）
    'a2c6c744-87cb-4927-82db-82458da8f1e8',      -- res_id：根本句 89-8-41-59 的 uid
    'sentence',                                  -- res_type
    'note',                                      -- type：注释记录专用值
    '{{101-507-2-23}}',                          -- content：义注句子模板（不是译文）
    'markdown',                                  -- content_type
    'active',                                    -- status
    0,                                           -- pos_start：片段在根本句译文中的起始字符位
    9,                                           -- pos_end：结束字符位（不含）
    '在此，诸比库，比库',                        -- quote_exact：被锚定文本摘录
    '',                                          -- quote_prefix：前缀上下文（可为空）
    '以眼看到颜色后，不欣喜也不忧恼，保持中舍、具念、正知而住。',  -- quote_suffix
    'ba5463f3-72d1-4410-858e-eadd10884713'       -- editor_uid
);
```

字段约定：

| 字段 | 必填 | 取值 / 说明 |
|---|---|---|
| `res_type` | ✅ | `'sentence'` |
| `res_id` | ✅ | 被注释的根本句 `Sentence.uid` |
| `type` | ✅ | `'note'`（区分普通讨论 `'discussion'`） |
| `content` | ✅ | 义注句子模板 `{{book-para-start-end}}` |
| `content_type` | ✅ | `'markdown'` |
| `pos_start` / `pos_end` | 建议 | 根本句译文内的字符位（0 起、含标点、不含结束位） |
| `quote_exact` / `quote_prefix` / `quote_suffix` | 建议 | 摘录 + 前后缀（抗文本位移） |
| `editor_uid` | ✅ | 插入者 uid |
| `id` / `status` / `publicity` | 可省 | 走默认（`uuid_generate_v1mc()` / `'active'` / `'public'`） |

插入后必须失效对应段落的阅读缓存（`PaliContentService::forgetParagraph(book, para, channel)`），否则旧缓存里还是旧注释。

## 15. 范例提示词（生成对应关系 + discussions 数据）

用于让 LLM 读义注译文、生成「根本片段 ↔ 义注段落」的对应关系与插入数据。下方 `{{…}}` 是占位符：

```
你是巴利三藏文献的校对助手。下面给你两段译文（同一频道、同一版本）：

【根本（mūla）】《六集》第 8 段，句子 89-8-41-59，译文：
在此，诸比库，比库以眼看到颜色后，不欣喜也不忧恼，保持中舍、具念、正知而住。

【义注（aṭṭhakathā）】第 507 段，各句坐标与译文如下：
- {{101-507-2-23}}：在《六集》的第一经中：「在此，诸比库，比库」——「诸比库」，即在此教法中的比库。
- {{101-507-24-42}}：「不欣喜也不忧恼」：对可意之境，不因与贪俱的喜而欣喜；对不可意之境，不因与嗔俱的忧而忧恼。
- {{101-507-43-60}}：「保持中舍、具念、正知而住」：对中性之境，不以无慧观察的愚痴舍而住于舍，而是具念、正知地于所缘保持中舍而住。

任务：找出每段义注对应根本句译文里的哪个片段。

规则：
1. 位置按「根本句译文」的字符来数，从 0 开始、含标点（顿号/逗号/句号都算一个字），pos_end 是不含该位的结束下标。
2. quote_exact 必须是根本句译文里**原样出现**的子串（含标点）；quote_prefix / quote_suffix 各取前后 32 字以内的上下文，可为空。
3. content 用义注的句子模板坐标，格式 {{book-para-start-end}}（不要写义注译文本身）。
4. 若一段义注对应多个不连续片段，拆成多条；若某段义注只是总起/过渡、不对应具体片段，跳过。

只输出 JSON，不要解释，格式如下：
{
  "items": [
    {
      "content": "{{101-507-2-23}}",
      "pos_start": 0,
      "pos_end": 9,
      "quote_exact": "在此，诸比库，比库",
      "quote_prefix": "",
      "quote_suffix": "以眼看到颜色后，不欣喜也不忧恼，保持中舍、具念、正知而住。"
    },
    {
      "content": "{{101-507-24-42}}",
      "pos_start": 17,
      "pos_end": 24,
      "quote_exact": "不欣喜也不忧恼",
      "quote_prefix": "在此，诸比库，比库以眼看到颜色后，",
      "quote_suffix": "，保持中舍、具念、正知而住。"
    },
    {
      "content": "{{101-507-43-60}}",
      "pos_start": 25,
      "pos_end": 37,
      "quote_exact": "保持中舍、具念、正知而住",
      "quote_prefix": "不欣喜也不忧恼，",
      "quote_suffix": "。"
    }
  ]
}
```

说明：LLM 输出的 `items` 逐条转成 §14 的 `INSERT`（`res_id` = 根本句 uid、`res_type='sentence'`、`type='note'`、`editor_uid` 取当前用户）。

## 16. 与既有功能的关系 / 边界

- **与层级标签栏不冲突**：标签栏是整页对读（章级），本功能是段级内嵌；`<cite>` 跳转把它们串起来（§9.3）。
- **正文获取复用**：注释内容走 `docs/reading-content.md` 的同一条链路（`tipitaka-read-chapter` + `para_html` 缓存），App 侧无需新接口；注释记录存在 mint 的 `discussions` 表（§3）。
- **缓存失效**：`renderReadSentences` 按 `(book, para, channel)` 缓存（`PaliContentService`），注释注入发生在缓存内容里。因此**改/删 `discussions` 注释记录后，须失效对应段落的缓存**（`PaliContentService::forgetParagraph`），否则旧缓存里还是旧注释。
- **无对应注释的段落**：查不到注释记录 → 不显示角标/脚注，段落外观与现状一致；把「无注释」当正常结果而非错误。
- **锚点定位失败**：`pos_start/pos_end` 与 `quote_exact` 均未命中（正文被大改）时，退化为「不插入」或「挂到句尾」，不阻断正文渲染。
- **稠密重复文献（如 Paṭṭhāna）**：同一位置可能对应多条注释（`docs/commentary-layers.md` §5），按序编号列出即可，属已知局限。
- **反向内嵌**：义注只嵌复注、不嵌根本；根本只嵌义注。标签栏的相邻限制（`ReaderScreen` 不允许原文直接跳复注）对内嵌同样成立。
- **巴利字体/深色/字号**：注释条目沿用正文的同一套 WebView CSS 变量（`--paper` / `--ink` / `--vermilion` / `--hairline` / `--base`），跟随全局阅读设置，与正文视觉一致。

## 17. 验收要点

1. 手机（compact）：根本段落有对应义注时，段后（`annotationMode="footnote"`）出现脚注列表（每条带 `[N]` 编号、默认收起 1 行、点开读全文再点收起）；正文内对应位置有 `[1]` 角标。
2. 点正文角标 → 滚到段后对应脚注并短暂高亮；点脚注编号 → 滚回正文角标并高亮。
3. 脚注/角标展开态有 `<cite>` 链接，点击进入义注整页对读并高亮对应句子，可经标签栏切回。
4. 义注层内嵌复注，规则同 1–3。
5. 义注内容显示的是**译文**（不含巴利原文），且跟随当前频道；切版本后内嵌内容随之切换。
6. 平板竖屏（净宽 ≥ 840，`annotationMode="inline"`）：注释常驻右侧边注栏；角标点击滚动/高亮对应条目。
7. 平板横屏（双列）：左根本行内模式，点角标右侧义注高亮对应句；右义注也显示为行内模式（内嵌复注）。
8. 大平板横屏（双列，右栏 ≥ 840）：左栏同 7，右栏为边注模式。
9. `annotationMode`、`annotationCollapsedLines` 在阅读设置可调并持久化。
10. 无对应注释的段落不出现任何角标/脚注，正文外观与现状一致；改/删注释记录后刷新能看到变化（缓存失效生效）；缩回窄屏/切换字号/深浅色时布局无状态丢失（`DESIGN.md` §4.9）。
