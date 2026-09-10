/**
 * 日详情：这一天的太阳，与这一天在五套历法里各自是第几日。
 *
 * 几个刻意的决定：
 * - **先给一张太阳高度图**：三个时刻是几点是一回事，「白昼有多长、正午有多高」
 *   是另一回事，后者一眼看得出来才有用；
 * - **蒙气差摊开写**：明相不是民用曙光的同义词（§2.2）；
 * - **五历并排、Δ 不藏**：各国佛历对同一个满月取日不同是常态，不替用户选一个；
 * - **雨安居进度与最近的节日**：在安居期间「第几天、还剩几天」比日期本身更常被问到。
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { MoonIcon } from "../components/MoonIcon";
import { SunPath } from "../components/SunPath";
import { colors, radius, spacing, type } from "../theme";
import { useI18n, useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";
import type { RootStackParamList } from "../navigation/types";
import {
  CALENDAR_SYSTEMS,
  buildMonth,
  defaultSystemFor,
  isSystemAvailable,
} from "../calendar/lunar";
import { SYSTEM_TITLE_KEYS } from "../calendar/systems";
import { useCalendarSystem, usePlace, useSunTimes } from "../calendar/useCalendar";
import { formatLocalTime, formatOffset, makeDayKey, toLocalParts, zonedNoon } from "../calendar/tz";
import { PALI_TIME_NAMES, dayLabelOf, deltaLabelOf, eraLineOf, phaseLabelOf } from "../calendar/format";
import { nextFestival, vassaProgress } from "../calendar/festivals";

function minutesLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}′${String(s).padStart(2, "0")}″`;
}

/** 当地时刻换成 0-24 的小数，用来在高度图上画标线。 */
function localHour(at: Date | null, timeZone: string): number | null {
  if (!at) return null;
  const p = toLocalParts(at, timeZone);
  return p.hour + p.minute / 60;
}

