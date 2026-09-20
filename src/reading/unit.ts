/**
 * 阅读单元切分算法。
 *
 * 算法说明、实例与全库校验数据见 `docs/reading-content.md` §3。
 * 要点：
 * - 起点固定不动，只有下沉指针在动 —— 父标题与首个子标题之间的正文才不会漏；
 * - 分「核心切分」与「扩展」两层，扩展只能调用不再扩展的核心切分，
 *   否则对兄弟章节的递归会连锁失控（书 42 会一路吞到 66444 字符）。
 *
 * 本模块是纯计算：只依赖 `SqlRunner`（与 `src/catalog/commentary.ts` 同一接口），
 * App 用 expo-sqlite，`scripts/check-reading-unit.mjs` 用 node:sqlite。
 */
import type { SqlRunner } from "../catalog/commentary";

/** `level <= 7` 是章节标题行，`level = 100` 是正文段落行。 */
export const CHAPTER_MAX_LEVEL = 7;

/** 上限：章节体量低于它就停止下沉。 */
export const READING_UNIT_MAX = 5000;

/** 下限：区间字符数低于它就向后扩展兄弟章节。 */
export const READING_UNIT_MIN = 1500;

/**
 * 单元的切分方式，仅用于调试与埋点：
 * - `chapter`      正常下沉到体量合适的章节；
 * - `hardcut`      末层章节仍超阈值，按字符数硬切；
 * - `preamble`     父标题与首个子标题之间的前置正文本身就超阈值，硬切；
 * - `continuation` 起点是正文段（上一单元硬切后的续读位置）。
 */
export type ReadingUnitMode = "chapter" | "hardcut" | "preamble" | "continuation";

export interface ReadingUnit {
  book: number;
  /** 区间起始段（= 用户点击的那一章，不随下沉移动）。 */
  from: number;
  /** 区间结束段（含）。 */
  to: number;
  /** 区间正文字符数。 */
  strlen: number;
  mode: ReadingUnitMode;
  /** 停止下沉时所在的章节行；用于标题显示。`continuation` 时是所属章节。 */
  chapter: ChapterRow | null;
}

export interface ChapterRow {
  paragraph: number;
  level: number;
  toc: string | null;
  chapter_strlen: number;
  parent: number;
}

interface ParaRow {
  paragraph: number;
  length: number | null;
  level: number;
  parent: number;
}

/** 一本书的内存索引：两条查询建一次，之后全在内存里算。 */
interface BookIndex {
  /** 章节行，按 paragraph 升序。 */
  chapters: ChapterRow[];
  /** paragraph → chapters 下标。 */
  chapterAt: Map<number, number>;
  /** paragraph → 行（含正文行）。 */
  rows: Map<number, ParaRow>;
  /** paragraph → 字符数。 */
  len: Map<number, number>;
  /** 父 paragraph → 子章节行（按 paragraph 升序）。 */
  children: Map<number, ChapterRow[]>;
  maxPara: number;
}

const indexCache = new Map<number, Promise<BookIndex | null>>();

/** 清空内存索引（切换数据库或测试时用）。 */
export function clearBookIndexCache(): void {
  indexCache.clear();
}

async function loadBookIndex(
  sql: SqlRunner,
  book: number,
): Promise<BookIndex | null> {
  const chapters = await sql.all<ChapterRow>(
    `SELECT paragraph, level, toc, chapter_strlen, parent
       FROM pali_text WHERE book = ? AND level <= ? ORDER BY paragraph`,
    [book, CHAPTER_MAX_LEVEL],
  );
  const paras = await sql.all<ParaRow>(
    `SELECT paragraph, length, level, parent
       FROM pali_text WHERE book = ? ORDER BY paragraph`,
    [book],
  );
  if (paras.length === 0) return null;

  const children = new Map<number, ChapterRow[]>();
  for (const c of chapters) {
    const arr = children.get(c.parent);
    if (arr) arr.push(c);
    else children.set(c.parent, [c]);
  }

  return {
    chapters,
    chapterAt: new Map(chapters.map((c, i) => [c.paragraph, i])),
    rows: new Map(paras.map((r) => [r.paragraph, r])),
    len: new Map(paras.map((r) => [r.paragraph, r.length ?? 0])),
    children,
    maxPara: paras[paras.length - 1].paragraph,
  };
}

function bookIndex(sql: SqlRunner, book: number): Promise<BookIndex | null> {
  let p = indexCache.get(book);
  if (!p) {
    p = loadBookIndex(sql, book).catch((err) => {
      indexCache.delete(book); // 失败不缓存，下次重试
      throw err;
    });
    indexCache.set(book, p);
  }
  return p;
}

