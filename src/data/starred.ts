/**
 * 收藏的书（本地存储）。
 *
 * 收藏以「书」为粒度：同一本书只保留一条，再次收藏等于刷新时间并置顶。
 * 展示在书架「收藏」分页（见 `BookshelfScreen`）。与阅读记录（`history.ts`）
 * 分开存 —— 收藏是用户显式加的，阅读记录是自动记的进度。
 *
 * TODO(收藏): 后续可换成 wikipali 的 Collection 接口做跨设备同步，届时
 * 只改这里的 load/save/remove，上层（阅读器「更多」、书架「收藏」）无需改动。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface StarredBook {
  /** 书 id。 */
  book: number;
  /** 收藏时的段落（用于解析作品名与层次 tag）。 */
  paragraph?: number;
  /** 作品名（level=1 toc）。 */
  title: string;
  /** 收藏时用的版本 uid（只存 uid，显示名查 channels 表）。 */
  channelId?: string;
  /** 收藏时间（epoch ms）。 */
  updatedAt: number;
}

const KEY = "@wikipali/starred-books";

/** 最多保留的收藏条数。 */
const MAX_RECORDS = 200;

/** 读取全部收藏（按收藏时间倒序）。 */
export async function loadStarred(): Promise<StarredBook[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = (parsed as StarredBook[]).filter(
      (r) =>
        r &&
        typeof r.book === "number" &&
        typeof r.title === "string",
    );
    const byBook = new Map<number, StarredBook>();
    for (const r of valid) {
      const prev = byBook.get(r.book);
      if (!prev || (r.updatedAt ?? 0) > (prev.updatedAt ?? 0)) {
        byBook.set(r.book, r);
      }
    }
    return [...byBook.values()].sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    );
  } catch {
    return [];
  }
}

/** 收藏一本书：同一本书只保留一条并置顶；超过上限裁剪最旧的。 */
export async function saveStarred(record: StarredBook): Promise<void> {
  const list = await loadStarred();
  const key = String(record.book);
  const rest = list.filter((r) => String(r.book) !== key);
  const next = [{ ...record, updatedAt: Date.now() }, ...rest].slice(
    0,
    MAX_RECORDS,
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

/** 取消收藏一本书。 */
export async function removeStarred(book: number): Promise<void> {
  const list = await loadStarred();
  const next = list.filter((r) => String(r.book) !== String(book));
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

/** 某本书是否已收藏。 */
export async function isStarred(book: number): Promise<boolean> {
  const list = await loadStarred();
  return list.some((r) => String(r.book) === String(book));
}
