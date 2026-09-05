import type { CategoryNode } from "../catalog";

export type TabParamList = {
  Discover: undefined;
  Bookshelf: undefined;
  AiChat: undefined;
  Tools: undefined;
  Profile: undefined;
};

/**
 * 各 Tab 内部 Stack 的路由表（同一份类型供所有 Tab Stack 复用；
 * 每个 Stack 只注册其中一部分屏幕）。
 */
export type RootStackParamList = {
  Discover: undefined;
  Bookshelf: undefined;
  AiChat: undefined;
  Tools: undefined;
  Profile: undefined;
  CategoryBrowse: {
    node: CategoryNode;
    breadcrumb: string[]; // 从根到当前节点的显示名
  };
  ChapterList: {
    tagPath: string[];
    title: string;
  };
  BookChannels: {
    book: number;
    paragraph: number;
    title: string;
  };
  Reader: {
    book: number;
    paragraph: number;
    title: string;
    /** 版本/频道 id（来自 BookChannels 选择）；缺省时走旧 chapter-content 接口。 */
    channelId?: string;
    /** 版本显示名（如 _System_Pali_VRI_ / 译文），作为副标题。 */
    channelName?: string;
  };
  NewChat:
    | {
        /** 「就此段落提问」带来的段落上下文。 */
        passageRef?: { book: number; paragraph: number; title: string };
        /** 预置的追问文本（进入对话后自动提交一次）。 */
        seedText?: string;
      }
    | undefined;
  Settings: undefined;
  /** 布局调试页（仅 __DEV__ 从「我」进入）。 */
  DebugLayout: undefined;
};
