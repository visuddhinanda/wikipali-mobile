/**
 * 三藏章节标题目录（`src/data/tipitaka_heading.json`）。
 *
 * 该文件含全三藏所有书籍与章节标题，每条是 `book + paragraph + level`
 * 组成的树节点。`chapter_len` / `chapter_strlen` 表示该章节「到下一个
 * 同级或更浅层级标题」之间的段落数 / 字符数（即完整章节体量）。
 *
 * 这里只负责**目录抽屉**（本书章节树与展开状态）。
 *
 * 阅读单元的切分、上一/下一单元的导航在 `src/reading/unit.ts` —— 它直接查
 * SQLite 的 `pali_text`，因为 JSON 只有标题行、缺 level=100 的正文行，
 * 算不出区间字符数（见 docs/reading-content.md §1.2）。
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
