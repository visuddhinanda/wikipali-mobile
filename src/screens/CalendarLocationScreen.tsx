/**
 * 观察地。
 *
 * 定位失败不是弹一个错误框，而是直接给一个能立刻用起来的城镇搜索：
 * 提示语说明「能做什么」和「误差多大」，不写权限错误码。
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";
import { useI18n, useT } from "../i18n/I18nContext";
import { aliasForLocale, searchCities, type City } from "../calendar/location/cities";
import { placeFromCity } from "../calendar/location/place";
import { usePlace } from "../calendar/useCalendar";

export function CalendarLocationScreen() {
  const t = useT();
  const { locale } = useI18n();
  const navigation = useNavigation();
  const { place, busy, failed, gpsAvailable, locateNow, choose } = usePlace();
  const [query, setQuery] = useState("");

  const results = useMemo<City[]>(
    () => (query.trim().length >= 1 ? searchCities(query, 20) : []),
    [query],
  );

  return (
    <Screen contentStyle={styles.content}>
      {/*
        没定上位就一直摆着，不只是失败那一瞬间：用户手选了城镇之后仍然需要知道
        「现在用的不是 GPS」以及误差有多大。
      */}
      {!gpsAvailable || failed || place.source !== "gps" ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            {gpsAvailable
              ? `${t("calendar.location.failedTitle")}。${t("calendar.location.failedBody")}`
              : t("calendar.location.unavailable")}
          </Text>
        </View>
      ) : null}

      <View style={styles.current}>
        <Ionicons
          name={place.source === "gps" ? "location" : "location-outline"}
          size={14}
          color={place.source === "gps" ? colors.success : colors.gold}
        />
        <Text style={styles.currentText}>
          {place.name} · {place.lat.toFixed(3)}, {place.lon.toFixed(3)}
          {/* GPS 才有水平精度；手选城镇没有，就不占位置。 */}
          {place.accuracy ? ` ±${Math.round(place.accuracy)} m` : ""} · {place.timeZone}
        </Text>
      </View>

      <TextInput
        style={styles.field}
        value={query}
        onChangeText={setQuery}
        placeholder={t("calendar.location.search")}
        placeholderTextColor={colors.inkFaint}
        autoCorrect={false}
      />

      <View>
        {results.map((city) => (
          <Pressable
            key={`${city.name}-${city.lat}-${city.lon}`}
            style={styles.result}
            onPress={async () => {
              await choose(placeFromCity(city));
              navigation.goBack();
            }}
          >
            <View style={styles.resultText}>
              <Text style={styles.resultName}>{city.name}</Text>
              <Text style={styles.resultSub} numberOfLines={1}>
                {city.ascii !== city.name ? `${city.ascii} · ` : ""}
                {city.country}
                {aliasForLocale(city, locale) ? ` · ${aliasForLocale(city, locale)}` : ""}
              </Text>
            </View>
            <Text style={styles.resultCoord}>
              {city.lat.toFixed(2)}, {city.lon.toFixed(2)}
              {"\n"}
              {city.timeZone}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.button} onPress={locateNow} disabled={busy}>
        <Ionicons name="locate" size={16} color={colors.vermilion} />
        <Text style={styles.buttonText}>
          {busy ? t("calendar.location.searching") : t("calendar.location.retry")}
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  notice: {
    backgroundColor: colors.paperSunken,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
    padding: spacing.md,
  },
  noticeText: { ...type.small, color: colors.inkSoft },
  current: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  currentText: { ...type.small, color: colors.inkFaint, flex: 1 },
  field: {
    backgroundColor: colors.paperSunken,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: 15,
  },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  resultText: { flex: 1 },
  resultName: { ...type.body },
  resultSub: { ...type.small, color: colors.inkFaint },
  resultCoord: { ...type.small, color: colors.inkFaint, textAlign: "right" },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  buttonText: { ...type.body, color: colors.vermilion },
});
