/**
 * 三藏目录树类型。对应 mint api-v13 的
 * `public/data/category/default.json`。
 */

/** 目录树节点。`tag` 是自上而下累积的路径标签，用于后续过滤书目/检索。 */
export interface CategoryNode {
  name: string;
  tag: string[];
  children?: CategoryNode[];
}

/** 书目（对应 mint `BookTitle` 表）。 */
export interface BookTitle {
  book: number;
  paragraph: number;
  sn?: number | string;
  title: string; // 巴利 / 主标题
  toc?: string;
  tags?: string[];
  related_name?: string | null;
  language?: string | null;
}

/** 一本书的版本/频道（对应 mint `progress?view=chapter_channels` 的 rows）。 */
export interface ChapterChannel {
  book: number;
  para: number;
  /** 该版本在此段落的内容 uid（后续按版本加载正文用）。 */
  uid: string;
  channel_id: string;
  /** 版本显示名，如 `_System_Pali_VRI_` / `cs6` / `中文翻译`。 */
  name: string;
  /** original | translation | wbw */
  type: string;
  progress: number;
  /** 该版本最近更新时间（ISO 8601 字符串）。 */
  updated_at?: string;
  channel?: { uid: string; name: string; type: string };
}

/** 章节目录条目（对应 mint toc 视图）。 */
export interface TocItem {
  book: number;
  paragraph: number;
  pali_title?: string;
  title?: string;
  level?: number;
}

/** 阅读器正文（对应 mint ChapterContent）。 */
export interface ChapterContent {
  uid?: string;
  title: string;
  path?: string[];
  sub_title?: string;
  content: string; // HTML
  content_type?: "html" | string;
  toc?: TocItem[];
  lang?: string;
}

/**
 * 通过「书-段落_频道」从 `api/v3/search/tipitaka_chapter_<book>-<para>_<channel>`
 * 拉取的章节正文。`display` 是阅读模式 HTML（`original → para-block → sentence` 结构），
 * `content` 是纯文本（搜索/复制用）。
 */
export interface TipitakaChapter {
  id: string;
  resId?: string;
  score?: number;
  title: string;
  content: string;
  display: string;
  path?: string;
  category?: string[];
  tags?: string[];
  highlight?: string;
  updated?: string;
  type?: string;
  language?: string;
}
