/**
 * 义注复注对读：标签栏用哪几层、滚动时各层落到哪一段。
 *
 * 两件事分开算（`docs/commentary-layers.md` §7）：
 * - **层次**按整部作品（level=1 + `book_name`）算一次 —— 某段在义注里缺
 *   `cs_para` 不会让「义注」标签时有时无；
 * - **落点**按段算 —— 视口顶部段的 `(book_name, cs_para)` 在对应书里取不超过
 *   它的最近一个，缺坐标时注释栏就停在上一个 `cs_para`。
 *
 * 只算坐标，不取正文 —— 正文由阅读器在那一层真正显示时才加载。
 */
import {
  COMMENTARY_LAYERS,
  alignCoordinate,
  findCounterpartParagraph,
  findWorkLayers,
  type CommentaryLayer,
} from "../catalog/commentary";
import { tipitakaRunner } from "./db";

/** 对读标签栏的一项：某一层的对应书，以及与当前段对应的落点。 */
export interface LayerChapter {
  layer: CommentaryLayer;
  book: number;
  paragraph: number;
}

export interface ChapterLayers {
  /** 作品身份：变了才需要换标签栏（同一作品内滚动、跨章都不变）。 */
  key: string;
  /** 传入段落自己所属的层；判不出来时为 `null`。 */
  self: CommentaryLayer | null;
  /** 自己 + 各层对应书，按 根本→义注→复注→… 排序，每层一部。 */
  chapters: LayerChapter[];
  /** `chapters` 里传入段落所在的下标；`self` 未知时为 0。 */
  selfIndex: number;
}

/**
 * 建对读标签栏：`(book, paragraph)` 所在作品在各层的对应书，并给每层算出
 * 与 `paragraph` 对应的落点（对应书里一个可对齐的段都没有时退回该书里
 * 第一个同 `book_name` 的正文段）。
 */
export async function getChapterLayers(
  book: number,
  paragraph: number,
): Promise<ChapterLayers> {
  const db = await tipitakaRunner();
  const work = await findWorkLayers(db, book, paragraph);
  const chapters: LayerChapter[] = work.others.map((o) => ({ ...o }));
  if (work.self) chapters.push({ layer: work.self, book, paragraph });
  chapters.sort(
    (a, b) => COMMENTARY_LAYERS.indexOf(a.layer) - COMMENTARY_LAYERS.indexOf(b.layer),
  );
  const selfIndex = work.self
    ? Math.max(0, chapters.findIndex((c) => c.layer === work.self))
    : 0;

  // 落点：自己之后的层顺着链一层带一层（与滚动联动同一规则），自己之前的层
  // 直接对自己。对不上的层保留 `findWorkLayers` 给的书内第一段。
  const after = await getCounterparts(
    book,
    paragraph,
    chapters.slice(selfIndex + 1).map((c) => c.book),
  );
  after.forEach((at, k) => {
    if (at != null) chapters[selfIndex + 1 + k].paragraph = at;
  });
  const coord = await alignCoordinate(db, book, paragraph);
  for (let i = 0; coord && i < selfIndex; i++) {
    const at = await findCounterpartParagraph(db, chapters[i].book, coord);
    if (at != null) chapters[i].paragraph = at;
  }
  return { key: work.key, self: work.self, chapters, selfIndex };
}

/**
 * 层层带动：`(fromBook, paragraph)` 带动 `targetBooks[0]`，它的落点再带动
 * `targetBooks[1]`……（根本→义注→复注）。复注对齐的是义注**实际停下**的那段，
 * 而不是直接对根本 —— 义注缺坐标停在上一个 cs_para 时，复注也跟着停。
 * 某一层一个对应段都没有时，它和后面各层都是 `null`（调用方让它们原地不动）。
 */
export async function getCounterparts(
  fromBook: number,
  paragraph: number,
  targetBooks: number[],
): Promise<(number | null)[]> {
  const db = await tipitakaRunner();
  const out: (number | null)[] = targetBooks.map(() => null);
  let book = fromBook;
  let para = paragraph;
  for (let i = 0; i < targetBooks.length; i++) {
    const coord = await alignCoordinate(db, book, para);
    if (!coord) break;
    const target = await findCounterpartParagraph(db, targetBooks[i], coord);
    if (target == null) break;
    out[i] = target;
    book = targetBooks[i];
    para = target;
  }
  return out;
}
