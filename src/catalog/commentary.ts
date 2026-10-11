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
export const TAG_TO_LAYER: Record<string, CommentaryLayer> = {
  "mūla": "mula",
  "pāḷi": "mula",
  "aṭṭhakathā": "atthakatha",
  "ṭīkā": "tika",
  "mūlaṭīkā": "mulatika",
  "anuṭīkā": "anutika",
};

/**
 * 一组标签里最具体的层次（序列最靠后的那个）；没有层次标签返回 `null`。
 *
 * 书目 JSON（`book-titles.json`）与 `pali_text.tags` 用的是同一套标签，
 * 所以离线书目也能直接判层，不必查库。
 */
export function layerFromTagList(tags: string[] = []): CommentaryLayer | null {
  let best: CommentaryLayer | null = null;
  let bestRank = -1;
  for (const tag of tags) {
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

// ---------------------------------------------------------------------------
// 段级联动（阅读页三层对读）：标签栏按「作品」定，滚动按「段」对齐。
// 见 `docs/commentary-layers.md` §7。
// ---------------------------------------------------------------------------

/**
 * 段落的对齐坐标：正文段用自己的 `(book_name, cs_para)`；标题行（`level <= 7`）
 * 自己的 `cs_para` 不可靠（§3），改用它后面第一个正文段的坐标。
 */
export async function alignCoordinate(
  db: SqlRunner,
  book: number,
  paragraph: number,
): Promise<{ book_name: string; cs_para: number } | null> {
  const rows = await db.all<{ book_name: string; cs_para: number }>(
    `SELECT book_name, cs_para FROM pali_text
      WHERE book = ? AND paragraph >= ? AND level = 100
        AND book_name IS NOT NULL AND cs_para IS NOT NULL
      ORDER BY paragraph LIMIT 1`,
    [book, paragraph],
  );
  return rows[0] ?? null;
}

/**
 * 在 `targetBook` 里找与坐标对应的正文段：同 `book_name`、`cs_para` 取
 * **不超过**给定值的最大一个（注释书缺这个 `cs_para` 时就停在上一个），
 * 同一 `cs_para` 下取段号最小的那段。一个都没有返回 `null`。
 */
export async function findCounterpartParagraph(
  db: SqlRunner,
  targetBook: number,
  coord: { book_name: string; cs_para: number },
): Promise<number | null> {
  const rows = await db.all<{ paragraph: number }>(
    `SELECT paragraph FROM pali_text
      WHERE book = ? AND book_name = ? AND level = 100
        AND cs_para = (SELECT MAX(cs_para) FROM pali_text
                        WHERE book = ? AND book_name = ? AND level = 100
                          AND cs_para <= ?)
      ORDER BY paragraph LIMIT 1`,
    [targetBook, coord.book_name, targetBook, coord.book_name, coord.cs_para],
  );
  return rows[0]?.paragraph ?? null;
}

export interface WorkLayer {
  layer: CommentaryLayer;
  book: number;
  /** 该书里第一个同 `book_name` 的正文段（没有更好的落点时用它）。 */
  paragraph: number;
}

export interface WorkLayers {
  /**
   * 「作品」的身份：所在 level=1 段 + 当前段的 `book_name`。一个 level=1 作品
   * 可能横跨多个 `book_name`（如书 202 Pācityādiyojanā 含 vin2–vin5），
   * 跨过去要换一套对应书。
   */
  key: string;
  self: CommentaryLayer | null;
  /** 除自己以外，每层选定的一部对应书，按层次序列排序。 */
  others: WorkLayer[];
}

/**
 * 整部作品级的对应书：只看当前作品（level=1）与当前段的 `book_name`，
 * 不看当前段的 `cs_para` —— 某段在义注里缺坐标不会让「义注」这一层消失，
 * 标签栏在整部作品内保持不变。
 *
 * 同层有多部候选（如律藏大品的复注有 202/206/209/210 四部）时：先排除
 * 带 `yojanā` 标签的（逐词释义本，不是正式复注），再取覆盖 `cs_para`
 * 最多的，最后按书号。
 */
export async function findWorkLayers(
  db: SqlRunner,
  book: number,
  paragraph: number,
): Promise<WorkLayers> {
  const [selfLayer, coord, workRows] = await Promise.all([
    resolveLayer(db, book, paragraph),
    alignCoordinate(db, book, paragraph),
    db.all<{ work: number | null }>(
      `SELECT MAX(paragraph) AS work FROM pali_text
        WHERE book = ? AND level = 1 AND paragraph <= ?`,
      [book, paragraph],
    ),
  ]);
  const self = selfLayer?.layer ?? null;
  const work = workRows[0]?.work ?? 0;
  if (!coord) return { key: `${book}:${work}:`, self, others: [] };

  const candidates = await db.all<{ book: number; cov: number; first: number }>(
    `SELECT book, COUNT(DISTINCT cs_para) AS cov, MIN(paragraph) AS first
       FROM pali_text
      WHERE book_name = ? AND level = 100 AND book <> ?
        AND parent >= 0
      GROUP BY book`,
    [coord.book_name, book],
  );

  const scored: (WorkLayer & { cov: number; yojana: boolean })[] = [];
  for (const c of candidates) {
    const resolved = await resolveLayer(db, c.book, c.first);
    if (!resolved || resolved.layer === self) continue;
    const src = await getRow(db, resolved.source.book, resolved.source.paragraph);
    const yojana = (src?.tags ?? "").split(",").some((t) => t.trim() === "yojanā");
    scored.push({ layer: resolved.layer, book: c.book, paragraph: c.first, cov: c.cov, yojana });
  }
  // 书首的书名行（parent = -1）不挂在任何作品下，判不了层，上面已滤掉。
  scored.sort(
    (a, b) =>
      COMMENTARY_LAYERS.indexOf(a.layer) - COMMENTARY_LAYERS.indexOf(b.layer) ||
      Number(a.yojana) - Number(b.yojana) ||
      b.cov - a.cov ||
      a.book - b.book,
  );
  const others: WorkLayer[] = [];
  for (const s of scored) {
    if (others.some((o) => o.layer === s.layer)) continue;
    others.push({ layer: s.layer, book: s.book, paragraph: s.paragraph });
  }
  return { key: `${book}:${work}:${coord.book_name}`, self, others };
}
