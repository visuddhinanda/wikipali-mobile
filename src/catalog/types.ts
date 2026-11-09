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

/**
 * 一章的一个版本/频道及其完成度（对应 mint `GET /v3/tipitaka-chapter-channels/{book}/{para}`
 * 的一行）。服务端只列当前用户看得见的频道。
 */
export interface ChapterChannel {
  /** 章节进度行的 uid（列表 key 用）。 */
  id: string;
  book: number;
  para: number;
  /** 0–1 的完成度。 */
  progress: number;
  /** 该版本这一章最近更新时间（ISO 8601 字符串）。 */
  updated_at?: string;
  channel: {
    id: string;
    /** 版本显示名，如 `_System_Pali_VRI_` / `cs6` / `中文翻译`。 */
    name: string;
    /** original | translation | nissaya | commentary … */
    type: string;
    lang: string;
  };
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