/** 章节 `c` 的结束段：其后第一个 `level <= c.level` 的章节行 − 1；无则到书末。 */
function chapterEnd(idx: BookIndex, c: ChapterRow): number {
  const at = idx.chapterAt.get(c.paragraph);
  if (at === undefined) return idx.maxPara;
  for (let j = at + 1; j < idx.chapters.length; j++) {
    if (idx.chapters[j].level <= c.level) return idx.chapters[j].paragraph - 1;
  }
  return idx.maxPara;
}

function sumLen(idx: BookIndex, from: number, to: number): number {
  let s = 0;
  for (let p = from; p <= to; p++) s += idx.len.get(p) ?? 0;
  return s;
}

/**
 * 按字符数硬切：段落不可再分，所以逐段累加到 `READING_UNIT_MAX`。
 * 剩下的尾巴不足下限就一并吞掉，否则下一单元只剩几十个字符。
 */
function hardCut(
  idx: BookIndex,
  from: number,
  bound: number,
): { to: number; strlen: number } {
  let s = 0;
  let to = from;
  for (let p = from; p <= bound; p++) {
    s += idx.len.get(p) ?? 0;
    to = p;
    if (s >= READING_UNIT_MAX) break;
  }
  if (to < bound) {
    const tail = sumLen(idx, to + 1, bound);
    if (tail < READING_UNIT_MIN) {
      s += tail;
      to = bound;
    }
  }
  return { to, strlen: s };
}

/** 核心切分：下沉 + 硬切，不做「过小则向后扩展」。 */
function coreUnit(
  idx: BookIndex,
  book: number,
  startPara: number,
): ReadingUnit | null {
  const start = idx.rows.get(startPara);
  if (!start) return null;

  // 情形 0：起点是正文段 —— 上一单元硬切后的续读位置，在所属章节内继续硬切
  if (start.level > CHAPTER_MAX_LEVEL) {
    const ownerAt = idx.chapterAt.get(start.parent);
    const owner = ownerAt === undefined ? null : idx.chapters[ownerAt];
    const bound = owner ? chapterEnd(idx, owner) : idx.maxPara;
    const cut = hardCut(idx, startPara, bound);
    return { book, from: startPara, ...cut, mode: "continuation", chapter: owner };
  }

  // 情形 1：沿第一个子章节下沉，直到体量合适或没有子章节
  let cur = idx.chapters[idx.chapterAt.get(startPara)!];
  for (;;) {
    if (cur.chapter_strlen < READING_UNIT_MAX) break;
    const kids = idx.children.get(cur.paragraph);
    if (!kids || kids.length === 0) {
      // 末层章节仍超阈值（如整本书只有一个 level-1 行）→ 按字符硬切
      const cut = hardCut(idx, startPara, chapterEnd(idx, cur));
      return { book, from: startPara, ...cut, mode: "hardcut", chapter: cur };
    }
    cur = kids[0];
  }

  // 情形 2：前置正文（起点标题 ~ 停止章节标题之间）本身就超阈值 → 硬切，不带上停止章节
  if (
    cur.paragraph > startPara &&
    sumLen(idx, startPara, cur.paragraph - 1) >= READING_UNIT_MAX
  ) {
    const startChapter = idx.chapters[idx.chapterAt.get(startPara)!];
    const cut = hardCut(idx, startPara, chapterEnd(idx, startChapter));
    return { book, from: startPara, ...cut, mode: "preamble", chapter: cur };
  }

  const to = chapterEnd(idx, cur);
  return {
    book,
    from: startPara,
    to,
    strlen: sumLen(idx, startPara, to),
    mode: "chapter",
    chapter: cur,
  };
}

/** 扩展步数上限，防御脏数据导致的长循环。 */
const MAX_EXTEND_STEPS = 100;

/** 在内存索引上算一个阅读单元（核心切分 + 过小则向后扩展）。 */
export function readingUnitFromIndex(
  idx: BookIndex,
  book: number,
  startPara: number,
): ReadingUnit | null {
  const u = coreUnit(idx, book, startPara);
  // 硬切类已按字符填满，不需要扩展
  if (!u || u.mode !== "chapter") return u;

  const startChapter = idx.chapters[idx.chapterAt.get(startPara)!];
  // 扩展边界取父章节：起点自身的边界太紧，中途翻页时扩不动，会留下几十字符的单元
  const parentAt = idx.chapterAt.get(startChapter.parent);
  const limit = chapterEnd(idx, parentAt === undefined ? startChapter : idx.chapters[parentAt]);

  let to = u.to;
  for (let n = 0; n < MAX_EXTEND_STEPS; n++) {
    if (sumLen(idx, startPara, to) >= READING_UNIT_MIN || to >= limit) break;
    const nextAt = idx.chapterAt.get(to + 1);
    if (nextAt === undefined) break; // to+1 不是章节行，无法再吞并
    const next = idx.chapters[nextAt];
    const sub = coreUnit(idx, book, next.paragraph); // 关键：核心切分，不再扩展
    const nextTo = Math.min(sub ? sub.to : chapterEnd(idx, next), limit);
    if (nextTo <= to) break;
    to = nextTo;
  }

  return { ...u, to, strlen: sumLen(idx, startPara, to) };
}