export function CalendarDayScreen() {
  const t = useT();
  const { locale } = useI18n();
  const route = useRoute<RouteProp<RootStackParamList, "CalendarDay">>();
  const { year, month, day } = route.params;
  const { place } = usePlace();
  const [system] = useCalendarSystem(defaultSystemFor(locale));
  const times = useSunTimes(place, year, month, day);
  const key = makeDayKey(year, month, day);

  const rows = useMemo(
    () =>
      CALENDAR_SYSTEMS.filter(isSystemAvailable).map((s) => ({
        system: s,
        day: buildMonth(s, { year, month, timeZone: place.timeZone }).get(key),
      })),
    [year, month, place.timeZone, key],
  );

  const astro = rows.find((r) => r.system === "astro")?.day;
  const noonAt = zonedNoon(year, month, day, place.timeZone);

  // 雨安居与最近的节日按**当前选的历法**算 —— 各国安居起讫本来就差着日子。
  const vassa = useMemo(
    () => vassaProgress(system, key, place.timeZone),
    [system, key, place.timeZone],
  );
  const upcoming = useMemo(
    () => nextFestival(system, key, place.timeZone),
    [system, key, place.timeZone],
  );

  // 一列时刻必须**按时间先后**排，哪怕明相是从民用曙光倒推出来的：
  // 数字不单调递增，读的人第一反应是算错了。
  const timeRows: { key: MessageKey; pali?: string; at: Date | null; strong?: boolean }[] = [
    { key: "calendar.times.nauticalDawn", at: times.nauticalDawn },
    { key: "calendar.times.aruna", pali: PALI_TIME_NAMES.aruna, at: times.aruna, strong: true },
    { key: "calendar.times.civilDawn", at: times.civilDawn },
    { key: "calendar.times.sunrise", at: times.sunrise },
    { key: "calendar.times.noon", pali: PALI_TIME_NAMES.noon, at: times.noon, strong: true },
    { key: "calendar.times.sunset", pali: PALI_TIME_NAMES.sunset, at: times.sunset, strong: true },
    { key: "calendar.times.dusk", at: times.civilDusk },
    { key: "calendar.times.duskAdjusted", at: times.dusk },
  ];

  const markers = [
    { at: times.aruna, color: colors.vermilion },
    { at: times.noon, color: colors.vermilion },
    { at: times.sunset, color: colors.vermilion },
  ]
    .map(({ at, color }) => ({ hour: localHour(at, place.timeZone), color }))
    .filter((m): m is { hour: number; color: string } => m.hour !== null);

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.card}>
        <SunPath
          place={{ lat: place.lat, lon: place.lon, timeZone: place.timeZone }}
          year={year}
          month={month}
          day={day}
          markers={markers}
        />

        <View style={styles.head}>
          {astro ? <MoonIcon angle={astro.phaseAngle} size={34} /> : null}
          <View style={styles.headText}>
            <Text style={styles.title}>{key}</Text>
            <Text style={styles.sub}>
              {[phaseLabelOf(astro, t), eraLineOf(astro, t, locale)]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        </View>

        <View style={styles.timeList}>
          {timeRows.map(({ key: label, pali, at, strong }) => (
            <View key={label} style={styles.timeRow}>
              <View style={styles.timeLabelBox}>
                {pali ? <Text style={styles.timePali}>{pali}</Text> : null}
                <Text style={styles.timeLabel}>{t(label)}</Text>
              </View>
              <Text style={[styles.timeValue, strong && styles.timeValueStrong]}>
                {formatLocalTime(at, place.timeZone)}
              </Text>
            </View>
          ))}
        </View>

        {times.method === "none" ? (
          <Text style={styles.note}>{t("calendar.polar")}</Text>
        ) : (
          <>
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>{t("calendar.refraction")}</Text>
              <Text style={styles.timeValue}>{minutesLabel(times.refractionMorning)}</Text>
            </View>
            <Text style={styles.note}>{t("calendar.refractionNote")}</Text>
            {times.method === "fallback-altitude" ? (
              <Text style={styles.noteWarn}>{t("calendar.method.fallback")}</Text>
            ) : null}
          </>
        )}

        <Text style={styles.source}>
          {place.name} · {place.lat.toFixed(2)}, {place.lon.toFixed(2)} ·{" "}
          {formatOffset(noonAt, place.timeZone)}
        </Text>
      </View>

      {vassa || upcoming ? (
        <View style={styles.card}>
          {vassa ? (
            <View style={styles.vassaRow}>
              <Text style={styles.vassaText}>
                {t("calendar.vassa.progress", { day: vassa.day, left: vassa.left })}
              </Text>
              <View style={styles.vassaTrack}>
                <View
                  style={[
                    styles.vassaFill,
                    { width: `${Math.round((vassa.day / vassa.total) * 100)}%` },
                  ]}
                />
              </View>
            </View>
          ) : null}
          {upcoming ? (
            <Text style={[styles.vassaText, vassa && styles.upcomingSpaced]}>
              {t(
                upcoming.inDays === 0
                  ? "calendar.nextFestivalToday"
                  : upcoming.inDays === 1
                    ? "calendar.nextFestivalTomorrow"
                    : "calendar.nextFestival",
                { name: t(upcoming.key), n: upcoming.inDays },
              )}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>{t("calendar.compare")}</Text>
      <View style={styles.card}>
        {rows.map(({ system: s, day: lunar }) => (
          <View key={s} style={styles.compareRow}>
            <Text style={styles.compareKey}>{t(SYSTEM_TITLE_KEYS[s])}</Text>
            <Text style={styles.compareValue}>
              {[eraLineOf(lunar, t, locale), dayLabelOf(lunar, t, locale), phaseLabelOf(lunar, t)]
                .filter(Boolean)
                .join(" · ") || "—"}
            </Text>
            <Text style={styles.compareDelta}>{deltaLabelOf(lunar)}</Text>
          </View>
        ))}
        <Text style={styles.note}>{t("calendar.deltaNote")}</Text>
      </View>

      {rows.some((r) => r.day?.festivalKeys.length) ? (
        <View style={styles.tagLine}>
          {[...new Set(rows.flatMap((r) => r.day?.festivalKeys ?? []))].map((f) => (
            <Text
              key={f}
              style={[
                styles.festivalTag,
                f === "calendar.festival.unVesak" && styles.festivalTagUn,
              ]}
            >
              {t(f)}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.note}>{t("calendar.notice.astronomical")}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  headText: { flex: 1 },
  title: { ...type.heading },
  sub: { ...type.small, color: colors.inkSoft },
  timeList: { marginTop: spacing.md },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  timeLabelBox: { flex: 1 },
  timePali: { fontSize: 9, color: colors.inkFaint, fontStyle: "italic" },
  timeLabel: { ...type.small, color: colors.inkSoft },
  timeValue: { fontSize: 15, color: colors.ink, fontVariant: ["tabular-nums"] },
  timeValueStrong: { color: colors.vermilion, fontWeight: "700" },
  note: { ...type.small, color: colors.inkFaint, marginTop: spacing.sm },
  noteWarn: { ...type.small, color: colors.ochre, marginTop: spacing.xs },
  source: { ...type.small, color: colors.inkFaint, marginTop: spacing.md },
  vassaRow: { gap: spacing.sm },
  vassaText: { ...type.small, color: colors.ink },
  upcomingSpaced: { marginTop: spacing.md },
  vassaTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.paperSunken,
    overflow: "hidden",
  },
  vassaFill: { height: 4, backgroundColor: colors.ochre },
  sectionTitle: { ...type.small, color: colors.inkFaint },
  compareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  compareKey: { ...type.small, color: colors.inkFaint, width: 84 },
  compareValue: { ...type.small, color: colors.ink, flex: 1 },
  compareDelta: { ...type.small, color: colors.inkSoft, fontVariant: ["tabular-nums"] },
  tagLine: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
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
});
