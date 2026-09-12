/**
 * 工具 → 佛教日历（月视图）。
 *
 * 设计见 `docs/buddhist-calendar.md`。几条主要决定：
 * - **历法是一张卡，不是一排 chip**：五套历法要连着一句出处才说得清楚，
 *   一排 chip 只放得下名字。卡上写当前选的是哪套，点进去挑（屏 5）。
 * - **格内三行**：公历日 · 月相图标（只在四相日出现）· 阴历小字。
 * - **三时刻常驻底卡**，临近两小时内给倒计时 —— 明相与日落是持戒的判据，
 *   「还有多久」比「几点」更要紧。
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { MoonIcon } from "../components/MoonIcon";
import { colors, radius, spacing, type } from "../theme";
import { useT, useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";
import type { RootStackParamList } from "../navigation/types";
import { defaultSystemFor, type CalendarSystem } from "../calendar/lunar";
import { useCalendarSystem, useLunarMonth, usePlace, useSunTimes } from "../calendar/useCalendar";
import {
  daysInMonth,
  deviceTimeZone,
  formatLocalTime,
  makeDayKey,
  toLocalParts,
} from "../calendar/tz";
import {
  PALI_TIME_NAMES,
  PALI_WEEKDAYS,
  WEEKDAY_KEYS,
  dayLabelOf,
  eraLineOf,
} from "../calendar/format";
import { countdownTo } from "../calendar/countdown";
import { SYSTEM_TITLE_KEYS, SYSTEM_DESC_KEYS } from "../calendar/systems";

/** 月份标题按界面语言写（中文「2026年9月」、英文「September 2026」）。 */
function monthTitle(locale: string, year: number, month: number): string {
  try {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(
      new Date(Date.UTC(year, month - 1, 1)),
    );
  } catch {
    return `${year} · ${month}`;
  }
}

