/**
 * 三藏目录树的本地加载。JSON 直接打包进 bundle，离线可用。
 * 仅使用 default.json（CSCD4 版本的 cscd.json 已移除）。
 * 线上数据源（mint `/api/v2/pali-book-category/{file}`）结构一致，
 * 后续可切换为远程加载。
 */
import { layerFromTagList, type CommentaryLayer } from "./commentary";
import defaultTree from "./default.json";
import bookTitles from "./book-titles.json";
import type { BookTitle, CategoryNode } from "./types";

export type {
  BookTitle,
  CategoryNode,
  ChapterChannel,
  TocItem,
  ChapterContent,
  TipitakaChapter,
} from "./types";

export function getTree(): CategoryNode[] {
  return defaultTree as CategoryNode[];
}

export function isLeaf(node: CategoryNode): boolean {
  return !node.children || node.children.length === 0;
}

/** 内嵌的书籍列表（由 scripts/fetch-book-titles.mjs 从 mint book-title 生成）。 */
export const BOOK_TITLES: BookTitle[] = bookTitles as BookTitle[];

/**
 * 按叶子目录的 `tag` 过滤书籍（集合包含匹配）。
 * 目录 tag 的每个元素都必须出现在书籍 `tags` 里；书籍 `tags` 是扁平集合，
 * 顺序不定，且可能多出 `mūla`/`aṭṭhakathā`/`pāḷi` 等层级标签。
 */
export function getBooksByTags(tags: string[]): BookTitle[] {
  return BOOK_TITLES.filter((b) => {
    const bt = b.tags ?? [];
    return tags.every((t) => bt.includes(t));
  });
}

/** 书名左侧类型徽标的种类；显示名交给 i18n（`layer.*`）。 */
export type BookKind = "root" | "atthakatha" | "tika";

/**
 * 书名左侧的类型徽标：根本（原文）→ 义注（aṭṭhakathā）→ 复注（ṭīkā）。
 * 依 tags 里的分类标签判断；无分类标签的藏外单行本默认「根本」。
 */
export function bookKind(tags: string[] = []): BookKind {
  if (tags.some((t) => t.includes("ṭīkā") || t.includes("dīpanī"))) return "tika";
  if (tags.some((t) => t.includes("aṭṭhakathā"))) return "atthakatha";
  return "root";
}

/**
 * 覆盖某个段落的 level=1 条目。
 *
 * `book` 是一个文件，里面可能装着**多部**作品（281 条 level=1 对 217 个 book，
 * 31 个 book 有不止一条），所以「书名」要按段落落在哪一部里取，不能拿
 * 文件里的第一条充数 —— 那给出的是丛书名。不传 `paragraph` 时退回第一条。
 */
export function bookEntryAt(
  book: number,
  paragraph?: number,
): BookTitle | undefined {
  const inBook = BOOK_TITLES.filter((b) => b.book === book).sort(
    (a, b) => a.paragraph - b.paragraph,
  );
  if (inBook.length === 0) return undefined;
  if (paragraph == null) return inBook[0];
  let found = inBook[0];
  for (const entry of inBook) {
    if (entry.paragraph <= paragraph) found = entry;
    else break;
  }
  return found;
}

/** 某段落所属作品的注释层次（根本/义注/复注/…）；判不出来返回 `null`。 */
export function bookLayerAt(
  book: number,
  paragraph?: number,
): CommentaryLayer | null {
  return layerFromTagList(bookEntryAt(book, paragraph)?.tags ?? []);
}
