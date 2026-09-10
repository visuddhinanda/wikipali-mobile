/**
 * 日详情：这一天的太阳，与这一天在五套历法里各自是第几日。
 *
 * 两个刻意的决定：
 * - **蒙气差摊开写**：明相不是「民用曙光」的同义词，修正量、走的是减法式还是
 *   角度兜底，都要能看见（`docs/buddhist-calendar.md` §2.2）；
 * - **五历并排，Δ 不藏**：各国佛历对同一个满月取日不同是常态，不替用户选一个。
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { MoonIcon } from "../components/MoonIcon";
import { colors, radius, spacing, type } from "../theme";
import { useI18n, useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";
import type { RootStackParamList } from "../navigation/types";
import { CALENDAR_SYSTEMS, buildMonth, isSystemAvailable, type CalendarSystem } from "../calendar/lunar";
import { usePlace, useSunTimes } from "../calendar/useCalendar";
import { formatLocalTime, formatOffset, makeDayKey, zonedNoon } from "../calendar/tz";
import { dayLabelOf, deltaLabelOf, eraLineOf, phaseLabelOf } from "../calendar/format";

const SYSTEM_KEYS: Record<CalendarSystem, MessageKey> = {
  astro: "calendar.system.astro",
  myanmar: "calendar.system.myanmar",
  srilanka: "calendar.system.srilanka",
  thai: "calendar.system.thai",
  chinese: "calendar.system.chinese",
};

function minutesLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}′${String(s).padStart(2, "0")}″`;
}

export function CalendarDayScreen() {
  const t = useT();
  const { locale } = useI18n();
  const route = useRoute<RouteProp<RootStackParamList, "CalendarDay">>();
  const { year, month, day } = route.params;
  const { place } = usePlace();
  const times = useSunTimes(place, year, month, day);
  const key = makeDayKey(year, month, day);

  const rows = useMemo(
    () =>
      CALENDAR_SYSTEMS.filter(isSystemAvailable).map((system) => ({
        system,
        day: buildMonth(system, { year, month, timeZone: place.timeZone }).get(key),
      })),
    [year, month, place.timeZone, key],
  );

  const astro = rows.find((r) => r.system === "astro")?.day;
  const noonAt = zonedNoon(year, month, day, place.timeZone);

  const timeRows: [MessageKey, Date | null][] = [
    ["calendar.times.nauticalDawn", times.nauticalDawn],
    ["calendar.times.civilDawn", times.civilDawn],
    ["calendar.times.aruna", times.aruna],
    ["calendar.times.sunrise", times.sunrise],
    ["calendar.times.noon", times.noon],
    ["calendar.times.sunset", times.sunset],
    ["calendar.times.dusk", times.dusk],
  ];

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.head}>
          {astro ? <MoonIcon angle={astro.phaseAngle} size={34} /> : null}
          <View style={styles.headText}>
            <Text style={styles.title}>{key}</Text>
            <Text style={styles.sub}>
              {[phaseLabelOf(astro, t), eraLineOf(astro, t, locale)].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </View>

        <View style={styles.timeList}>
          {timeRows.map(([label, value]) => (
            <View key={label} style={styles.timeRow}>
              <Text style={styles.timeLabel}>{t(label)}</Text>
              <Text
                style={[
                  styles.timeValue,
                  label === "calendar.times.aruna" && styles.timeValueStrong,
                ]}
              >
                {formatLocalTime(value, place.timeZone)}
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
              <Text style={styles.timeValue}>
                {minutesLabel(times.refractionMorning)}
              </Text>
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

      <Text style={styles.sectionTitle}>{t("calendar.compare")}</Text>
      <View style={styles.card}>
        {rows.map(({ system, day: lunar }) => (
          <View key={system} style={styles.compareRow}>
            <Text style={styles.compareKey}>{t(SYSTEM_KEYS[system])}</Text>
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
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  headText: { flex: 1 },
  title: { ...type.heading },
  sub: { ...type.small, color: colors.inkSoft },
  timeList: { marginTop: spacing.md },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  timeLabel: { ...type.small, color: colors.inkSoft },
  timeValue: { fontSize: 15, color: colors.ink, fontVariant: ["tabular-nums"] },
  timeValueStrong: { color: colors.vermilion, fontWeight: "700" },
  note: { ...type.small, color: colors.inkFaint, marginTop: spacing.sm },
  noteWarn: { ...type.small, color: colors.ochre, marginTop: spacing.xs },
  source: { ...type.small, color: colors.inkFaint, marginTop: spacing.md },
  sectionTitle: { ...type.small, color: colors.inkFaint, marginTop: spacing.sm },
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
