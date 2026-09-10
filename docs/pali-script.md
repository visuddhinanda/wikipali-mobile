# 巴利文字体（script）转换

> 代码：`src/pali/script/`；工具页 `src/screens/ScriptConvertorScreen.tsx`；
> 阅读器接入点 `src/screens/ReaderLayerPane.tsx`。

## 1. 为什么需要

巴利语没有自己的文字，各国用自己的字母书写同一部三藏：斯里兰卡用锡兰文、
缅甸用缅文、泰国用泰文，西方与学术界用罗马转写。**同一段经文换一套字母就是
另一副面孔**，读者只认得自己那一套。服务端只发罗马转写，字体转换在客户端做。

## 2. 流水线

任何输入先归一到罗马巴利，再从罗马巴利转到目标字体 —— N 种字体只要 2N 张
映射表，不是 N²。

```
源字体 --(char_xxx_to_roman)--> 罗马巴利 --(char_roman_to_xxx)--> 目标字体
```

映射表由 `scripts/gen-script-tables.mjs` 从网页版
`mint/api-v13/public/charcode/*.js` 生成到 `src/pali/script/tables/`，
共 4775 条 / 约 130 KB。**中文读音表（37342 条 / 1.4 MB）不进移动端包**，
所以工具页没有「中文详细 / 简易 / 拼音」三个输出项。

### 2.1 为什么是逐条替换，不是前缀树

表是**有顺序、可链式**的。以锡兰文为例，辅音规则先产出带 virama 的形式
（`n` → `න්`），后面的规则再把 virama 和紧跟的罗马元音合并（`්a` → 空）。
编译成前缀树做单遍最长匹配会得到 `න්ඉග්අම්අන්අ` 而不是 `නිගමන`。

所以 `src/pali/script/apply.ts` 保留逐条替换，只把 `new RegExp(key,'g')` 换成
`split/join`（键都是字面量，生成脚本会校验没有正则元字符）。最大的一张表
（天城体系 2261 条）转 5000 字符实测 ≈ 1.9 ms，一个阅读单元的量级足够。

### 2.2 与网页版的三处**故意**差异

`scripts/check-script-convert.mjs` 拿本地实现和网页版逐条替换的实现对同一批
语料逐字比对（405 条章节标题 × 7 源 × 8 目标 × 2 档鼻音符号 = 44550 次，
**零差异**）。以下三处是有意为之，比对时跳过：

| 情形 | 网页版 | 这里 |
| --- | --- | --- |
| `roman → roman` | 整段转小写 | 保留大小写，只归一鼻音符号 |
| niggahita 选 `ŋ` 时的 `ṅk`/`ṅg` | 写成 `ŋk`/`ŋg` | 保持 `ṅk`/`ṅg`，与选 `ṃ`/`ṁ` 一致 |
| 大写 `ṂK`/`ṀK` | 写成 `ṄG` | 写成 `ṄK` |

后两条是网页版逐条替换的顺序造成的笔误：`ṅ` 出现在软腭塞音前是拼写惯例，
不是 niggahita 的另一种写法，不该被一起换掉。

## 3. 阅读器接入

### 3.1 默认字体

`src/pali/script/preference.ts`：默认 `auto`，跟随界面语言 ——
`si` → 锡兰文（传统正字法）、`my` → 缅文、`th` → 泰文，其余一律罗马巴利。
用户可在「阅读器 → 设置 → 巴利字体」手工指定，指定后不再跟随语言。
偏好存在 `ReaderSettings.paliScript` 里（`@wikipali/reader-settings`）。

### 3.2 转哪些字，靠什么判断

**不猜内容，只认服务端已有的标记**（`PaliContentService::renderReadSentences`）：

| 频道类型 | 段落外壳 | 处理 |
| --- | --- | --- |
| `original` / `wbw` | `<div class='original' …>` | 整块转换 |
| `translation` | `<div class='translation' …>` | 一个字都不动 |
| `nissaya` | `<div class='translation' …>` | **暂不支持**，见下 |

`src/pali/script/html.ts` 按标签深度扫描，进入带可转换 class 的元素才转文本
节点，标签、属性和 HTML 实体原样保留。章节标题（`toc`）本身就是巴利，整条转。

### 3.3 nissaya 的缺口

nissaya 频道是巴利与缅文逐词混排的。它在 `format=html` 下走
`NissayaTemplate` 的 default 分支，输出的是 `巴利၊缅文` **纯文本拼接**，
HTML 里没有任何标记能把巴利那半截认出来 —— 前端无法在不误伤缅文的前提下转换，
因此当前跳过，原样显示。

补齐的方式在后端：`app/Services/Templates/NissayaTemplate.php` 加一个 `html`
分支，把巴利包成 `<span class="pali">…</span>`。前端已经把 `pali` 也算作可转换
的 class，后端一改就自动生效，移动端不用动代码（注意后端段落有
`rememberForever` 缓存，改完要按 `PaliContentService::forgetParagraph` 清）。

## 4. 校验脚本

```bash
node scripts/gen-script-tables.mjs      # 重新生成映射表（改了上游 charcode 时）
node scripts/check-script-convert.mjs   # 与网页版逐字比对，应为「差异 0 次」
node scripts/check-script-convert.mjs --all  # 把 niggahita = ŋ 也比上，会报上表的已知差异
```

校验脚本需要先把 TS 编成 JS：

```bash
npx tsc --ignoreConfig src/pali/script/convert.ts \
  --outDir .check-script-convert --module commonjs --target es2020
```
