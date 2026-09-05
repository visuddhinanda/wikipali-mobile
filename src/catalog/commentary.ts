/**
 * 注释层次识别与对应章节查询。
 *
 * 算法与数据来源见 `docs/commentary-layers.md`。要点：
 * - 层次标签只打在书（level 1/2）上，段落层次要沿 `parent` 向上找；
 * - `(book_name, cs_para)` 相同的段落互为对应段落；
 * - 一个坐标下可能有上千行正文段落，必须收敛到章节行再按书去重。
 */

/** 从根本到最外层的注释层次序列。 */
export const COMMENTARY_LAYERS = [
  "mula",
  "atthakatha",
  "tika",
  "mulatika",
  "anutika",
] as const;

export type CommentaryLayer = (typeof COMMENTARY_LAYERS)[number];

/** 层次标签 → 层次。一行可能同时命中多个，取序列中最靠后的（最具体的）。 */
const TAG_TO_LAYER: Record<string, CommentaryLayer> = {
  "mūla": "mula",
  "pāḷi": "mula",
  "aṭṭhakathā": "atthakatha",
  "ṭīkā": "tika",
  "mūlaṭīkā": "mulatika",
  "anuṭīkā": "anutika",
};

export const LAYER_LABEL: Record<CommentaryLayer, string> = {
  mula: "原文",
  atthakatha: "义注",
  tika: "复注",
  mulatika: "根本复注",
  anutika: "再复注",
};

/** 只有 level <= 7 的行是章节行，其余是正文段落。 */
const CHAPTER_MAX_LEVEL = 7;

/** 沿 parent 向上的最大跳数，防御脏数据成环。 */
const MAX_ANCESTOR_HOPS = 32;

/** 与具体 SQLite 驱动解耦：App 用 expo-sqlite，校验脚本用 node:sqlite。 */
export interface SqlRunner {
  all<T = unknown>(sql: string, params: unknown[]): Promise<T[]>;
}

interface TextRow {
  book: number;
  paragraph: number;
  level: number;
  toc: string | null;
  parent: number | null;
  tags: string | null;
  cs_para: number | null;
  book_name: string | null;
}

export interface LayerResult {
  layer: CommentaryLayer;
  /** 判定层次所依据的祖先章节（标签所在行）。 */
  source: { book: number; paragraph: number; toc: string | null };
}

export interface RelatedChapter {
  book: number;
  paragraph: number;
  level: number;
  toc: string | null;
  /** 层次未知时为 null（藏外文献等，见文档 §5）。 */
  layer: CommentaryLayer | null;
  layerLabel: string | null;
}

const SELECT_COLUMNS =
  "book, paragraph, level, toc, parent, tags, cs_para, book_name";

async function getRow(
  db: SqlRunner,
  book: number,
  paragraph: number,
): Promise<TextRow | null> {
  const rows = await db.all<TextRow>(
    `SELECT ${SELECT_COLUMNS} FROM pali_text WHERE book = ? AND paragraph = ?`,
    [book, paragraph],
  );
  return rows[0] ?? null;
}

/** 取一行 tags 中最具体的层次；没有层次标签返回 null。 */
function layerFromTags(tags: string | null): CommentaryLayer | null {
  if (!tags) return null;
  let best: CommentaryLayer | null = null;
  let bestRank = -1;
  for (const tag of tags.split(",")) {
    const layer = TAG_TO_LAYER[tag.trim()];
    if (!layer) continue;
    const rank = COMMENTARY_LAYERS.indexOf(layer);
    if (rank > bestRank) {
      best = layer;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * 判定某段落属于哪一层文献：沿 `parent` 向上，取第一个带层次标签的祖先。
 *
 * 返回 null 表示层次未知（藏外文献，或标签里没有层次标签）——不要当成原文。
 */
export async function resolveLayer(
  db: SqlRunner,
  book: number,
  paragraph: number,
): Promise<LayerResult | null> {
  let cur = await getRow(db, book, paragraph);
  for (let hop = 0; cur && hop < MAX_ANCESTOR_HOPS; hop++) {
    const layer = layerFromTags(cur.tags);
    if (layer) {
      return {
        layer,
        source: { book: cur.book, paragraph: cur.paragraph, toc: cur.toc },
      };
    }
    if (cur.parent === null || cur.parent < 0) break;
    cur = await getRow(db, cur.book, cur.parent);
  }
  return null;
}

/**
 * 找出给定章节在其他各层文献中的对应章节，按层次序列排序。
 *
 * 不含源章节所在的书。源段落没有 `(book_name, cs_para)` 时返回空数组。
 */
export async function findRelatedChapters(
  db: SqlRunner,
  book: number,
  paragraph: number,
): Promise<RelatedChapter[]> {
  const self = await getRow(db, book, paragraph);
  if (!self || self.book_name === null || self.cs_para === null) return [];

  // 同坐标下每部书取 paragraph 最小的章节行 —— 同书多行属于同一章节的不同段落。
  // 先在子查询里定位每部书的最小 paragraph 再回表取整行：
  // 直接对各列取 MIN 会拼出不属于同一行的 level / toc。
  const rows = await db.all<{
    book: number;
    paragraph: number;
    level: number;
    toc: string | null;
  }>(
    `SELECT p.book, p.paragraph, p.level, p.toc
       FROM pali_text p
       JOIN (SELECT book, MIN(paragraph) AS paragraph
               FROM pali_text
              WHERE book_name = ? AND cs_para = ? AND level <= ? AND book <> ?
              GROUP BY book) g
         ON g.book = p.book AND g.paragraph = p.paragraph
      ORDER BY p.book`,
    [self.book_name, self.cs_para, CHAPTER_MAX_LEVEL, book],
  );

  const out: RelatedChapter[] = [];
  for (const row of rows) {
    const resolved = await resolveLayer(db, row.book, row.paragraph);
    out.push({
      book: row.book,
      paragraph: row.paragraph,
      level: row.level,
      toc: row.toc,
      layer: resolved?.layer ?? null,
      layerLabel: resolved ? LAYER_LABEL[resolved.layer] : null,
    });
  }

  // 层次序列升序；层次未知的排在最后，同层按 book
  return out.sort((a, b) => {
    const ra = a.layer ? COMMENTARY_LAYERS.indexOf(a.layer) : Number.MAX_SAFE_INTEGER;
    const rb = b.layer ? COMMENTARY_LAYERS.indexOf(b.layer) : Number.MAX_SAFE_INTEGER;
    return ra === rb ? a.book - b.book : ra - rb;
  });
}
