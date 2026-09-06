/**
 * 注释层次识别与对应章节查询。
 *
 * 算法与数据来源见 `docs/commentary-layers.md`。要点：
 * - 层次标签只打在书（level 1/2）上，段落层次要沿 `parent` 向上找；
 * - `(book_name, cs_para)` 相同的段落互为对应段落；
 * - 一个坐标下可能有上千行正文段落，必须收敛到章节行再按书去重；
 * - 标题行自己的 `cs_para` 常常是上一章遗留的旧值（导出时没有随标题推进），
 *   不能拿来对齐 —— 要用标题下面第一个正文段落的 `(book_name, cs_para)`。
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

/** UI 显示用的文案 key（`scripts/check-commentary.mjs` 仍用下面的中文常量）。 */
export const LAYER_MESSAGE_KEY: Record<CommentaryLayer, string> = {
  mula: "layer.mula",
  atthakatha: "layer.atthakatha",
  tika: "layer.tika",
  mulatika: "layer.mulatika",
  anutika: "layer.anutika",
};

/** 调试脚本输出用的中文名（不进 UI）。 */
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

interface Coordinate {
  book_name: string;
  cs_para: number;
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
 * 取一行用于跨书对齐的坐标。
 *
 * 标题本身没有义注复注 —— 用标题自己的 `cs_para` 去找“对应章节”没有意义，
 * 而且经常是错的：它常常是上一章结尾遗留的旧值，跟真正的下一章共享同一个值
 * （例子见 `docs/commentary-layers.md` §3）。真正该对齐的是**标题下面第一个
 * 正文段落**的 `(book_name, cs_para)`；正文段落（`level = 100`）本身已经是
 * 对齐用的最小单位，直接用自己的坐标。
 *
 * 标题下面没有可用的正文段落（罕见，如空标题）时返回 `null`：不要退回标题
 * 自己的坐标，那样查出来的“对应章节”没有意义。
 */
export async function chapterCoordinate(
  db: SqlRunner,
  self: TextRow,
): Promise<Coordinate | null> {
  if (self.level <= CHAPTER_MAX_LEVEL) {
    const rows = await db.all<Pick<TextRow, "book_name" | "cs_para">>(
      `SELECT book_name, cs_para FROM pali_text
        WHERE book = ? AND parent = ?
        ORDER BY paragraph LIMIT 1`,
      [self.book, self.paragraph],
    );
    const child = rows[0];
    if (!child || child.book_name === null || child.cs_para === null) return null;
    return { book_name: child.book_name, cs_para: child.cs_para };
  }
  if (self.book_name === null || self.cs_para === null) return null;
  return { book_name: self.book_name, cs_para: self.cs_para };
}

/** 从给定行沿 `parent` 向上找最近的章节行（`level <= 7`）；行本身已是章节行则原样返回。 */
async function climbToChapter(
  db: SqlRunner,
  row: TextRow,
): Promise<TextRow | null> {
  let cur: TextRow | null = row;
  for (let hop = 0; cur && hop < MAX_ANCESTOR_HOPS; hop++) {
    if (cur.level <= CHAPTER_MAX_LEVEL) return cur;
    if (cur.parent === null || cur.parent < 0) return null;
    cur = await getRow(db, cur.book, cur.parent);
  }
  return null;
}

/**
 * 找出给定章节在其他各层文献中的对应章节，按层次序列排序。
 *
 * 不含源章节所在的书。源段落算不出对齐坐标时返回空数组。
 */
export async function findRelatedChapters(
  db: SqlRunner,
  book: number,
  paragraph: number,
): Promise<RelatedChapter[]> {
  const self = await getRow(db, book, paragraph);
  if (!self) return [];
  const coord = await chapterCoordinate(db, self);
  if (!coord) return [];

  // 按坐标匹配的可能是正文段落，不再要求 level <= 7；同坐标下每部书取
  // paragraph 最小的一行，再各自沿 parent 向上收敛到章节行。
  // 先在子查询里定位每部书的最小 paragraph 再回表取整行：
  // 直接对各列取 MIN 会拼出不属于同一行的 level / toc。
  const rows = await db.all<TextRow>(
    `SELECT p.book, p.paragraph, p.level, p.toc, p.parent, p.tags, p.cs_para, p.book_name
       FROM pali_text p
       JOIN (SELECT book, MIN(paragraph) AS paragraph
               FROM pali_text
              WHERE book_name = ? AND cs_para = ? AND book <> ?
              GROUP BY book) g
         ON g.book = p.book AND g.paragraph = p.paragraph
      ORDER BY p.book`,
    [coord.book_name, coord.cs_para, book],
  );

  const out: RelatedChapter[] = [];
  for (const row of rows) {
    const chapterRow = await climbToChapter(db, row);
    if (!chapterRow) continue;
    const resolved = await resolveLayer(db, chapterRow.book, chapterRow.paragraph);
    out.push({
      book: chapterRow.book,
      paragraph: chapterRow.paragraph,
      level: chapterRow.level,
      toc: chapterRow.toc,
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
