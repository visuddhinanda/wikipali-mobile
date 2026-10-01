# 阅读设置面板设计（Reader Settings Panel）

> 本文从 [`reader.md`](./reader.md)「阅读器形态总览」中拆出，聚焦**阅读页设置面板**的优化设计。
> 现状代码：面板 UI 在 `src/screens/ReaderScreen.tsx`（`SettingsSheet` / `FontScale` / `PaliScriptPicker`），
> 设置项与持久化在 `src/settings/reader.ts`，正文排版样式在 `src/screens/ReaderLayerPane.tsx`（WebView HTML/CSS）。
> 配套可视化原型：`docs/reader-settings-preview.html`（自包含单文件，浏览器直接打开即可交互预览）。

---

## 1. 目标

1. **高频优先、两级结构**：阅读页只放一个 5 行的快速面板（亮度 / 字号 / 背景 / 注释 / 更多设置），低频项收进「更多设置」完整页。
2. **即调即看**：快速面板用半透明底部抽屉，正文上方仍可见，字号 / 背景 / 亮度改动即时反馈。
3. **补齐高频能力**：亮度、背景预设（多色块）等阅读 App 通行能力，当前面板缺失。
4. **联动正确**：注释「收起行数」仅在「段后」模式有意义，避免无效选项。

---

## 2. 现状盘点

面板入口：阅读器底部工具栏「设置」图标（`settings-outline`）→ `setSettingsVisible(true)`。
当前 `SettingsSheet` 是一个全屏 `Modal`（`animationType="fade"`，点击遮罩关闭），六组控件依次排开：

| 现有项 | 控件形态 | 问题 |
|---|---|---|
| 字号 | 4 档滑块（11/13/16/19） | 档位偏少、档位无字，无 A−/A+ 精细调节 |
| 主题 | 浅 / 深 两粒文字胶囊 | 仅两档，无护眼中间色 |
| 屏幕常亮 | 开 / 关 两粒胶囊 | 开关语义用胶囊表达，别扭 |
| 巴利字体 | 跟随语言 + 若干文字胶囊 | 选项多，窄屏易换行拥挤 |
| 注释收起行数 | 1/2/3/5 胶囊 | 与「呈现方式」割裂，行内模式下无意义 |
| 注释呈现方式 | 行内 / 段后 胶囊 | 同上，应并入「注释」一组 |

数据模型 `src/settings/reader.ts` 当前只有 6 项：

```ts
theme / fontSize / paliScript / annotationCollapsedLines / annotationMode / keepAwake
```

正文排版目前是硬编码或未开放：

- `ReaderLayerPane.tsx` 正文 `line-height: 1.95`（注释区 1.6）写死。
- `contentWidth` 传的是当前窗格宽度（`readerWidth`），不是用户偏好——页边距尚未暴露。
- `package.json` **未装 `expo-brightness`**，亮度需要新增原生依赖。

---

## 3. 同类产品调研结论

