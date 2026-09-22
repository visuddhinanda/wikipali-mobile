# 佛教日历（工具 → 佛教日历）设计方案

> 状态：**v0.4（2026-09-10）**，P1–P4 全部实现；五套历法齐备。
> 真机（小米 2304FPN6DC）验过 GPS：定位 → 最近城镇 → 时区 → 三时刻重算整条链路通。
> 代码：`src/calendar/`、`src/screens/Calendar*.tsx`、`src/screens/FlightSunScreen.tsx`；自检 `scripts/check-calendar.mjs`。
> 界面稿（artifact）：<https://claude.ai/code/artifact/f7eac3b7-8ab5-4eba-a4c3-9bb2f0ed08a4>
> 屏 2 日详情的太阳高度图另存了一份本地截图：`docs/images/calendar-day-sunpath-mock.png`
> —— artifact 链接对非成员读不开，实现时对细节只能靠这张图（曲线粗细、五个圆点的
> 实心 / 空心、标签的上下左右错位，都是照它量出来的）。注意稿子是照中纬度地点画的，
> 近赤道的分日曲线本来就接近直线（§2.2）。
> 入口：`src/screens/ToolsScreen.tsx` 中已占位的 `tools.calendar.*` 卡片。

---

## 1. 要做什么

三块彼此独立、共用一套天文内核的功能：

| # | 功能 | 输入 | 输出 |
|---|---|---|---|
| A | **月历** | 年月 + 历法 | 月视图，格内显示月黑 / 上弦 / 满月 / 下弦图标与阴历日名，标出布萨日 |
| B | **日三时** | 选中日期 + 经纬度（定位，失败则城镇名） | 明相 `aruṇuggamana`（民用曙光 − 蒙气差修正）、日中、日落 |
| C | **飞行计算** | 航班号 + 日期 | 起降机场与时刻；沿航线可能遇到的明相 / 日中 / 日落及其发生点 |

阴历推算要求支持 5 套：**天文朔望**、**中国农历**、**缅甸**、**斯里兰卡**、**泰国**。

**为什么要分这么细**：律藏判「日」不是按午夜，而是按**明相出现**（`aruṇuggamana`，天亮到能辨掌纹，天文上取民用曙光 −6° 再补蒙气差，见 §2.2）；「非时食」以**日中**为界。所以这三个时刻不是天气 App 的附赠信息，是持戒的判据 —— 精度要求（分钟级）与呈现方式（要写清楚坐标来源）都由此而来。同理，五国佛历对同一个满月常取不同的公历日，这个分歧本身要显示出来，不能替用户选一个。

---

## 2. 算法选型

### 2.1 天文内核：`astronomy-engine`

