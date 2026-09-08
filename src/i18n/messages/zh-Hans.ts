/**
 * 简体中文文案 —— **翻译基准**。
 *
 * 其他语言的文案表以 `Messages` 为类型约束，缺 key 会在 `tsc` 阶段报错，
 * 所以新增文案时先加到这里，再补其他语言。
 *
 * `{name}` 形式的占位符由 `t()` 做插值。
 */
const zhHans = {
  // 导航 / 页面标题
  "nav.discover": "分类",
  "nav.bookshelf": "书架",
  "nav.aiChat": "探索",
  "nav.tools": "工具",
  "nav.profile": "我",
  "nav.catalog": "目录",
  "nav.newChat": "新对话",
  "nav.settings": "设置",
  "nav.signIn": "登录",
  "nav.debugLayout": "布局调试",

  // 通用
  "common.cancel": "取消",
  "common.ok": "知道了",
  "common.loadFailed": "加载失败",
  "ai.unavailableTitle": "AI 功能暂未开放",
  "ai.unavailableBody": "对话服务还没有上线，敬请期待。",
  "common.justNow": "刚刚",
  "common.minutesAgo": "{n}分钟前",
  "common.hoursAgo": "{n}小时前",
  "common.daysAgo": "{n}天前",
  "common.monthsAgo": "{n}个月前",
  "common.yearsAgo": "{n}年前",

  // 分类页
  "discover.searchPlaceholder": "搜索经文、词条…",
  "discover.tipitaka": "巴利三藏",
  "discover.authors": "作者（语文）",
  "discover.channels": "译本合集",
  "channelList.title": "批量下载",
  "channelList.hint": "选择一个译本，把它包含的书整批下载到本地。",
  "channelList.empty": "暂无该语言的译本",
  "channel.books": "包含的书",
  "channel.paraCount": "{n} 段译文",
  "channel.bookCount": "{n} 本书",
  "channel.downloadAll": "全部下载",
  "channel.downloading": "正在下载 {done}/{total}",
  "channel.translated": "已译 {n}%",
  "categoryBrowse.count": " · {n} 项",

  // 章节 / 版本
  "chapterList.empty": "该目录暂无书籍",
  "chapterList.count": "{title} · {n} 篇",
  "channels.empty": "该书暂无可用版本",
  "channels.count": "{title} · {n} 个版本",
  "channels.groupCount": "{n} 个",
  "channels.expandRest": "展开其余 {n} 个",
  "channels.collapse": "收起",
  "channels.expand": "展开",
  "channels.translation": "译文",
  "channels.original": "原文",
  "channels.wbw": "逐词",
  "channels.commentary": "义注",

  // 注释层次
  "layer.mula": "原文",
  "layer.atthakatha": "义注",
  "layer.tika": "复注",
  "layer.mulatika": "根本复注",
  "layer.anutika": "再复注",
  "layer.root": "根本",

  // 书架
  "bookshelf.tab.reading": "在读",
  "bookshelf.tab.downloaded": "已下载",
  "bookshelf.tab.starred": "收藏",
  "bookshelf.empty.reading.title": "还没有阅读记录",
  "bookshelf.empty.reading.sub": "从「分类」进入经文开始阅读，进度会自动出现在这里。",
  "bookshelf.empty.downloaded.title": "暂无下载",
  "bookshelf.empty.downloaded.sub": "下载的经文会出现在这里，可离线阅读。",
  "bookshelf.empty.starred.title": "暂无收藏",
  "bookshelf.empty.starred.sub": "收藏的经文会出现在这里。",

  // 工具
  "tools.dict.title": "字典",
  "tools.dict.desc": "逐词查询 · 最近历史",
  "tools.calendar.title": "佛教日历",
  "tools.calendar.desc": "布萨日 · 结夏安居",
  "tools.transcode.title": "编码转换",
  "tools.transcode.desc": "罗马转写 · 悉昙 · 缅泰文",

  // 探索 / 对话
  "chat.tagline": "与 AI 助手一起探索三藏奥义",
  "chat.newQuestion": "提出一个新问题…",
  "chat.cited": "引用经文",
  "chat.thinking": "思考中…",
  "chat.followUp": "继续追问…",
  "chat.toolRunning": "进行中…",
  "chat.toolDone": "完成",
  "chat.toolStatusDesc": "显示工具调用状态",

  // AI 工具名
  "tool.wikipali_forms": "展开词形",
  "tool.wikipali_search": "检索经文",
  "tool.wikipali_get": "取经文原文",
  "tool.wikipali_dist": "统计出处分布",
  "tool.wikipali_word": "查词典",
  "tool.wikipali_count": "词频统计",
  "tool.wikipali_terms": "查术语",
  "tool.wikipali_books": "分类目录",
  "tool.wikipali_toc": "章节目录",
  "tool.wikipali_paras": "段落清单",
  "tool.wikipali_chapter": "章节体量",
  "tool.wikipali_chapter_fetch": "整章取文",
  "tool.wikipali_versions": "查译本",
  "tool.wikipali_related": "关联段落",
  "tool.wikipali_articles": "文章列表",
  "tool.wikipali_article": "读文章",
  "tool.wikipali_anthology": "文集",

  // 阅读器
  "reader.toc": "目录",
  "reader.prevChapter": "上一章",
  "reader.nextChapter": "下一章",
  "reader.version": "版本",
  "reader.askAboutPassage": "就此段落提问",
  "reader.settings": "阅读设置",
  "reader.fontSize": "字号",
  "reader.theme": "主题",
  "reader.theme.light": "亮色",
  "reader.theme.dark": "深色",
  "reader.switchVersion": "切换版本",
  "reader.noVersions": "暂无可用版本",
  "reader.size.sm": "小",
  "reader.size.md": "标准",
  "reader.size.lg": "大",
  "reader.size.xl": "特大",

  // 我
  "profile.signedOut": "尚未登录",
  "profile.signedOutHint": "登录后同步书架、进度与提问历史",
  "profile.signInOrUp": "登录 / 注册",
  "profile.signedIn": "已登录",
  "profile.signOut": "退出登录",
  "profile.signOutConfirm": "退出后将无法同步书架与提问历史。",
  "profile.signOutAction": "退出",
  "profile.history": "我的提问历史",

  // 登录
  "signIn.username": "用户名 / 邮箱",
  "signIn.usernamePlaceholder": "请输入用户名或邮箱",
  "signIn.password": "密码",
  "signIn.passwordPlaceholder": "请输入密码",
  "signIn.submit": "登录",
  "signIn.failed": "登录失败",
  "signIn.badCredentials": "用户名或密码错误",
  "signIn.expired": "登录状态已失效",
  "signIn.serverHint": "登录服务器可在「我 → 设置 → API 服务器」中切换。",

  // 设置
  "settings.apiServer": "API 服务器",
  "settings.apiServerHint": "选择读取经文数据所用的后端服务器。",
  "settings.envOverride": "当前由 .env 的 EXPO_PUBLIC_API_URL 覆盖：{url}",
  "settings.others": "其他设置",
  "settings.language": "语言偏好",
  "settings.languageHint": "默认跟随手机系统语言。",
  "settings.language.system": "跟随系统",
  "settings.display": "显示设置（字号 / 主题）",
  "settings.downloads": "下载管理",
  "settings.about": "关于 / 反馈",

  // 错误

  // 关于 / 反馈
  "about.version": "版本 {version}",
  "about.section.about": "关于",
  "about.website": "WikiPali 官网",
  "about.sourceCode": "源代码",
  "about.license": "开源许可",
  "about.section.feedback": "反馈",
  "about.sendFeedback": "提交反馈",
  "about.feedbackHint": "告诉我们哪里可以做得更好。",
  "about.feedbackUnset": "反馈地址尚未配置",
  "error.network": "网络请求失败",
  "error.badJson": "响应不是合法 JSON",
  "error.backend": "后端返回错误",
  "error.noOnlineContent": "该版本暂无此章节的在线阅读内容",

  // 离线下载（docs/reading-content.md §4.4）
  "download.section": "离线下载",
  "download.notDownloaded": "未下载",
  "download.downloading": "下载中",
  "download.paused": "已暂停",
  "download.done": "已下载",
  "download.failed": "下载失败",
  "download.start": "下载",
  "download.resume": "继续",
  "download.pause": "暂停",
  "download.delete": "删除",
  "download.deleteConfirm": "删除后将无法离线阅读本书，需重新下载。",
  "download.paraCount": "{done} / {total} 段",
  "download.pickVersionFirst": "请先选择版本，再下载。",

  "scan.title": "扫码",
  "scan.hint": "扫描 WikiPali 网页二维码，直达对应经文",
  "scan.permissionTitle": "需要相机权限",
  "scan.permissionBody": "扫码需要使用相机，请在系统设置里允许。",
  "scan.grant": "允许",
  "scan.unknownTitle": "无法识别",
  "scan.unknownBody": "这不是可以打开的 WikiPali 链接。",
} as const;

export type MessageKey = keyof typeof zhHans;
export type Messages = Record<MessageKey, string>;

export default zhHans;
