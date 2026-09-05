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
| 0 | `mūla` / `pāḷi` | 原文（根本） |
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

## 4. 完整算法

给定 `(book, paragraph)`：

1. **定层次**：从该行沿 `parent` 向上，找到第一个带层次标签的祖先，按 §1 取最靠后的标签。
2. **取坐标**：读该行的 `(book_name, cs_para)`；为 `NULL` 则没有对应章节，结束。
3. **找关联**：查所有 `book_name` 与 `cs_para` 都相同的行。
4. **收敛到章节**：只保留 `level <= 7` 的行（章节行，非正文段落），并按 `book`
   去重 —— 同一部书内的多行属于同一章节的不同段落，取 `paragraph` 最小的一条。
   注意要先在子查询里定位每部书的最小 `paragraph` 再回表取整行；直接对各列
   取 `MIN()` 会拼出不属于同一行的 `level` / `toc`。
5. **给每条定层次**：对第 4 步的每条结果重复第 1 步，得到它所属的层次。
6. **排序**：按层次序列升序，同层按 `book` 升序。

### 实例

`abhi7 / cs_para = 1` 这个坐标下的对应章节：

| book | paragraph | toc | 层次 | 判定来源（祖先章节） |
|---|---|---|---|---|
| 69 | 2835 | Ārammaṇapaccayādi | 原文 | 2827 `13. Parittārammaṇattikaṃ` |
| 71 | 420 | 1. Paccayānulomaṃ | 原文 | 6 `12. Kilesagocchakaṃ` |
| 72 | 2477 | Hetu-ārammaṇapaccayā | 原文 | 2468 `Dhammānulomapaccanīye dukapaṭṭhānaṃ` |
| 81 | 2712 | Ārammaṇapaccayādi | 原文 | 2704 `2. Vedanāttikaṃ` |
| 98 | 1969 | 2. Ārammaṇapaccayaniddesavaṇṇanā | 义注 | 1880 `Paṭṭhānappakaraṇa-aṭṭhakathā` |
| 174 | 1111 | 2. Ārammaṇapaccayaniddesavaṇṇanā | 根本复注 | 1059 `Paṭṭhānapakaraṇa-mūlaṭīkā` |
| 176 | 1198 | 2. Ārammaṇapaccayaniddesavaṇṇanā | 再复注 | 1139 `Paṭṭhānapakaraṇa-anuṭīkā` |

## 5. 边界情况

- **带标签但没有层次标签**：410 行（如只有 `añña`、`ganthasaṅgaha`）。这类
  藏外文献层次未知，实现里返回 `null`，不要当成原文。
- **向上走到根仍无标签**：同上，层次未知。
- **`cs_para = 0`**：有效值，不是缺失标记；缺失一律是 `NULL`。
- **同坐标行数很多**：一个坐标最多可对应 1519 行（多为正文段落），
  所以第 4 步的 `level <= 7` 过滤和按 book 去重是必要的，否则会把整章段落
  全列成「关联章节」。
- **关联结果包含自己**：查询时要排除源章节所在的 book。

## 6. 实现

`src/catalog/commentary.ts`：

- `resolveLayer(db, book, paragraph)` —— 第 1 步，返回层次或 `null`
- `findRelatedChapters(db, book, paragraph)` —— 第 2–6 步，返回按层次排序的章节数组
- 均以 `SqlRunner` 接口取数，与具体的 SQLite 驱动解耦（App 用 `expo-sqlite`，
  Node 端校验脚本用内置 `node:sqlite`）

校验脚本：`node scripts/check-commentary.mjs [book] [paragraph]`