综合 [微信读书「背景与字体」帮助](https://weread.qq.com/wrpage/app/help/detail/qReadingBgAndFront)、
[起点读书阅读设置](https://jingyan.baidu.com/article/fdbd4277bace15f99f3f4802.html)、
[Amazon Kindle 无障碍阅读选项](https://www.amazon.es/-/en/gp/help/customer/display.html?nodeId=TABlJ4ot69emTO8jJG)
的通行做法，共性如下：

1. **入口在工具栏、面板是底部抽屉**（微信读书底部「目录/进度/背景/字体」四个按钮）。本项目入口位置已对齐，但用的是全屏 Modal 遮罩，正文反馈被完全盖住。
2. **「背景色」与「字体字号」是两个独立高频入口**，背景用**色块 swatch**（纸白/米黄/护眼/浅灰/夜间多预设），而非文字胶囊。
3. **字号普遍「A− / A+」连续缩放 + 实时预览**，而非离散档位。
4. **亮度滑杆 + 跟随系统**几乎必带。
5. **排版类（行距 / 字距 / 阅读区域）**单独成组（起点读书：行距 / 字距 / 阅读区域 / 翻页方式）。
6. **设置即所见**：面板顶部或上方留出正文预览，调字号/行距/背景即时看到变化。

---

## 4. 目标设计

### 4.1 两级结构

```
阅读页底部抽屉（快速面板，每项一行）
  亮度    ──滑杆──  [跟随系统]
  字号    A−  15  A+
  背景    ● ● ● ●          ← 色块，无文字
  注释    [行内] [段后]
  更多设置 ›
        │
        ▼
完整页「更多设置」（可返回阅读）
  巴利字体 / 行距 / 页边距 / 注释收起行数 / 屏幕常亮 / 恢复默认
```

原则：**高频 4 项 + 1 个入口留在快速面板；其余低频项全部进「更多设置」完整页**。

### 4.2 快速面板（阅读页底部抽屉）

每项**一行**，从左到右：标签 + 控件。**字号 / 背景 / 注释三行的互动控件紧跟标签、左对齐**（更多设置行的 `›` 除外，靠右）。

| 行 | 布局 | 说明 |
|---|---|---|
| **亮度** | 标签 · 滑杆 · 「跟随系统」复选框 | 勾选标明状态；**拖动滑杆自动取消勾选** |
| **字号** | 标签 · `A−` · 当前值 · `A+` | 6 档步进（见 §4.4.1） |
| **背景** | 标签 · 色块 ×4（**只色块，无文字**） | 纸白/米黄/浅灰/夜间 |
| **注释** | 标签 · `[行内]` `[段后]` | 呈现方式 |
| **更多设置** | 整行入口 + `›` | 打开完整页 |

容器：半透明底部抽屉（项目已装 `@gorhom/bottom-sheet@5.2.14`，可复用；或轻量手写）。打开时正文上方仍可见，实现「即调即看」。5 行高度固定，**无需滚动**。

### 4.3 更多设置（完整页）

- **完整页面**（push 进入，非抽屉），顶栏「‹ 更多设置」，返回即回到阅读页。
- 内容按组排列、可滚动，底部「恢复默认」。
- 收纳项：

| 项 | 控件 | 说明 |
|---|---|---|
| 巴利字体 | 胶囊：跟随语言 · 罗马 / 罗马 / 僧伽罗 / 缅甸 / 泰 / 高棉 | 现有多选一，迁入本页 |
| 行距 | 胶囊：紧凑 / 标准 / 宽松 | 见 §4.4.5 |
| 页边距 | 胶囊：窄 / 标准 / 宽 | 见 §4.4.6 |
| 注释收起行数 | 胶囊：1 / 2 / 3 / 5 | **仅段后模式生效**，行内模式置灰禁用 |
| 屏幕常亮 | Switch | 见 §4.4.8 |
| 恢复默认 | 按钮 | 一键还原 `DEFAULT_READER_SETTINGS` |

### 4.4 各项规格

#### 4.4.1 字号（快速面板）

- 由 4 档扩为 **6 档**，改为「`A−` / 当前值 / `A+`」步进。
- 档位：`11 / 13 / 15 / 17 / 19 / 21`（保留「13 = 界面标准」的对齐逻辑，`fontSizePx` 同步改）。
- 宗教经典阅读人群年龄偏大，大字号档位是真实需求。

#### 4.4.2 背景（快速面板）

- `light / dark` 二值扩展为 **4 个背景预设**，只显示色块、不加文字：

| 预设 | 色值（示意） | 语义 |
|---|---|---|
| 纸白 | `#f7f3ea` | 现有 light |
| 米黄（护眼） | `#f0e6cf` | 新增 |
| 浅灰 | `#e8e6e1` | 新增 |
| 夜间 | `#211d17` | 现有 dark |

- 深色继续映射 `ReaderTheme="dark"`，米黄/浅灰作为新背景色——**与 `reader.ts` 注释中「全局深色主题后续接入」的策略衔接**，避免两套 dark 打架。
- 巴利经文阅读场景下米黄/护眼色优先级高于浅灰。

#### 4.4.3 亮度（快速面板）

- 「亮度滑杆 + 跟随系统」复选框。
- **跟随系统用勾选标明状态**：勾选后手动滑杆置灰（仍可拖动）；**用户一拖动滑杆，勾选自动取消**并切回手动亮度。
- **实现用 `expo-brightness`（仅 App 内亮度，Kindle 通行做法）**：
  - 手动 → `Brightness.setBrightnessAsync(v)`：只改当前 Activity 的窗口亮度，不碰系统亮度、无需权限。
  - 跟随系统 → `Brightness.restoreSystemBrightnessAsync()`：恢复为跟随系统亮度。
  - 离开阅读页时同样 `restoreSystemBrightnessAsync()`，不把亮度带出阅读器。
  - 依赖：新增原生模块 `expo-brightness@~57.0.1`，需重建 dev client。
- **控件一律用原生、不手写**：滑杆用 `@react-native-community/slider@5.2.0`，勾选用 `expo-checkbox@~57.0.0`
  （不自己用 PanResponder 画滑杆 / View 画勾选框），意图明确、便于维护。

#### 4.4.4 巴利字体（更多设置）

- 保持现有「跟随语言 + 各 script」语义不变（`src/pali/script`），迁入本页。
- 交互从「单行换行胶囊」改为分组网格，窄屏不再换行拥挤（P2）。

#### 4.4.5 行距（更多设置）

- 3 档，映射正文 CSS `line-height`（现硬编码 1.95）：

| 档位 | line-height |
|---|---|
| 紧凑 | 1.7 |
| 标准 | 1.95（现状） |
| 宽松 | 2.2 |

- 注释区行距（现 1.6）同步缩放。

#### 4.4.6 页边距（更多设置）

- 3 档：窄 / 标准 / 宽。
- 现状 `contentWidth` 直接传 `readerWidth`；改为「窗格宽度 − 用户边距」再注入 WebView。把硬编码升级为用户偏好。

#### 4.4.7 注释收起行数（更多设置）

- 1 / 2 / 3 / 5 档；**仅在「段后」呈现方式下可用**，行内模式下置灰禁用。
- 可加「段后注释默认展开」开关（`annotationCollapsedLines` 设大值或独立布尔）。

#### 4.4.8 屏幕常亮（更多设置）

- 用 `Switch`，归入本页「阅读辅助」组。

#### 4.4.9 可选增强（P2）

- 正文字体族（系统/衬线/黑体，针对中文译文与界面，非巴利 script）。
- 横屏方向锁定（双栏阅读横屏更佳）。

---

## 5. 数据模型改动（`src/settings/reader.ts`）

新增/扩展字段（示例方向，实现时定案）：

```ts
export type ReaderBackground = "paper" | "sepia" | "gray" | "dark";
export type ReaderLineHeight = "compact" | "standard" | "loose";
export type ReaderPageMargin = "narrow" | "standard" | "wide";

export interface ReaderSettings {
  theme: ReaderTheme;          // 保留，向后兼容；或与 background 合一
  background: ReaderBackground; // 新增
  fontSize: ReaderFontSize;    // 枚举扩档
  paliScript: PaliScriptPreference;
  brightnessMode: "system" | "app"; // 新增
  brightness: number;               // 新增（0–1，app 模式生效）
  lineHeight: ReaderLineHeight;     // 新增
  pageMargin: ReaderPageMargin;     // 新增
  annotationCollapsedLines: number;
  annotationMode: AnnotationMode;
  keepAwake: boolean;
  // 可选：fontFamily / orientation
}
```

- 每项在 `loadReaderSettings` 补默认值兜底（现有函数已有逐项兜底，扩展后按同模式补）。
- **`theme` 已移除**，由 `background` 取代：旧数据 `theme: "dark"` → `background: "dark"`，其余 → `"paper"`（`loadReaderSettings` 内迁移）。

---

## 6. 分阶段落地

> ✅ P0 已在本会话实现并真机验证（快速面板 5 行、背景色块、更多设置完整页、注释收起行数联动、expo-brightness 亮度、字号扩档 A−/A+、行距/页边距）。

| 阶段 | 内容 | 依赖 |
|---|---|---|
| **P0（高频 + 低风险）** | ① 快速面板 5 行重构（亮度/字号/背景/注释/更多设置）+ 半透明抽屉；② 背景色块扩预设（米黄/浅灰）；③ 「更多设置」完整页 + 导航；④ 注释收起行数联动置灰（行内模式禁用） | 无新依赖 |
| **P1（体验提升）** | ⑤ 字号扩档 + A−/A+；⑥ 亮度（新增 `expo-brightness`）；⑦ 行距 / 页边距（硬编码升级为用户偏好） | `expo-brightness` |
| **P2（锦上添花）** | ⑧ 正文字体族、横屏锁定、巴利字体选择器网格化、恢复默认按钮 | 无 |

---

## 7. i18n 影响

新增文案需按 `CLAUDE.md` 的 i18n 规则落位（按语义归到 `messages.ts / labels.ts / buttons.ts`，并同步 7 个 locale）：

- 入口：`reader.moreSettings`（更多设置）
- 分组标题：`reader.group.display` / `reader.group.typography` / `reader.group.annotation` / `reader.group.assist`
- 背景预设：`reader.background.paper / sepia / gray / dark`
- 亮度：`reader.brightness` / `reader.brightness.followSystem`
- 行距：`reader.lineHeight.compact / standard / loose`
- 页边距：`reader.margin.narrow / standard / wide`
- 恢复默认：`reader.reset`
- 字号档位若有字名（如「标准/特大」），需补 `reader.size.*` 文案

> 与现有一致：`MessageKey` 由 `zh-Hans` 的 messages + labels + buttons 合并推导，缺 key 会在 `tsc` 报错。