**结论：全部天文计算统一用 [`astronomy-engine`](https://www.npmjs.com/package/astronomy-engine)（MIT，纯 TS/JS，零运行时依赖，可在 RN 直接跑）。**

依据：

- 基于 **VSOP87**（行星理论）与 **NOVAS C 3.1**（美国海军天文台新星历软件）两套权威模型，序列被截断到「误差不超过 1 角分」为止；单元测试对 **JPL Horizons / DE405** 逐点比对。这是同类 JS 库里唯一给出明确误差界并有回归测试的。
- 提供本方案需要的全部原语：
  - `SearchMoonPhase(targetLon, startTime, limitDays)` —— 求任意日月黄经差（0° 朔 / 90° 上弦 / 180° 望 / 270° 下弦）的精确时刻；
  - `MoonPhase(time)` —— 任意时刻的相位角，用于**按真相位绘制月相图标**；
  - `SearchRiseSet(body, observer, direction, startTime, limitDays)` —— 日出日落，已含**周日视差、大气折射与太阳视半径**修正（取日面上缘）；
  - `SearchAltitude(body, observer, direction, startTime, limitDays, altitude)` —— 求太阳过任意高度角的时刻，`altitude = -6` 即民用曙光 / 民用暮光，`-6.833` 即补过蒙气差的明相（§2.2）；
  - `SearchHourAngle(body, observer, hourAngle=0, startTime)` —— 太阳过**上中天**，即真正的「日中」（不是日出日落的中点，二者因均时差可差十几分钟）；
  - `Horizon()` / `Equator()` —— 给任意时刻任意坐标求太阳高度角，飞行计算靠它。
- 备选 [`suncalc`](https://github.com/mourner/suncalc) 只有 ~3 KB、同样出自 Meeus 公式，但**没有月相搜索、没有中天搜索、精度无保证**（作者自述对齐 timeanddate.com 量级）。可作为极端包体压力下的降级，不作首选。

参考文献：

- Jean Meeus, *Astronomical Algorithms*, 2nd ed., Willmann-Bell, 1998 —— 第 7 章（儒略日）、第 15 章（升没与晨昏蒙影）、第 25 章（太阳位置）、第 47–49 章（月球位置与朔望）。所有 JS 实现（含 suncalc）的共同源头。
- P. Bretagnon & G. Francou, "Planetary theories in rectangular and spherical variables: VSOP87 solutions", *Astronomy & Astrophysics* 202 (1988), 309–315.
- G. H. Kaplan et al., *User's Guide to NOVAS Version C3.1*, U.S. Naval Observatory, 2011.
- I. Reda & A. Andreas, *Solar Position Algorithm for Solar Radiation Applications*, NREL/TP-560-34302, 2008 —— 若日后要求 ±0.0003° 级太阳位置（本方案用不到，列作上界参考）。

**晨昏定义**取民用曙光 = 太阳几何中心位于地平线下 6°（USNO / 各国天文年历通用定义）。但本 App 输出的**明相时刻要再做一次蒙气差修正**，见 §2.2。

### 2.2 明相（`aruṇuggamana`）、日落（`atthaṅgama`）与蒙气差修正

天文台给的日出时刻**已经含了蒙气差**（大气折射）与日面上缘修正 —— `SearchRiseSet` 取的是太阳几何中心在 −0.833° 时刻，所以日出总比几何地平线相交早几分钟。民用曙光 −6° 却是**纯几何**高度角，没有这份提前量。同一份提前量应当同样加到曙光上：

```
蒙气差 = (民用曙光 − 航海曙光) − (日出 − 民用曙光)
明相   = 民用曙光 − 蒙气差
日落侧对称：蒙气差 = (航海暮光 − 民用暮光) − (民用暮光 − 日没)
           日落   = 民用暮光 + 蒙气差
```

**为什么这个式子成立**：两段名义上都是 6°，但后一段（−6° → 日出）因为日出端含了 0.833° 的折射与半径修正，实际只跨 5.167°。两段时长之差，正好是太阳走完那 0.833° 所需的时间 —— 也就是要补给曙光的量。用**减法**而不是直接换算角度的好处是：它按当日当地的真实太阳升角自动伸缩，纬度、季节、赤纬全部隐含在内，不必自己算太阳周日弧与地平线的夹角。

量级参考：曼德勒（22°N）约 3–4 分钟，赤道最小，高纬度显著变大（实测：Badulla 6.7°N 3.39 分、北京 39.9°N 4.95 分、赫尔辛基 60.2°N 10.75 分）。

**术语要分清**，UI 上是两对而不是三个孤立的词：

| | −12° | −6° 加蒙气差修正 | −6° | 0°（日面上缘切地平） |
|---|---|---|---|---|
| 早 | 航海曙光 `nauticalDawn` | **明相** `aruna` · `aruṇuggamana` | 民用曙光 `civilDawn` | 日出 `sunrise` |
| 晚 | 航海暮光 `nauticalDusk` | **日落** `dusk` · `atthaṅgama` | 民用暮光 `civilDusk` | **日没** `sunset` |

日详情每一行都标出该时刻的**几何**高度角（`sunAltitudeGeometric`），照上表读下来就是
−12.00 / −6.84 / −6.00 / −0.83 / +87.80 / −0.83 / −6.00 / −6.84 / −12.00。

**几何角 vs 视高度，必须分清**：`sunAltitude` 含大气折射（视高度），`sunAltitudeGeometric`
不含。晨昏的所有阈值（−6° / −12° / −6.833°）都是**几何角**定义，拿视高度去比会差
0.5°–0.6°，换算成时间是好几分钟 —— 民用曙光那一刻的视高度是 −5.39° 而不是 −6°。
凡是与阈值比较或标注判据角度的地方一律用几何角。飞行事件（§4.2）判 −6.833° 穿越
原先误用了视高度，已改。

中文一律「曙光 / 暮光」成对，不混用「日暮」；日详情把早晚各四条都列出来（晚间按
时间先后是日没 → 民用暮光 → 日落 → 航海暮光），早上有航海曙光而晚上没有航海暮光，
读的人会以为是漏算了。

律上判日界与非时食用的是**明相 / 日中 / 日落**这三条，月历底卡放的就是它们；日出与日没是天文意义的一对，只在日详情列出。实测高度角：明相 −6.84°（Badulla）～ −7.24°（赫尔辛基）随纬度滑动，日没恒为 −0.831°，日中是上中天（90 − |φ−δ|，不是 90°）。

**边界情况**（必须处理，否则高纬度直接崩）：

- **航海曙光不存在**（太阳整夜不低于 −12°，中高纬度夏季常见）：三段式失效，退回用 −6.833° 搜一次 `SearchAltitude`。

  ⚠️ **两者并不等价**（实测）：

  | 地点 | 减法式 | −6.833° 等效 |
  |---|---|---|
  | 曼德勒 1/15 · 6/21 | 210 s · 290 s | 230 s · 245 s |
  | 科伦坡 6/21 | 233 s | 222 s |
  | 台北 6/21 | 310 s | 254 s |
  | 赫尔辛基 1/15 | 71 s | 475 s |
  | 雷克雅未克 1/15 | **−183 s** | 571 s |

  热带地区两者差几十秒，高纬度完全分道扬镳。**所以主路径是减法式**，−6.833° 只在
  航海曙光不存在时兜底，走了哪条由 `SunTimes.method` 标出（`subtraction` / `fallback-altitude`）。
- **民用曙光或日出不存在**（极昼极夜）：整套无解，走 §3.3 的分支。
- 两段之差算出**负值**：高纬度冬季真的会出现（雷克雅未克 1 月 −183 s），钳到 0，不要把明相推到日出之后。
- 三个晨昏时刻必须**取自同一个早晨**：`sunTimes()` 先求当日上中天，再以它为锚向前后各搜半天。
  按固定 UTC 起点各搜各的，日界附近会各搜到不同的日子，修正量算出来是十几个小时（实现时踩过这个坑）。

**仍要在 UI 写明这是天文近似**：律中明相以肉眼可辨（能辨掌纹、能分辨手上血管颜色）为准，缅、泰部分僧团另有固定偏移的惯例，App 给的是可复现的天文时刻，不替代僧团裁定。

### 2.3 阴历一：天文朔望

直接用 `SearchMoonPhase`：以选中月首为起点，逐个搜出 0/90/180/270 四相时刻，转到**观察地时区**取日期。

- 判定「哪一天是满月日」用**该地日界**（明相到明相），而不是午夜到午夜 —— 与 §2.2 的日界定义保持一致，这是本 App 与普通日历 App 的区别所在。
- 月相图标按 `MoonPhase(当地日中时刻)` 的相位角绘制明暗分界，不是四张固定图。

### 2.4 阴历二：中国农历

规则（现行国标 **GB/T 33661-2017《农历的编算和颁行》**）：

1. 以**东经 120° 标准时**（UTC+8）为准，不随用户所在地变；
2. **定朔**：合朔时刻所在日为初一；
3. **定气**：节气按太阳黄经每 15° 的真时刻；
4. 冬至所在月为十一月；两个冬至之间若有 13 个朔望月，则**第一个不含中气的月**为闰月。

实现两条路：

- **自算**（推荐）：合朔用 `SearchMoonPhase(0, …)`，中气用 `SearchSunLongitude(黄经, …)`，按上述四条规则编排。约 150 行，无额外依赖，与天文内核共用同一套历元，且天然支持任意年份。
- **用库**：[`lunar-javascript`](https://github.com/6tail/lunar-javascript)（MIT，功能极全：干支、节气、佛历、宜忌）。风险是它把一大堆黄历内容一起带进包，且历法差异（各库与香港天文台数据的出入是已知问题）不受我们控制。**倾向自算**，仅拿 `lunar-javascript` 或[香港天文台历书](https://www.hko.gov.hk/tc/gts/time/conversion.htm)当**测试基准**。

参考文献：

- 全国科学技术名词审定委员会 / 紫金山天文台，《农历的编算和颁行》GB/T 33661-2017。
- H. Aslaksen, *The Mathematics of the Chinese Calendar*, National University of Singapore, 2010（英文最完整的规则说明，含闰月置闰的边界案例）。
- E. M. Reingold & N. Dershowitz, *Calendrical Calculations: The Ultimate Edition*, 4th ed., Cambridge University Press, 2018 —— 第 19 章「Chinese Calendar」，附可执行的 Lisp 参考实现。

### 2.5 阴历三：缅甸佛历

**结论：移植 [`yan9a/mmcal`](https://github.com/yan9a/mmcal)（MIT，作者 Yan Naing Aye，C++ 与 JavaScript 双实现）。**

- 缅历是**算术历**（不是实测天文历）：小月 29 天 / 大月 30 天交替，靠 **Metonic 周期**置闰月（*wagataung*）与闰日（*watat*），并按历史上三个不同纪元（Makaranta 前后、Thandeikta）切换常数。这类规则用天文库算不出来，必须照抄历法本身。
- `mmcal` 是缅甸日历 App 生态的事实标准实现（`chanmratekoko/mmcalendar` 等多个实现都基于同一算法），已含：西历 ↔ 缅历互转、**月相（waxing/waning/full/new）**、**布萨日（sabbath / sabbath eve）**、安居与节庆、以及史料校正表。
- 移植方式：取其 JS 版核心（`ceMmDateTime` 的纯函数部分），去掉字符串本地化与 chronicle 数据，转写为 TS 放进 `src/calendar/myanmar/`，保留 MIT 版权头。**不要**引 npm 包 —— 上游未发布官方 npm 包，且带 UI/CLI 代码。

参考文献：

- Yan Naing Aye, *Modern Myanmar Calendrical Calculations*, 2013–（在线文章 <http://cool-emerald.blogspot.com/2013/06/algorithm-program-and-calculation-of.html>，附完整常数表与推导）。
- J. C. Eade, *The Calendrical Systems of Mainland South-East Asia*, Handbook of Oriental Studies 3.9, Brill, 1995 —— 缅、泰、老、柬历法的学术基准，含 *horakhun*、*kammacubala*、*avoman*、*masaken* 等中间量的定义与算例。
- Irwin, A. M. B., *The Burmese & Arakanese Calendars*, Rangoon, 1909（Yan Naing Aye 算法的历史底本）。

### 2.6 阴历四：泰国佛历（Suriyayatra）

- 泰历同属 Surya Siddhanta 系的算术历，与缅历同源而规则不同：平年 354 天，**athikawān**（闰日，第 7 月加 1 天 → 355 天）与 **athikamāt**（闰月，加第二个第 8 月 → 384 天）两套置闰互斥地插入。
- 计算按 Eade 给出的中间量链：`horakhun`（自纪元起的累日）→ `kammacubala` → `masaken`（累月）→ `avoman` / `uccabala`，由此判定当年是 *pakatimāt* / *athikawān* / *athikamāt*，再排月长。
- **实现方式（已改）**：没有维护中的 JS 库，但 Python 的
  [`hmmbug/pythaidate`](https://github.com/hmmbug/pythaidate)（MIT）按 Eade 与 Faraut
  的算式写成且自带回归测试。**移植它的 `LSYear` / `CsDate` 纯计算部分**到
  `src/calendar/lunar/thai.ts`，比照着书自己推一遍靠谱得多。
- **闰日与闰月不能同时出现**（泰历与缅历在这里不同）：撞上了要把闰日挪到前一年或后一年，
  靠新年星期的连续性决定挪哪边 —— `calculateYear0()` 里连看前后各两年就是为了这个。
- **节日在闰月年整体后移一个月**：万佛节走四月、卫塞节走七月、入安居走第二个八月（๘๘），
  出安居仍在十一月。**万佛节要看的是下一个小历年的年型** —— 它落在小历年末尾的月序 1-4，
  而那个闰月属于四月之后才开始的下一年（2026 年万佛节 3/3 在四月、2027 年 2/21 在三月，
  两者的年型正好相反，只按当年判断必错一个）。
- 校验基准：泰国官方公布的节日日期。`scripts/check-calendar.mjs` 里对了 7 个
  （2026 三个 + 2027 两个 + 2028 一个 + 出安居），**全部命中**。

参考文献：

- J. C. Eade, *The Calendrical Systems of Mainland South-East Asia*, Brill, 1995（同上，第 2–4 章给出完整算式）。
- J. C. Eade, *Southeast Asian Ephemeris: Solar and Planetary Positions, A.D. 638–2000*, Cornell SEAP, 1989。
- 泰国皇家学术院与佛教事务局历年公布的佛历日历（作为验收数据，非算法来源）。

### 2.7 阴历五：斯里兰卡 Poya

- 锡兰**不用算术历**，直接用天文满月：满月时刻按**科伦坡时间（UTC+5:30）**取日，采用 **madhyāhna（正午）规则** —— 满月时刻在正午之后，则当日为 Poya；在正午之前，则前一日为 Poya。
- 因此实现只是 `SearchMoonPhase(180, …)` + 一条取日规则，代码量最小。
- 官方 Poya 日由佛教事务部按年公报（gazette）颁布，个别年份会因宗教委员会决议微调；App 显示时应标注「按天文规则推算，以公报为准」。

参考文献：

- Reingold & Dershowitz, *Calendrical Calculations*（同上）中 lunisolar 通用取日规则的形式化。
- Meeus, *Astronomical Algorithms*, ch. 49（朔望时刻）。
- Sri Lanka Department of Buddhist Affairs 历年 Poya 公报（验收数据）。

### 2.8 国际卫塞节（UN Day of Vesak）

**独立于五套历法的一个标识**：按联合国大会第 54/115 号决议，国际卫塞日取**五月第一个月圆日**。

```ts
// 观察地时区的 5 月 1 日 00:00 起，搜第一个望
const t = SearchMoonPhase(180, localMay1, 31);   // 必有解，5 月必含至少一个满月
const isUNVesak = sameLocalDate(t, day);
```

三点要写清楚：

- **它不随 chip 切换**。缅历的 Kason 满月、泰国的 Visakha Bucha、锡兰的 Vesak Poya 是各自历法里的卫塞，闰年（如泰历 athikamāt 年）会落到六月；UN 的定义只认公历五月的第一个望。两者不一致时**同时显示**，标签分别写「国际卫塞节」与该历法自己的节名，不要合并成一个。
- **取日按观察地时区**，与 §2.3 的日界规则一致。UN 总部按纽约时间纪念，个别年份与用户所在地差一日，UI 的说明文字提一句即可。
- 五月必然至少有一个满月（朔望月 29.53 天 < 31 天），所以搜索必有解，无需兜底分支。

节日标识统一走 `LunarDay.festival`，同一天可有多个（数组），UI 按「国际标识 → 本历法节日」排序显示。

### 2.9 雨安居与节日倒计时

`src/calendar/festivals.ts`：把**当前所选历法**一整年的节日扫出来缓存，再回答两个问题。

- **雨安居进度**：起点是**入安居满月的次日**（满月当天是 Āsāḷhā 布萨，安居从第二天算起），
  终点是自恣日当天。不在期间内不显示 —— 各国安居起讫本来就差着日子，所以按所选历法算，
  不按公历月硬套。
- **下一个节日**：只在**一个月以内**才报，远了没有倒计时的意义。同一天有多个节日
  （国际卫塞节 + 本历法的卫塞）时取第一个作代表。

扫一年要建 12 个月、每个月都要搜朔望，所以按 `(历法, 年, 时区)` 缓存，别在渲染里反复算。

### 2.10 各历法一致性

日详情页把五套结果并排显示，并给出与天文朔望的取日差 **Δ**。**Δ≠0 是历法本身的规则差异，不是 bug**，UI 文案必须这么写。这也是最好的自测手段：任何一套实现出错，Δ 会立刻出现异常跳变（正常范围 −1 ~ +1 日）。

### 2.11 布萨日通知

**纯本地，不需要任何后端。** 这一点值得单独写清楚，因为它决定了要不要引入一整套服务端。

布萨日是**算出来的，不是查出来的**：五套历法全是纯算法（真朔望 / 缅历 mmcal / Suriyayatra / 定朔定气），`src/calendar/` 里除 `flight/provider.ts` 之外没有任何 `fetch`。所以离线设备自己就能把布萨日排到任意远的未来。剩下的只是「到点弹个通知」，`expo-notifications` 的本地排程不碰 FCM、不需要 push token、不需要服务器。

**只有三种情况才真需要后端**，都跟「算不出来」有关：人为公告的日期修正（某僧团临时改期）、跨设备同步提醒偏好、给从不打开 App 的人推送。按目前的产品形态都不涉及。

排程规则：每个布萨日两条 —— **前一天 20:00**（`EVENING_HOUR`）与**当天 07:00**（`MORNING_HOUR`），当地时间。

几个约束与对策：

| 约束 | 对策 |
|---|---|
| **iOS 待发本地通知上限 64 条**（系统硬限制，超出即丢） | 只排 `HORIZON = 24` 个布萨日 × 2 = 48 条，约管半年，留了余量；每次启动重排 |
| **Android 13+ 要 `POST_NOTIFICATIONS` 运行时权限** | 由 expo-notifications 的清单自动合入；**只在用户主动打开开关时请求**，绝不在启动时静默弹框 |
| **Android 12+ 精确闹钟要 `SCHEDULE_EXACT_ALARM`** | **不申请**。布萨提醒晚几分钟无所谓，走普通通知；该权限在 Play 上架要额外说明用途 |
| Doze 模式可能延迟投递 | 接受。同上 |
| 设备重启后排程是否保留 | expo-notifications 自带 `RECEIVE_BOOT_COMPLETED` 与 `BOOT_COMPLETED` 接收器，原生层已处理；每次启动无条件重排是兜底 |
| 换时区 / 改历法 / 改界面语言 | 一律**先全部取消再重排**，不逐条对账。文案在排程那一刻就写死（投递时 App 可能没在跑，没法回调现算），所以改语言必须重排 |
| 今天就是布萨日 | 已经过去的时刻不排，否则会立刻弹一条莫名其妙的通知 |

#### 国产 ROM 的省电策略会把提醒推迟数天（真机实测）

**这是本功能最严重的约束，比 iOS 的 64 条上限重要得多。**

小米 2304FPN6DC 真机实测：通知排好之后 `dumpsys alarm` 显示闹钟确实登记了、时刻分毫不差，但最终生效时间被系统改成了**三天后**：

```
tag=*walarm*:expo.modules.notifications.NOTIFICATION_EVENT
origWhen=2026-09-24 20:00:00.000   window=+1h
policyWhenElapsed: requester=+13d10h33m ... power_pending=+16d10h33m
whenElapsed=+16d10h33m            ← 最终按这个发
```

`power_pending` 是 MIUI 自家省电框架加的，**不是 AOSP 的策略**。试过而无效的手段：

| 手段 | 结果 |
|---|---|
| `am set-standby-bucket <pkg> active` | `app_standby` 约束解除，`power_pending` 不变 |
| `dumpsys deviceidle whitelist +<pkg>` | `battery_saver` 约束解除，`power_pending` 不变 |
| `appops set <pkg> AUTO_START allow` | `Unknown operation string` —— 没有这个 op |
| 申请 `SCHEDULE_EXACT_ALARM` | 救不了 `power_pending`；何况我们刻意不申请 |

**结论：代码层面无解，只能引导用户去系统设置里把省电策略改成「无限制」并允许自启动。**

所以设置页在开关打开后会显示一条提示 + 一个跳转按钮（`Linking.openSettings()`，即 `ACTION_APPLICATION_DETAILS_SETTINGS`）。各家 ROM 把这一项藏在不同层级，没法深链到具体那一项，应用详情页是能做到的最近一步。

是否显示按**厂商名单**判断（`src/settings/powerRestriction.ts`，参考 dontkillmyapp.com），不去探测实际限制 —— Android 没有公开 API 能查「我的闹钟会不会被推迟」（`isIgnoringBatteryOptimizations` 只覆盖 AOSP 的 doze，查不到 MIUI 这一层）。名单宁可宽一点：多提示一句的代价，远小于提醒静默失效。

**这个失败模式特别隐蔽**：权限被拒至少是完全没有通知，用户会发现；省电限制是通知照来但迟到几天，用户根本不会归因到这里。

按提示去系统设置改完之后，同一台机器上 `power_pending` 消失，闹钟回到请求时间：

```
policyWhenElapsed: requester=+13d10h27m43s ... power_pending=--
whenElapsed=+13d10h27m43s  maxWhenElapsed=+13d11h27m43s   ← +1h 窗口
```

即：**引导用户改设置是有效的**，这条提示不是聊胜于无。

代码分两层：`uposatha.ts` 是**纯逻辑**（扫布萨日、算出每条通知的时刻与文案），不 import 任何原生模块，所以自检能直接跑它；`notifications.ts` 只管权限、Android 渠道和调用 `expo-notifications`。

默认**关**。通知是打扰，不能装上就自己开。

---

## 3. 位置与时区

### 3.1 定位

`expo-location`（Expo SDK 57，需加进 `app.json` 的 plugins 并新增原生权限 → **要重新出包**）：

```
requestForegroundPermissionsAsync()
  → getLastKnownPositionAsync()   // 先给个即时结果
  → getCurrentPositionAsync({ accuracy: Accuracy.Low })  // 1 km 足够，省电
```

日出日落对定位精度极不敏感：**纬度差 1 km ≈ 时间差 < 5 秒**，所以用 `Accuracy.Low` / `Balanced`，不要 `High`。

### 3.2 定位失败 → 城镇名

不用 `expo-location` 的 `geocodeAsync`（依赖系统服务、需联网、官方文档明确警告「资源消耗大，请求过多会报错」），改**内置离线城镇表**：

- 数据源 **GeoNames `cities15000`**（CC BY 4.0，约 2.4 万个人口 ≥ 15 000 的城镇；若嫌覆盖不足可换 `cities5000`，约 5.5 万条）。字段只保留 `name / asciiname / alternatenames(过滤到本 App 的 8 种界面语言) / lat / lon / country / timezone`。
- 构建期脚本压成紧凑格式（参照 `scripts/gen-script-tables.mjs` 的做法），预计 **1.5–3 MB**；若超出可接受范围，退而只保留南亚/东南亚/东亚 + 各国首都。
- 搜索：前缀 + 子串匹配，罗马转写与本国文字都能命中（`alternatenames` 里有缅文/泰文/僧伽罗文写法）。

**时区**：城镇表自带 IANA 时区名，是首选来源；GPS 定位时用 [`tz-lookup`](https://www.npmjs.com/package/tz-lookup)（~71 KB，同步，压缩过的边界数据，边境处可能偏差）或就近城镇的时区。**不要用手机系统时区** —— 出行时二者常不一致，而所有时刻都必须按观察地时区显示。

### 3.3 极区

高纬度会出现「太阳全天不过 −6.833°」或「全天不落」。`SearchRiseSet` / `SearchAltitude` 此时返回 `null`，UI 显示「极昼 / 极夜 —— 本日无明相」并给出说明，不能显示 `--:--` 了事。

---

## 4. 飞行计算

### 4.1 航班数据

需要的只有：起降机场 IATA 码 + 计划起降时刻（本地时 + UTC 偏移）。候选：

| 服务 | 免费额度 | 说明 |
|---|---|---|
| **AeroDataBox** | Basic 600 units/月 | 面向个人开发者/研究者，按航班号 + 日期查计划与实际时刻，机场坐标齐全。**首选** |
| AviationStack | 100 次/月 | 额度太小，且免费档限 HTTP |
| OpenSky Network | 4 000 credits/日（注册后） | 完全免费、面向研究，但它是**实时 ADS-B 位置**，不是航班时刻表；适合日后做「按真实航迹算」的增强 |

**判据是网络，不是有没有配好服务**：用户不该为了看一眼航班先去设置页填 key。
`lookupFlight()` 联网就查在线实时计划，联不上才退到手填，三种失败分开抛，UI 的说法完全不同：

| 情形 | 抛出 | UI |
|---|---|---|
| 包发不出去 | `OfflineError` | 「当前没有网络，可以手填」+ 自动切到手填 |
| 查得到服务但没这班 | `FlightNotFoundError` | 「核对航班号与日期」，**留在查询模式** |
| 没 key / 额度用尽 / 服务端 5xx | `LookupUnavailableError` | 「服务暂时不可用」+ 自动切到手填 |

连通性探测打的是**本 App 自己的后端**（`resolveBaseUrl()`），不是航班服务商：
后者被墙或被 DNS 污染时，会把「有网但查不了航班」误报成「没网」，用户白等一次手填。
只要有响应就算通，404 也算 —— 要的是「包能出去」。

key 依次取自构建期的 `EXPO_PUBLIC_AERODATABOX_API_KEY`（`.env`，不进仓库）与本地设置。

⚠️ **RapidAPI 的 key 要对每个 API 单独订阅**：账号里有 key 不等于能调 AeroDataBox，
没订阅时返回 `403 You are not subscribed to this API`。到
<https://rapidapi.com/aedbx-aedbx/api/aerodatabox> 点 Subscribe（Basic 免费档 600 units/月）。

**上真机之前先跑 `node scripts/check-flight-api.mjs UL308 2026-09-11`** —— 它照抄了
`lookupFlight()` 的错误分类，结论和真机一致，省掉一轮装包与点屏幕。
**「手填起降机场与时刻」的入口始终在** —— 计算部分完全离线可用。

机场坐标不查 API，用内置的 **OurAirports** 机场表（公有领域，按 IATA 码索引，约 7 000 条大中型机场 < 300 KB）。

### 4.2 沿途太阳事件

1. 起降两点做**大圆（great-circle）球面线性插值**：
   ```
   δ = 中心角;  A = sin((1-f)δ)/sin δ,  B = sin(fδ)/sin δ
   笛卡尔加权求和后归一化 → 该比例处的经纬度
   ```
   （标准 slerp，见 Ed Williams, *Aviation Formulary V1.46*。）
2. 按 f = t/T 把航程切成**每分钟一个采样点**（3 小时航程 = 180 点，纯算术，毫秒级）。
3. 每点用 `astronomy-engine` 的 `Horizon()` 求太阳**几何**高度角 h（`sunAltitudeGeometric`；阈值是几何角，用视高度会差好几分钟，§2.2）。
4. 事件判定：
   - **明相 / 日落**：h 穿越 **−6.833°**（升穿 = 明相，降穿 = 日落；阈值与 §2.2 一致，机上判日界用的是同一个定义），穿越点用二分法细化到秒；
   - **日中**：h 取局部极大值（对飞行中的观察者，「太阳中天」= 高度角极大，不能用地面公式）；
   - 若无穿越，输出「本航程未遇日落」这类**明确结论**，不是空状态。
5. 每个事件同时给出：**事件发生点坐标**、**该点所在时区的当地时刻**、UTC 时刻。途中时区会变，这正是机上算时间最容易出错的地方。

简化与声明：忽略巡航高度带来的地平线下沉（10 km 高空可见日出比地面早约 3 分钟）—— 或者也可以按 `dip = arccos(R/(R+h))` 加进去，成本很低，建议加上并在说明里写清楚。忽略实际航路（绕飞、等待），按计划时刻与大圆航线推算，UI 明示。

参考文献：

- Ed Williams, *Aviation Formulary V1.46*（大圆插值、航向、交点的标准公式集）。
- Meeus, *Astronomical Algorithms*, ch. 13（坐标变换）、ch. 16（插值求极值与过零点）。

---

## 5. 代码结构

```
src/calendar/
  astro.ts            # astronomy-engine 的薄封装：明相(含蒙气差)/日中/日落/月相/朔望
  lunar/
    astronomical.ts   # §2.3
    chinese.ts        # §2.4（自算，GB/T 33661）
    myanmar.ts        # §2.5（移植 mmcal，MIT 版权头）
    thai.ts           # §2.6（移植 pythaidate，MIT）
    srilanka.ts       # §2.7
    index.ts          # 统一接口 LunarDay { phase, dayName, isUposatha, era, delta }
  uposatha.ts         # §2.11 未来的布萨日 + 通知排程的纯逻辑（自检直接跑）
  notifications.ts    # §2.11 权限 / Android 渠道 / expo-notifications 调用
  useUposathaNotifications.ts  # 启动时重排（挂在 App 根，不走 usePlace 免得弹定位框）
  location/
    gps.ts            # expo-location 封装 + 降级
    cities.ts         # 离线城镇表检索
    tz.ts
  flight/
    provider.ts       # FlightProvider 接口 + AeroDataBox 实现 + 手填
    greatcircle.ts
    events.ts         # 沿途太阳事件
src/screens/
  CalendarScreen.tsx        # 屏 1 月历
  CalendarDayScreen.tsx     # 屏 2 日详情
  CalendarLocationScreen.tsx# 屏 3 定位
  FlightSunScreen.tsx       # 屏 4 飞行
  CalendarSystemScreen.tsx  # 屏 5 历法选择
scripts/
  gen-cities-table.mjs      # GeoNames → 紧凑表
  gen-airports-table.mjs    # OurAirports → 紧凑表
  check-calendar.mjs        # 五历 × 20 年 对官方数据回归
```

统一接口，避免每种历法各说各话：

```ts
export type MoonPhaseKind = "new" | "firstQuarter" | "full" | "lastQuarter" | "none";

export interface LunarDay {
  system: "astro" | "chinese" | "myanmar" | "thai" | "srilanka";
  label: string;        // 「上弦十五」「八月十九」「ขึ้น ๑๕ ค่ำ」
  era?: string;         // 「缅历 1388」「BE 2570」「丙午年」
  phase: MoonPhaseKind;
  phaseAngle: number;   // 0–360，用于画真月相
  isUposatha: boolean;
  festivals: string[];  // 国际卫塞节 / 自恣日 / Ok Phansa / Vap Poya；可多个
  deltaDays: number;    // 与天文朔望的取日差
}
```

---

## 6. 组件与依赖

| 需求 | 选择 | 说明 |
|---|---|---|
| 天文计算 | `astronomy-engine`（MIT） | 纯 JS，RN 直用 |
| 月历网格 | **自绘** | 7 列 `View` 网格 60 行代码。第三方日历组件（react-native-calendars 等）不支持格内自定义三行内容与自定义月相图标，改造成本高于自绘 |
| 月相图标 | **自绘 SVG / View** | 圆 + `clip-path` 明暗分界，按 `phaseAngle` 实时生成，不进图片资源 |
| 月份横滑 | `react-native-pager-view`（已有） | 与义注对读同一套做法，相邻月预渲染 |
| 底部详情 | `@gorhom/bottom-sheet`（已有） | |
| 定位 | `expo-location`（新增，**需重出包**） | |
| 时区 | `tz-lookup` 或城镇表自带 | |
| 农历/缅历/泰历 | 自实现 / 移植 | 见 §2 |

### 6.1 常用地点

一个人常算的地点就那么几个（自己的寺院、常去挂单的道场、家人所在的城市），
每次重新搜一遍太笨。位置页顶部放常用地点清单，搜索结果行右侧的 `+` 收藏，
点行本身才是「用这个地点」—— 两件事分开，别让人误收藏。

按 `lat,lon`（三位小数）去重，上限 12 个，存 AsyncStorage。收藏时丢掉 GPS 的
`accuracy`：那是一次性的测量值，存进常用没有意义。

页脚常驻一句「离线城镇表 · 约 3.4 万个城镇（人口 1.5 万以上），随包内置，无网可用」，
数字取自 `CITY_COUNT`，`scripts/check-calendar.mjs` 对着真表校验，改了数据源不会忘记同步。

### 6.2 几条界面约定

| 约定 | 为什么 |
|---|---|
| **历法是一张卡，不是一排 chip** | 五套历法要连着一句出处才说得清楚，一排 chip 只放得下名字。卡上写当前选的是哪套 + 一句出处 + 「点这里换一套历法」，点进去是选择列表（界面稿屏 5） |
| **默认跟随语言，选过就持久化** | 与巴利字体的 `auto` 一个策略。没设置过按 `defaultSystemFor(locale)`，设过存 AsyncStorage，之后不再跟随语言变 |
| **标题栏右侧常驻「今日」** | 翻月份翻远了要能一键回来 |
| **三时刻上方标巴利文** | `aruṇuggamana` / `majjhanhika` / `atthaṅgama`。读经的人按术语认，不按中文认 |
| **临近两小时给倒计时** | `1:32:53`。明相与日落是持戒的判据，「还有多久」比「几点」更要紧；再早显示只会让三个数字互相抢注意力 |
| **详情页时刻按时间先后排** | 哪怕明相是从民用曙光倒推出来的，也要排在它前面 —— 一列数字不单调递增，读的人第一反应是算错了 |
| **选中框画在内层盒子上** | 直接给格子加 `borderWidth` 会把 1px 的分隔线吃掉，下缘看着像断了 |
| **日高度图用 View 画，不引 SVG** | 项目没装 `react-native-svg`，为一张图加原生依赖（还要重新出包）不值得。曲线切成 144 段，每段一个 View 用 rotate 转到该段斜率上 —— 轴对齐的矩形在陡处会露台阶，转过就不会 |

**新增原生依赖只有 `expo-location` 一个**，其余全是 JS。按 [`README.md`](./README.md) §0.3，动了 `app.json` 的原生配置就要 `eas build` 重新出包（或用容器里已装好的本地 Android 工具链）。

---

## 7. 验收与测试

`scripts/check-calendar.mjs`（参照 `scripts/check-script-convert.mjs` 的做法，跑在 Node 里，不进 App 包）：

1. **三时刻**：对 8 个城市（曼德勒、仰光、曼谷、科伦坡、加德满都、台北、悉尼、雷克雅未克）× 全年 365 天，与 USNO / timeanddate 的日出、民用曙光、航海曙光比对，**要求 |Δ| ≤ 1 分钟**；雷克雅未克专测极昼极夜分支。
2. **蒙气差修正**：断言明相夹在航海曙光与民用曙光之间、修正量不为负、热带地区民用曙光到日出 18–32 分钟，并且高纬度确实走到兜底或极昼分支。**不要**去断言减法式与 −6.833° 等价 —— 实测差得很远（§2.2）。
3. **朔望**：与 NASA GSFC 月相目录比对 20 年，要求 |Δ| ≤ 2 分钟。
4. **缅历**：与 mmcal 官方实现逐日比对 1900–2100，**要求零差异**。
5. **农历**：与香港天文台历书比对 1950–2050，零差异。
6. **泰历 / Poya**：与各国官方公布的节日日期比对最近 20 年，允许人工标注的公报微调例外。
7. **卫塞节**：对 1900–2100 逐年断言落在 5 月且是当月第一个望；抽查最近 20 年与联合国公布日期一致（时区差异除外）。
8. **飞行**：构造已知案例（如 12 月的赫尔辛基 → 曼谷，途中必遇日落）做端到端断言。

---

## 8. 分期

| 期 | 内容 | 依赖 |
|---|---|---|
| **P1** | 天文内核 + 天文朔望月历 + 三时刻（含定位与城镇降级） | `astronomy-engine`、`expo-location`、城镇表 |
| **P2** | 缅甸 / 斯里兰卡 / 中国农历 三套历法 + 五历对照 + 历法选择页 | 移植 mmcal、自算农历 |
| **P3** | 泰国 Suriyayatra（工作量最大、参考资料最难拿） | Eade 原书 |
| **P4** | 飞行计算 | AeroDataBox key、机场表 |

P1 已经是一个可用的完整功能，P2 之后才是这个工具区别于普通日历 App 的地方。

### 8.1 实现现状（2026-09-10）

| 期 | 状态 | 说明 |
|---|---|---|
| P1 | ✅ | `astronomy-engine` + 明相/日中/日暮 + 定位与城镇降级（城镇表 34135 条 / 2.0 MB）。**真机 GPS 已验**：Badulla 6.696/81.055 → Asia/Colombo → 明相 05:32 / 日中 12:02 / 日落 18:32，蒙气差 3′24″ |
| P2 | ✅ 五套 | 天文、缅甸（mmcal 移植）、斯里兰卡、中国农历、泰国（pythaidate 移植） |
| — | ✅ | 国际卫塞节（§2.8）跨历法标识 |
| P4 | ✅ | 大圆插值 + 沿途太阳事件 + 手填起降；机场表 4008 条 / 160 KB。在线查询按**网络**判据走（§4.1），**AeroDataBox 仍需自备 key** |
| P3 | ✅ | 泰历 Suriyayatra（移植 pythaidate），对上 2026–2028 全部官方节日日期 |

两处实现时才发现的事，记在这里免得下次重踩：

- **`expo-location` 不能直接 import**。它的模块代理在导入求值时就抛
  「Cannot find native module」，`try { require() }` 抓得住异常，但全局错误处理器仍会
  弹红屏。要先看 `globalThis.expo.modules.ExpoLocation` 在不在，再决定要不要 require
  （`src/calendar/location/gps.ts`）。旧安装包里没有这个原生模块，功能要能优雅降级。
- **观察地与所选历法都放模块级共享状态**，不是各屏 `useState`。位置屏选完城镇要立刻
  反映到月历上；从日详情返回会重挂载，`useState` 的选择会丢。所选历法还要落
  AsyncStorage —— dev 下 Fast Refresh 会重置模块级变量，正式包里则是跨启动记住。
- **历法只输出结构化数据**（`monthNumber` / `dayOfMonth` / `half` / `fortnightDay`），
  文案在 `src/calendar/format.ts` 按界面语言拼。切到泰历是要看泰历的**推算差别**，
  不是把界面换成泰文；Thadingyut、Vap 这类**专名**例外，那是名字不是语言。

---

### 8.1 布萨日通知（P5）

| 期 | 状态 | 内容 |
|---|---|---|
| P5 | ✅ | 布萨日本地通知：前一天 20:00 + 当天 07:00，设置页开关，默认关。纯离线（§2.11），自检 7 条。**真机已验**（小米 2304FPN6DC）：开关打开后排出 48 条，`dumpsys alarm` 显示 `2026-09-24 20:00:00.000` / `09-25 07:00:00.000`，`window=+1h` 非精确闹钟；通知正常弹出 |

## 9. 待定

- **泰历**已按 pythaidate 移植并对上官方节日日期，但只核对了 7 个日期；要更有底气，应拿泰国历年公布的 **wan phra（วันพระ）** 全表比对 20 年。
- **城镇表体积**：`cities15000` 压缩后落在什么量级要实测，超过 3 MB 就要按区域裁剪。
- **AeroDataBox key** 的下发方式：走现有 API 服务器代理（推荐，不暴露 key）还是内置。
- **明相的传统惯例**：缅甸、泰国部分僧团用固定偏移（如日出前 40 分钟）而非天文阈值，是否在 §2.2 的 −6.833° 之外再开一个可调偏移项（默认 0）。