/**
 * 算出从 `startPara` 开始的阅读单元。
 *
 * `startPara` 既可以是章节行（用户点目录/书名），也可以是正文段
 * （上一单元硬切后的续读位置）。
 */
export async function readingUnit(
  sql: SqlRunner,
  book: number,
  startPara: number,
): Promise<ReadingUnit | null> {
  const idx = await bookIndex(sql, book);
  if (!idx) return null;
  return readingUnitFromIndex(idx, book, startPara);
}

/** 一本书的阅读起点：第一个 `level = 1` 的章节行，没有则用第一个章节行。 */
export async function firstReadingParagraph(
  sql: SqlRunner,
  book: number,
): Promise<number | null> {
  const idx = await bookIndex(sql, book);
  if (!idx || idx.chapters.length === 0) return null;
  return (
    idx.chapters.find((c) => c.level === 1)?.paragraph ?? idx.chapters[0].paragraph
  );
}

/** 下一个阅读单元：起点 = 当前区间 `to + 1`。到书末返回 null。 */
export async function nextReadingUnit(
  sql: SqlRunner,
  unit: ReadingUnit,
): Promise<ReadingUnit | null> {
  const idx = await bookIndex(sql, unit.book);
  if (!idx || unit.to >= idx.maxPara) return null;
  return readingUnitFromIndex(idx, unit.book, unit.to + 1);
}

/**
 * 上一个阅读单元。
 *
 * 算法是「从起点向后算」的，没有解析解：从书首一路向后翻，找到 `to + 1`
 * 恰好等于当前 `from` 的那个单元。单本单元数在几十到几百之间，且全在内存
 * 索引上算（无 IO），结果按书缓存。
 */
export async function prevReadingUnit(
  sql: SqlRunner,
  unit: ReadingUnit,
): Promise<ReadingUnit | null> {
  const idx = await bookIndex(sql, unit.book);
  if (!idx) return null;
  for (const u of bookUnits(idx, unit.book)) {
    if (u.to + 1 === unit.from) return u;
    if (u.to >= unit.from) break;
  }
  return null;
}

const unitsCache = new Map<number, ReadingUnit[]>();

/** 一本书从头到尾的全部阅读单元（结果缓存）。翻页、下载进度、目录定位共用。 */
function bookUnits(idx: BookIndex, book: number): ReadingUnit[] {
  const cached = unitsCache.get(book);
  if (cached) return cached;

  const out: ReadingUnit[] = [];
  const first =
    idx.chapters.find((c) => c.level === 1)?.paragraph ??
    idx.chapters[0]?.paragraph;
  let p = first;
  // 单本单元数实测最多几百个；上限只为防御脏数据造成死循环
  while (p !== undefined && p <= idx.maxPara && out.length < 100_000) {
    const u = readingUnitFromIndex(idx, book, p);
    if (!u || u.to < p) break;
    out.push(u);
    p = u.to + 1;
  }
  unitsCache.set(book, out);
  return out;
}

/** 一本书从头到尾的全部阅读单元。 */
export async function allReadingUnits(
  sql: SqlRunner,
  book: number,
): Promise<ReadingUnit[]> {
  const idx = await bookIndex(sql, book);
  if (!idx) return [];
  return bookUnits(idx, book);
}

/** 包含指定段落的阅读单元（目录点击、恢复阅读位置时定位用）。 */
export async function readingUnitContaining(
  sql: SqlRunner,
  book: number,
  paragraph: number,
): Promise<ReadingUnit | null> {
  const idx = await bookIndex(sql, book);
  if (!idx) return null;
  // 起点恰好是章节行/续读位置时，直接按算法算，语义与翻页一致
  const direct = readingUnitFromIndex(idx, book, paragraph);
  if (direct) return direct;
  return bookUnits(idx, book).find((u) => u.from <= paragraph && paragraph <= u.to) ?? null;
}

/**
 * 包含指定段落的「章节」阅读单元：始终从书首切分的单元里找。
 *
 * 与 `readingUnitContaining` 的区别：后者对正文段（level=100）会走「续读单元」
 * 分支、把每段正文都算成一个新单元（如 `[475..475]`）；本函数只查书首切分的
 * 章节单元，正文段归到其所属章节。滚动锚点/标题应该跟章节走，用它才能避免
 * 每滚一段就触发一次「换章」。
 */
export async function chapterUnitContaining(
  sql: SqlRunner,
  book: number,
  paragraph: number,
): Promise<ReadingUnit | null> {
  const idx = await bookIndex(sql, book);
  if (!idx) return null;
  return (
    bookUnits(idx, book).find((u) => u.from <= paragraph && paragraph <= u.to) ?? null
  );
}
