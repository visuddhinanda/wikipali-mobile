/**
 * 工具 → 佛教日历（月视图）。
 *
 * 设计见 `docs/buddhist-calendar.md` 与界面稿。三条主要决定：
 * - **切历法不切页面**：chip 只换格内的阴历文字与月相，公历骨架不动，读者能
 *   直接看出缅、泰、锡兰对同一个满月的取日差异；
 * - **格内三行**：公历日 · 月相图标（只在四相日出现）· 阴历小字；
 * - **三时刻常驻底卡**：不点进详情也能看到今日明相 / 日中 / 日暮。
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { MoonIcon } from "../components/MoonIcon";
import { colors, radius, spacing, type } from "../theme";
import { useT, useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";
import type { RootStackParamList } from "../navigation/types";
import {
  CALENDAR_SYSTEMS,
  defaultSystemFor,
  isSystemAvailable,
  type CalendarSystem,
} from "../calendar/lunar";
import {
  useCalendarSystem,
  useLunarMonth,
  usePlace,
  useSunTimes,
} from "../calendar/useCalendar";
import { daysInMonth, formatLocalTime, makeDayKey, toLocalParts } from "../calendar/tz";
import {
  PALI_WEEKDAYS,
  WEEKDAY_KEYS,
  dayLabelOf,
  eraLineOf,
} from "../calendar/format";

const SYSTEM_KEYS: Record<CalendarSystem, MessageKey> = {
  astro: "calendar.system.astro",
  myanmar: "calendar.system.myanmar",
  srilanka: "calendar.system.srilanka",
  thai: "calendar.system.thai",
  chinese: "calendar.system.chinese",
};

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
  const place = usePlace();

  const today = useMemo(() => toLocalParts(new Date(), place.place.timeZone), [
    place.place.timeZone,
  ]);
  const [system, setSystem] = useCalendarSystem(defaultSystemFor(locale));
  const [cursor, setCursor] = useState({ year: today.year, month: today.month });
  const [selected, setSelected] = useState(today.day);

  const month = useLunarMonth(
    system,
    cursor.year,
    cursor.month,
    place.place.timeZone,
  );

  const selectedKey = makeDayKey(cursor.year, cursor.month, selected);
  const selectedDay = month.get(selectedKey);
  const times = useSunTimes(place.place, cursor.year, cursor.month, selected);

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

  // 首格是当月 1 号的星期几（周日起排）。
  const leading = new Date(Date.UTC(cursor.year, cursor.month - 1, 1)).getUTCDay();
  const total = daysInMonth(cursor.year, cursor.month);
  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Screen contentStyle={styles.content}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        {CALENDAR_SYSTEMS.map((s) => {
          const available = isSystemAvailable(s);
          const on = s === system;
          return (
            <Pressable
              key={s}
              disabled={!available}
              onPress={() => setSystem(s)}
              style={[styles.chip, on && styles.chipOn, !available && styles.chipOff]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {t(SYSTEM_KEYS[s])}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.monthBar}>
        <Pressable onPress={() => step(-1)} hitSlop={12}>
          <Text style={styles.arrow}>‹</Text>
        </Pressable>
        <Pressable onPress={goToday}>
          <Text style={styles.monthTitle}>{monthTitle(locale, cursor.year, cursor.month)}</Text>
          <Text style={styles.monthSub}>{eraLineOf(selectedDay, t, locale)}</Text>
        </Pressable>
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
            <Pressable
              key={day}
              onPress={() => setSelected(day)}
              style={[
                styles.cell,
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
            <Text style={styles.dayTitle}>
              {cursor.year}-{String(cursor.month).padStart(2, "0")}-
              {String(selected).padStart(2, "0")}
            </Text>
            <Text style={styles.dayLunar}>
              {[eraLineOf(selectedDay, t, locale), dayLabelOf(selectedDay, t, locale)]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          {selectedDay?.isUposatha ? (
            <Text style={styles.tagUposatha}>{t("calendar.uposatha")}</Text>
          ) : null}
          {/* 卡片整块可点进详情，右上角给个 › 说明这一点。 */}
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
          {[
            ["calendar.times.aruna", times.aruna],
            ["calendar.times.noon", times.noon],
            ["calendar.times.dusk", times.dusk],
          ].map(([key, value]) => (
            <View key={key as string} style={styles.timeBox}>
              <Text style={styles.timeLabel}>{t(key as MessageKey)}</Text>
              <Text style={styles.timeValue}>
                {formatLocalTime(value as Date | null, place.place.timeZone)}
              </Text>
            </View>
          ))}
        </View>

        <Pressable
          style={styles.sourceRow}
          onPress={() => navigation.navigate("CalendarLocation")}
        >
          <Ionicons
            name={place.place.source === "gps" ? "location" : "location-outline"}
            size={13}
            color={place.place.source === "gps" ? colors.success : colors.gold}
          />
          <Text style={styles.sourceText} numberOfLines={1}>
            {place.busy
              ? t("calendar.location.searching")
              : `${place.place.name} · ${place.place.timeZone}`}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.inkFaint} />
        </Pressable>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md, paddingBottom: spacing.xl },
  chips: { flexGrow: 0, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.paperRaised,
    marginRight: spacing.sm,
  },
  chipOn: { backgroundColor: colors.vermilion, borderColor: colors.vermilion },
  chipOff: { opacity: 0.4 },
  chipText: { ...type.small, color: colors.inkSoft },
  chipTextOn: { color: colors.paperRaised, fontWeight: "500" },
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
    minHeight: 56,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 5,
    paddingBottom: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  cellToday: { backgroundColor: colors.paperSunken },
  cellSelected: { borderWidth: 2, borderColor: colors.vermilion, borderRadius: radius.sm },
  cellDay: { fontSize: 14, lineHeight: 17, color: colors.ink, fontVariant: ["tabular-nums"] },
  cellDayUposatha: { color: colors.vermilion, fontWeight: "700" },
  moonSpacer: { height: 15, width: 15 },
  cellLunar: { fontSize: 9, lineHeight: 12, color: colors.inkFaint },
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
    alignItems: "center",
  },
  timeLabel: { fontSize: 10, color: colors.inkFaint },
  timeValue: { fontSize: 16, color: colors.ink, fontVariant: ["tabular-nums"] },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  sourceText: { ...type.small, color: colors.inkFaint, flex: 1 },
});
