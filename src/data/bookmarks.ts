/**
 * 书签（本地存储）。
 *
 * 书签以「书 + 段落」为粒度：同一本书的同一段只保留一条（再次添加等于刷新），
 * 一本书可以有多个书签。展示在书架「书签」分页（见 `BookshelfScreen`）。
 *
 * TODO(书签): 后续可换成 wikipali 接口做跨设备同步。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface Bookmark {
  /** 书 id。 */
  book: number;
  /** 段落（书签所在位置）。 */
  paragraph: number;
  /** 作品名（level=1 toc）。 */
  title: string;
  /** 当前章节标题（用于副标题展示）。 */
  heading?: string;
  /** 加书签时用的版本 uid。 */
  channelId?: string;
  /** 加书签时间（epoch ms）。 */
  updatedAt: number;
}

const KEY = "@wikipali/bookmarks";

/** 最多保留的书签条数。 */
const MAX_RECORDS = 500;

/** 读取全部书签（按时间倒序）。 */
export async function loadBookmarks(): Promise<Bookmark[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = (parsed as Bookmark[]).filter(
      (r) =>
        r &&
        typeof r.book === "number" &&
        typeof r.paragraph === "number" &&
        typeof r.title === "string",
    );
    const byPos = new Map<string, Bookmark>();
    for (const r of valid) {
      const key = `${r.book}-${r.paragraph}`;
      const prev = byPos.get(key);
      if (!prev || (r.updatedAt ?? 0) > (prev.updatedAt ?? 0)) {
        byPos.set(key, r);
      }
    }
    return [...byPos.values()].sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    );
  } catch {
    return [];
  }
}

/** 加书签：同一（书, 段落）只保留一条并置顶；超过上限裁剪最旧的。 */
export async function saveBookmark(record: Bookmark): Promise<void> {
  const list = await loadBookmarks();
  const key = `${record.book}-${record.paragraph}`;
  const rest = list.filter((r) => `${r.book}-${r.paragraph}` !== key);
  const next = [{ ...record, updatedAt: Date.now() }, ...rest].slice(
    0,
    MAX_RECORDS,
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

/** 删除一个书签。 */
export async function removeBookmark(
  book: number,
  paragraph: number,
): Promise<void> {
  const list = await loadBookmarks();
  const next = list.filter(
    (r) => `${r.book}-${r.paragraph}` !== `${book}-${paragraph}`,
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

/** 某（书, 段落）是否已加书签。 */
export async function isBookmarked(
  book: number,
  paragraph: number,
): Promise<boolean> {
  const list = await loadBookmarks();
  return list.some(
    (r) => `${r.book}-${r.paragraph}` === `${book}-${paragraph}`,
  );
}
