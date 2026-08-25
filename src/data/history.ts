/**
 * 阅读记录（本地存储）。
 *
 * 目前在设备本地用 AsyncStorage 持久化：单键存一个 JSON 数组，按最近阅读时间倒序。
 *
 * TODO(阅读记录): 后续改用 wikipali API 持久化与同步（mint 的 ProgressController /
 * ProgressChapterController，见 DESIGN.md「书架」一节），以支持跨设备同步与真实阅读进度。
 * 届时只需把下面的 loadReadingHistory / saveReadingRecord / clearReadingHistory
 * 换成调用 wikipali 接口，上层（书架「在读」、阅读器）无需改动。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ReadingRecord {
  /** 书 id。 */
  book: number;
  /** 段落（当前显示单元起始段）。 */
  paragraph: number;
  /** 书名（阅读器 route title；无书名时回退 `book-paragraph`）。 */
  title: string;
  /** 当前章节标题（用于副标题展示）。 */
  heading?: string;
  /** 阅读时使用的版本/频道 id。 */
  channelId?: string;
  /** 版本显示名。 */
  channelName?: string;
  /** 最近阅读时间（epoch ms）。 */
  updatedAt: number;
}

const KEY = "@wikipali/reading-history";

/** 最多保留的记录条数，超出后丢弃最旧的。 */
const MAX_RECORDS = 100;

/** 读取全部阅读记录（按最近阅读时间倒序；同一本书只保留最后一次位置）。 */
export async function loadReadingHistory(): Promise<ReadingRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = (parsed as ReadingRecord[]).filter(
      (r) =>
        r &&
        typeof r.book === "number" &&
        typeof r.paragraph === "number" &&
        typeof r.title === "string",
    );

    // 兼容旧数据：同一本书（book）合并为一条，保留 updatedAt 最新（即最后一次位置）。
    const byBook = new Map<number, ReadingRecord>();
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

/**
 * 写入一条阅读记录：同一本书（book）只保留一条（更新为最后一次的位置与版本），
 * 并置顶到列表最前；超过上限则裁剪最旧的。
 */
export async function saveReadingRecord(record: ReadingRecord): Promise<void> {
  const list = await loadReadingHistory();
  const key = String(record.book);
  const rest = list.filter((r) => String(r.book) !== key);
  const next = [{ ...record, updatedAt: Date.now() }, ...rest].slice(
    0,
    MAX_RECORDS,
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

/** 清空阅读记录。 */
export async function clearReadingHistory(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
