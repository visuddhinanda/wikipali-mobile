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
    /** 从根到当前节点的显示名（含当前节点），用于面包屑。 */
    breadcrumb: string[];
  };
  BookChannels: {
    book: number;
    paragraph: number;
    title: string;
    /** 从根到当前节点的显示名（含当前节点），用于面包屑。 */
    breadcrumb: string[];
  };
  Reader: {
    book: number;
    /**
     * 起始段。省略时由阅读器自己定位：读过这本书就从上次中断处继续，
     * 没读过就从本书第一个 level-1 章节开始（docs/reading-content.md §5.1）。
     */
    paragraph?: number;
    title: string;
    /** 版本/频道 id（来自 BookChannels 选择）；缺省时自动选第一个可读频道。 */
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
        /** 预填到输入框、等用户自己补完再发的草稿（与 seedText 二选一）。 */
        draftText?: string;
        /**
         * 本次对话的系统提示词。阅读器带着章节坐标进来时用它交代上下文，
         * 让模型知道用户正看着哪一段、哪个版本。
         */
        systemPrompt?: string;
      }
    | undefined;
  Settings: undefined;
  /** 语言选择（设置的下级页）。 */
  LanguageSettings: undefined;
  /** API 服务器选择（设置的下级页）。 */
  ApiServerSettings: undefined;
  /** 关于 / 反馈（设置的下级页）。 */
  About: undefined;
  /** 登录页（从「我」进入）。 */
  SignIn: undefined;
  /** 译本频道列表（书架 → 批量下载）。 */
  ChannelList: undefined;
  /** 译本频道详情：信息 + 该频道下的书列表。 */
  ChannelDetail: {
    uid: string;
    name: string;
    /** `download` 时每本书带下载控件并可整批下载；缺省为浏览。 */
    mode?: "download";
  };
  /** 扫码（从「分类」标题栏进入）。 */
  Scan: undefined;
  /** 编码转换（工具 → 巴利文字体互转）。 */
  ScriptConvertor: undefined;
  /** 佛教日历（工具 → 月视图）。 */
  Calendar: undefined;
  /** 某一天的三时刻与五历对照。 */
  CalendarDay: {
    year: number;
    month: number;
    day: number;
  };
  /** 观察地：定位失败时搜城镇。 */
  CalendarLocation: undefined;
  /** 历法选择（各历法的出处与适用说明）。 */
  CalendarSystem: undefined;
  /** 飞行计算：航班号 → 途中太阳事件。 */
  FlightSun: undefined;
  /** 布局调试页（仅 __DEV__ 从「我」进入）。 */
  DebugLayout: undefined;
};
