/**
 * 三藏章节标题目录（`src/data/tipitaka_heading.json`）。
 *
 * 该文件含全三藏所有书籍与章节标题，每条是 `book + paragraph + level`
 * 组成的树节点。`chapter_len` / `chapter_strlen` 表示该章节「到下一个
 * 同级或更浅层级标题」之间的段落数 / 字符数（即完整章节体量）。
 *
 * 阅读器用它做三件事：
 *   1. 目录抽屉（本书章节树）；
 *   2. 章节切换（上一章 / 下一章）；
 *   3. 找「合适显示单元」——输入章节体量过大时，下沉到第一个子章节，
 *      直到体量小于阈值（见 CHAPTER_STR_LEN_THRESHOLD）。
 */
import headingsJson from "../data/tipitaka_heading.json";

export interface Heading {
  book: number;
  paragraph: number;
  level: number;
  toc: string;
  chapter_len: number;
  chapter_strlen: number;
}

export interface HeadingNode {
  heading: Heading;
  parent: HeadingNode | null;
  children: HeadingNode[];
}

interface BookTree {
  roots: HeadingNode[];
  byParagraph: Map<number, HeadingNode>;
  /** 按 paragraph 升序的节点。 */
  sorted: HeadingNode[];
}

const ALL: Heading[] = headingsJson as Heading[];

/**
 * 阅读单元字符数阈值：章节体量超过该值且存在子章节时，下沉到第一个子章节。
 * 先按常规阅读器设置为 20000（约 7-10 页），后续可调。
 */
export const CHAPTER_STR_LEN_THRESHOLD = 20_000;

let byBook: Map<number, Heading[]> | null = null;
const treeCache = new Map<number, BookTree>();

function indexByBook(): Map<number, Heading[]> {
  if (byBook) return byBook;
  const m = new Map<number, Heading[]>();
  for (const h of ALL) {
    const arr = m.get(h.book);
    if (arr) arr.push(h);
    else m.set(h.book, [h]);
  }
  byBook = m;
  return m;
}

/** 某本书的章节标题（按 paragraph 升序）。 */
export function getBookHeadings(book: number): Heading[] {
  return indexByBook().get(book) ?? [];
}

/** 构建某本书的章节树（结果缓存）。 */
export function getBookTree(book: number): HeadingNode[] {
  return getTree(book).roots;
}

function getTree(book: number): BookTree {
  const cached = treeCache.get(book);
  if (cached) return cached;

  const arr = getBookHeadings(book);
  const roots: HeadingNode[] = [];
  const byParagraph = new Map<number, HeadingNode>();
  const stack: HeadingNode[] = [];

  for (const h of arr) {
    const node: HeadingNode = { heading: h, parent: null, children: [] };
    while (stack.length && stack[stack.length - 1].heading.level >= h.level) {
      stack.pop();
    }
    if (stack.length) {
      node.parent = stack[stack.length - 1];
      node.parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
    byParagraph.set(h.paragraph, node);
  }

  const tree: BookTree = {
    roots,
    byParagraph,
    sorted: arr.map((h) => byParagraph.get(h.paragraph)!),
  };
  treeCache.set(book, tree);
  return tree;
}

/** 按 paragraph 查节点；未精确命中时回退到「不大于该 paragraph 的最近标题」。 */
export function findNode(book: number, paragraph: number): HeadingNode | null {
  const tree = getTree(book);
  const exact = tree.byParagraph.get(paragraph);
  if (exact) return exact;

  const arr = tree.sorted;
  let lo = 0;
  let hi = arr.length - 1;
  let best: HeadingNode | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].heading.paragraph <= paragraph) {
      best = arr[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * 找「合适显示单元」：从输入章节开始，体量超过阈值且存在子章节时
 * 下沉到第一个子章节，直到体量合适或没有子章节。
 */
export function resolveDisplayNode(
  book: number,
  paragraph: number,
): HeadingNode | null {
  let node = findNode(book, paragraph);
  if (!node) return null;
  while (
    node.heading.chapter_strlen > CHAPTER_STR_LEN_THRESHOLD &&
    node.children.length > 0
  ) {
    node = node.children[0];
  }
  return node;
}

/** 下一章：同级兄弟；没有则上溯父级找父级的下一兄弟。 */
export function nextHeading(node: HeadingNode): Heading | null {
  let cur: HeadingNode | null = node;
  while (cur) {
    if (cur.parent) {
      const siblings = cur.parent.children;
      const idx = siblings.indexOf(cur);
      if (idx >= 0 && idx + 1 < siblings.length) {
        return siblings[idx + 1].heading;
      }
      cur = cur.parent;
    } else {
      const roots = getTree(cur.heading.book).roots;
      const idx = roots.indexOf(cur);
      if (idx >= 0 && idx + 1 < roots.length) return roots[idx + 1].heading;
      return null;
    }
  }
  return null;
}

/** 上一章：同级兄弟；没有则返回父级。 */
export function prevHeading(node: HeadingNode): Heading | null {
  let cur: HeadingNode | null = node;
  while (cur) {
    if (cur.parent) {
      const siblings = cur.parent.children;
      const idx = siblings.indexOf(cur);
      if (idx - 1 >= 0) return siblings[idx - 1].heading;
      cur = cur.parent;
    } else {
      const roots = getTree(cur.heading.book).roots;
      const idx = roots.indexOf(cur);
      if (idx - 1 >= 0) return roots[idx - 1].heading;
      return null;
    }
  }
  return null;
}

/** 当前节点的所有祖先 paragraph（用于目录抽屉自动展开父层级）。 */
export function ancestorParagraphs(node: HeadingNode | null): number[] {
  const out: number[] = [];
  let p = node?.parent ?? null;
  while (p) {
    out.push(p.heading.paragraph);
    p = p.parent;
  }
  return out;
}

/** 从根到该节点的标题路径（含自身，按层级升序）。 */
export function headingPath(node: HeadingNode | null): Heading[] {
  const out: Heading[] = [];
  let n = node;
  while (n) {
    out.unshift(n.heading);
    n = n.parent;
  }
  return out;
}

/**
 * 本章节段落的结束边界：下一个「同级或更浅层级」标题的 paragraph。
 * 无则返回 null（表示到书末）。
 */
export function chapterEndParagraph(node: HeadingNode): number | null {
  const arr = getTree(node.heading.book).sorted;
  const start = node.heading.paragraph;
  const level = node.heading.level;

  let lo = 0;
  let hi = arr.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const par = arr[mid].heading.paragraph;
    if (par === start) {
      idx = mid;
      break;
    }
    if (par < start) lo = mid + 1;
    else hi = mid - 1;
  }
  if (idx < 0) idx = lo - 1;

  for (let j = idx + 1; j < arr.length; j++) {
    if (arr[j].heading.level <= level) return arr[j].heading.paragraph;
  }
  return null;
}
