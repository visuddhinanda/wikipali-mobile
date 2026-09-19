# 注释层次与对应章节查询

巴利文献是分层的：根本经文之上有义注，义注之上有复注，复注之上还有再复注。
「义注复注对读」要解决的问题是：**给定任意一个章节 `(book, paragraph)`，
找出它在其他各层文献中的对应章节，并知道每一个属于哪一层。**

数据来自离线库 `assets/db/tipitaka.db3`（由 mint/api-v13 的
`php artisan export:mobile.heading` 导出，字段说明见该命令）。

## 1. 层次序列

层次由 `pali_text.tags` 中的标签确定，从根本到最外层依次是：

| # | 标签 | 含义 |
|---|---|---|
| 0 | `mūla` / `pāḷi` | 原文（根本）。两者是同一层，没有区别 |
| 1 | `aṭṭhakathā` | 义注 |
| 2 | `ṭīkā` | 复注 |
| 3 | `mūlaṭīkā` | 根本复注 |
| 4 | `anuṭīkā` | 再复注 |

一行可能同时带多个层次标签（如 `ṭīkā,mūlaṭīkā`、`mūla,pāḷi`）。
**取序列中最靠后的那个**作为该章节的层次 —— `mūlaṭīkā` 比 `ṭīkā` 更具体。

## 2. 标签挂在书上，不挂在段落上

全库 523284 行里只有 2762 行带标签，按 level 分布：

```
level 1: 273    level 2: 2274    level 3: 210    其他: 5
```

原因是 **level 1 就是一本书**，书内所有段落属于同一注释层次，因此标签只打在
书（或卷）这一层。所以判断某段落的层次必须**沿 `parent` 向上走**，直到遇到
带层次标签的祖先。

`parent` 存的是**同一 book 内**父节点的 `paragraph`；根节点的 `parent` 为 `-1`。

## 3. 关联靠 `(book_name, cs_para)`

`pali_text` 的 `book_name` + `cs_para` 是跨文献的对齐坐标：
**这两个字段相同的段落，就是互相对应的段落。** 无对应注释书时两列为 `NULL`
（523284 行中 408573 行有值）。

**但标题行（`level <= 7`）自己的 `cs_para` 不能拿来对齐。** 标题本身没有
义注复注 —— 查“标题自己坐标”对应的章节没有意义；更麻烦的是它经常是错的：
标题嵌套且中间没有正文时，多层标题会共享同一个（其实属于上一段正文的）
`cs_para` 值。例如书 93：

```
paragraph=3  level=1  "(DN) Sīlakkhandhavaggapāḷi"   cs_para=0   ← 书标题
paragraph=4  level=2  "1. Brahmajālasuttaṃ"          cs_para=0   ← 经标题（嵌套，无正文）
paragraph=5  level=4  "Paribbājakakathā"              cs_para=0   ← 章标题（嵌套，无正文）
paragraph=6  level=100 (正文)                          cs_para=1   ← 真正的新坐标从这里开始
```

三层标题都是 `cs_para=0`。按标题自己的坐标去义注库（`dn1/0`）匹配，会连带
命中外层的经标题、书标题所在行，`MIN(paragraph)` 只会选中最外层的
`103:199 "1. Brahmajālasuttavaṇṇanā"`（经标题），而不是真正对应的
`103:200 "Paribbājakakathāvaṇṇanā"`（章标题）——选错了一层。

**正确做法：用标题下面第一个正文段落的 `(book_name, cs_para)`。**
上例即 `paragraph=6` 的 `dn1/1`，这才是这一章的正文真正开始的坐标，唯一且
不会跟外层标题混淆。正文段落（`level = 100`）本身已经是最小对齐单位，无需
下探，直接用自己的坐标。

## 4. 完整算法

给定 `(book, paragraph)`：

1. **定层次**：从该行沿 `parent` 向上，找到第一个带层次标签的祖先，按 §1 取最靠后的标签。
2. **取查询坐标**（`chapterCoordinate`）：
   - 若该行是标题（`level <= 7`）：取它下面第一个正文段落
     （`parent = 该标题, paragraph` 最小）的 `(book_name, cs_para)`；
     找不到或为 `NULL` 则没有可查的正文，返回空数组结束。
   - 否则（该行本身就是正文段落）：直接用它自己的 `(book_name, cs_para)`；
     为 `NULL` 则结束。
3. **找关联**：查所有 `book_name` 与 `cs_para` 都相同、且不在源书的行
   （不限层级，因为匹配到的通常是正文段落）。
4. **按书去重，收敛到章节**：按 `book` 分组取 `paragraph` 最小的一行
   （先在子查询里定位每部书的最小 `paragraph` 再回表取整行；直接对各列取
   `MIN()` 会拼出不属于同一行的 `level` / `toc`）；再对这一行沿 `parent`
   向上走，找到最近的 `level <= 7` 祖先（若它自己已经是标题行则原地返回）
   ——这才是「对应章节」。
5. **给每条定层次**：对第 4 步收敛出的每个章节重复第 1 步，得到它所属的层次。
6. **排序**：按层次序列升序，同层按 `book` 升序。

### 实例

延续 §3 的例子，`93:5 "Paribbājakakathā"` 的对应章节（查询坐标 `dn1/1`）：

| book | paragraph | toc | 层次 |
|---|---|---|---|
| 103 | 200 | Paribbājakakathāvaṇṇanā | 义注 |
| 185 | 122 | Paribbājakakathāvaṇṇanā | 复注 |
| 188 | 460 | Paribbājakakathāvaṇṇanā | 复注 |

## 5. 边界情况

- **带标签但没有层次标签**：410 行（如只有 `añña`、`ganthasaṅgaha`）。这类
  藏外文献层次未知，实现里返回 `null`，不要当成原文。
- **向上走到根仍无标签**：同上，层次未知。
- **`cs_para = 0`**：有效值，不是缺失标记；缺失一律是 `NULL`。
- **标题下没有正文**（罕见，如空标题）：`chapterCoordinate` 返回 `null`，
  `findRelatedChapters` 返回空数组 —— 不要退回标题自己的坐标。
- **同坐标行数很多**：一个坐标最多可对应上千行正文段落，所以第 4 步的
  按 book 去重是必要的，否则会把整章段落全列成「关联章节」。
- **稠密重复的文献（如巴他那 Paṭṭhāna，书 69/70/71/72 等）**：同一个
  `(book_name, cs_para)` 在一本书内可能重复出现在多处（条件排列组合导致），
  且相邻标题之间往往只有一两行正文。这种体量下「标题下第一段正文」未必
  精确落在语义对应的段落上，属已知局限，暂不特殊处理。
- **关联结果包含自己**：查询时要排除源章节所在的 book。

## 6. 实现

`src/catalog/commentary.ts`：

- `resolveLayer(db, book, paragraph)` —— §4 第 1 步，返回层次或 `null`
- `chapterCoordinate(db, row)` —— §4 第 2 步，返回查询坐标或 `null`
- `findRelatedChapters(db, book, paragraph)` —— §4 第 2–6 步，返回按层次排序的章节数组
- 均以 `SqlRunner` 接口取数，与具体的 SQLite 驱动解耦（App 用 `expo-sqlite`，
  Node 端校验脚本用内置 `node:sqlite`）

校验脚本：`node scripts/check-commentary.mjs [book] [paragraph]`

> 章级对应之上，阅读页还把下一层注释书内容**段级内嵌**进段落（不收敛到章节行），见 [`docs/reading-annotations.md`](./reading-annotations.md)。