export function CalendarScreen() {
  const t = useT();
  const { locale } = useI18n();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const placeState = usePlace();
  const place = placeState.place;

  // 还没定位成功时，日历格子的月相/阴历先按**设备时区**算（这些只需要时区，
  // 不依赖经纬度）；三时刻则一律占位，等定位成功再填真值。
  const timeZone = place?.timeZone ?? deviceTimeZone();

  const today = useMemo(() => toLocalParts(new Date(), timeZone), [timeZone]);
  const [system] = useCalendarSystem(defaultSystemFor(locale));
  const [cursor, setCursor] = useState({ year: today.year, month: today.month });
  const [selected, setSelected] = useState(today.day);

  // 倒计时要每秒重画；只有当天在看时才走这个计时器。
  const [now, setNow] = useState(() => new Date());
  const showingToday =
    cursor.year === today.year && cursor.month === today.month && selected === today.day;
  useEffect(() => {
    if (!showingToday) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [showingToday]);

  const month = useLunarMonth(system, cursor.year, cursor.month, timeZone);
  const selectedKey = makeDayKey(cursor.year, cursor.month, selected);
  const selectedDay = month.get(selectedKey);
  const times = useSunTimes(place, cursor.year, cursor.month, selected);

  const step = (delta: number) => {
    const m = cursor.month + delta;
    const next =
      m < 1
        ? { year: cursor.year - 1, month: 12 }
        : m > 12
          ? { year: cursor.year + 1, month: 1 }
          : { year: cursor.year, month: m };
    setCursor(next);
    setSelected(1);
  };

  const goToday = () => {
    setCursor({ year: today.year, month: today.month });
    setSelected(today.day);
  };

  // 「今天」放在标题栏右侧，任何时候都能一键回来。
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={goToday} hitSlop={8}>
          <Text style={styles.headerAction}>{t("calendar.today")}</Text>
        </Pressable>
      ),
    });
  }, [navigation, t, today.year, today.month, today.day]);

  const leading = new Date(Date.UTC(cursor.year, cursor.month - 1, 1)).getUTCDay();
  const total = daysInMonth(cursor.year, cursor.month);
  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const timeBoxes: { key: MessageKey; pali: string; at: Date | null }[] = [
    { key: "calendar.times.aruna", pali: PALI_TIME_NAMES.aruna, at: times.aruna },
    { key: "calendar.times.noon", pali: PALI_TIME_NAMES.noon, at: times.noon },
    // 第三格是**日落**（−6° 加蒙气差），不是日没（0°）：底卡这三个是律上的判据，
    // 明相与日落必须对称 —— 一个减去蒙气差、一个加回同一份量。
    { key: "calendar.times.duskAdjusted", pali: PALI_TIME_NAMES.dusk, at: times.dusk },
  ];

  return (
    <Screen contentStyle={styles.content}>
      <Pressable
        style={styles.systemCard}
        onPress={() => navigation.navigate("CalendarSystem")}
      >
        <View style={styles.systemText}>
          <Text style={styles.systemName}>{t(SYSTEM_TITLE_KEYS[system])}</Text>
          <Text style={styles.systemDesc} numberOfLines={1}>
            {t(SYSTEM_DESC_KEYS[system])}
          </Text>
          <Text style={styles.systemHint}>{t("calendar.systemHint")}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
      </Pressable>

      <View style={styles.monthBar}>
        <Pressable onPress={() => step(-1)} hitSlop={12}>
          <Text style={styles.arrow}>‹</Text>
        </Pressable>
        <View>
          <Text style={styles.monthTitle}>
            {monthTitle(locale, cursor.year, cursor.month)}
          </Text>
          <Text style={styles.monthSub}>{eraLineOf(selectedDay, t, locale)}</Text>
        </View>
        <Pressable onPress={() => step(1)} hitSlop={12}>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekHeader}>
        {WEEKDAY_KEYS.map((key, i) => (
          <View key={key} style={styles.weekCell}>
            <Text style={styles.weekName}>{t(key)}</Text>
            <Text style={styles.weekPali} numberOfLines={1}>
              {PALI_WEEKDAYS[i]}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={`b${i}`} style={styles.cell} />;
          const lunar = month.get(makeDayKey(cursor.year, cursor.month, day));
          const isToday =
            day === today.day &&
            cursor.month === today.month &&
            cursor.year === today.year;
          return (
            <Pressable key={day} onPress={() => setSelected(day)} style={styles.cell}>
              {/*
                选中框画在**内层**：直接给格子加 borderWidth 会把 1px 的分隔线
                吃掉，下缘看着像断了。这里让边框自己占一个略小的盒子。
              */}
              <View
                style={[
                  styles.cellInner,
                  isToday && styles.cellToday,
                  day === selected && styles.cellSelected,
                ]}
              >
                <Text
                  style={[styles.cellDay, lunar?.isUposatha && styles.cellDayUposatha]}
                >
                  {day}
                </Text>
                {lunar && lunar.phase !== "none" ? (
                  <MoonIcon angle={lunar.phaseAngle} size={15} />
                ) : (
                  <View style={styles.moonSpacer} />
                )}
                <Text style={styles.cellLunar} numberOfLines={1}>
                  {dayLabelOf(lunar, t, locale)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        style={styles.dayCard}
        onPress={() =>
          navigation.navigate("CalendarDay", {
            year: cursor.year,
            month: cursor.month,
            day: selected,
          })
        }
      >
        <View style={styles.dayHead}>
          {selectedDay ? <MoonIcon angle={selectedDay.phaseAngle} size={34} /> : null}
          <View style={styles.dayHeadText}>
            <Text style={styles.dayTitle}>{selectedKey}</Text>
            <Text style={styles.dayLunar}>
              {[eraLineOf(selectedDay, t, locale), dayLabelOf(selectedDay, t, locale)]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          {selectedDay?.isUposatha ? (
            <Text style={styles.tagUposatha}>{t("calendar.uposatha")}</Text>
          ) : null}
          <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
        </View>

        {selectedDay?.festivalKeys.length ? (
          <View style={styles.tagLine}>
            {selectedDay.festivalKeys.map((key) => (
              <Text
                key={key}
                style={[
                  styles.festivalTag,
                  key === "calendar.festival.unVesak" && styles.festivalTagUn,
                ]}
              >
                {t(key)}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.times}>
          {timeBoxes.map(({ key, pali, at }) => {
            const left = showingToday && place ? countdownTo(at, now) : null;
            return (
              <View key={key} style={styles.timeBox}>
                <Text style={styles.timePali} numberOfLines={1}>
                  {pali}
                </Text>
                <Text style={styles.timeLabel}>{t(key)}</Text>
                <Text style={styles.timeValue}>
                  {place ? formatLocalTime(at, place.timeZone) : "-:-:-"}
                </Text>
                {left ? <Text style={styles.timeCountdown}>{left}</Text> : null}
              </View>
            );
          })}
        </View>
      </Pressable>

      <LocationCard />
    </Screen>
  );
}

/**
 * 观察地单独成卡，放在「三时刻」卡片下面。
 *
 * 三种状态一句话说清：定位中给「正在定位中……」，失败给红色「定位失败」，
 * 成功才显示地点与时区。整卡点进位置选择页（右侧 `>` 只是视觉提示）。
 */
function LocationCard() {
  const t = useT();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { place, failed, retrying } = usePlace();

  const icon = failed
    ? "alert-circle"
    : place?.source === "gps"
      ? "location"
      : "location-outline";
  const iconColor = failed ? colors.danger : place ? colors.success : colors.gold;

  const title = place
    ? place.name
    : failed
      ? t("calendar.location.failedMark")
      : retrying
        ? t("calendar.location.retrying")
        : t("calendar.location.locating");
  const sub = place
    ? place.subtitle
      ? `${place.subtitle} · ${place.timeZone}`
      : place.timeZone
    : failed
      ? t("calendar.location.failedMarkHint")
      : t("calendar.location.locatingSub");

  return (
    <Pressable
      style={styles.locationCard}
      onPress={() => navigation.navigate("CalendarLocation")}
    >
      <Ionicons name={icon} size={18} color={iconColor} />
      <View style={styles.locationText}>
        <Text
          style={[styles.locationName, failed && styles.locationNameFailed]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text style={styles.locationSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md, paddingBottom: spacing.xl },
  headerAction: { ...type.body, color: colors.vermilion },
  systemCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  systemText: { flex: 1 },
  systemName: { ...type.body, fontWeight: "700" },
  systemDesc: { ...type.small, color: colors.inkSoft, marginTop: 1 },
  systemHint: { fontSize: 11, color: colors.inkFaint, marginTop: 3 },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  arrow: { fontSize: 24, color: colors.inkFaint, paddingHorizontal: spacing.sm },
  monthTitle: { ...type.heading, textAlign: "center" },
  monthSub: { ...type.small, color: colors.inkFaint, textAlign: "center" },
  weekHeader: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    paddingBottom: 5,
  },
  weekCell: { flex: 1, alignItems: "center" },
  weekName: { fontSize: 11, color: colors.inkFaint },
  weekPali: { fontSize: 8, color: colors.inkFaint, opacity: 0.75, fontStyle: "italic" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    paddingVertical: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  cellInner: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 4,
    paddingBottom: 3,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: radius.sm,
  },
  cellToday: { backgroundColor: colors.paperSunken },
  cellSelected: { borderColor: colors.vermilion },
  cellDay: { fontSize: 14, lineHeight: 17, color: colors.ink, fontVariant: ["tabular-nums"] },
  cellDayUposatha: { color: colors.vermilion, fontWeight: "700" },
  cellLunar: { fontSize: 9, lineHeight: 12, color: colors.inkFaint },
  moonSpacer: { height: 15, width: 15 },
  dayCard: {
    marginTop: spacing.md,
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
  },
  dayHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  dayHeadText: { flex: 1 },
  dayTitle: { ...type.heading },
  dayLunar: { ...type.small, color: colors.inkSoft },
  tagUposatha: {
    ...type.small,
    color: colors.vermilion,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.vermilion,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tagLine: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  festivalTag: {
    ...type.small,
    color: colors.inkSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  festivalTagUn: { color: colors.ochre, borderColor: colors.gold },
  times: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  timeBox: {
    flex: 1,
    backgroundColor: colors.paperSunken,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: 2,
    alignItems: "center",
  },
  timePali: { fontSize: 8.5, color: colors.inkFaint, fontStyle: "italic" },
  timeLabel: { fontSize: 10, color: colors.inkFaint },
  timeValue: { fontSize: 16, color: colors.ink, fontVariant: ["tabular-nums"] },
  timeCountdown: {
    fontSize: 10,
    color: colors.vermilion,
    fontVariant: ["tabular-nums"],
    marginTop: 1,
  },
  locationCard: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
  },
  locationText: { flex: 1, gap: 1 },
  locationName: { ...type.body, color: colors.ink },
  locationNameFailed: { color: colors.danger, fontWeight: "700" },
  locationSub: { ...type.small, color: colors.inkFaint },
});
