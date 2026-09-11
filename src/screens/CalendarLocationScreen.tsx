/**
 * 观察地。
 *
 * 定位失败不是弹一个错误框，而是直接给一个能立刻用起来的城镇搜索：
 * 提示语说明「能做什么」和「误差多大」，不写权限错误码。
 *
 * 常用地点摆在最上面 —— 一个人常算的地点就那么几个（自己的寺院、常去挂单的
 * 道场、家人所在的城市），每次重新搜一遍太笨。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";
import { useI18n, useT } from "../i18n/I18nContext";
import { CITY_COUNT, aliasForLocale, searchCities, type City } from "../calendar/location/cities";
import { placeFromCity, type Place } from "../calendar/location/place";
import {
  addFavorite,
  isSamePlace,
  loadFavorites,
  removeFavorite,
} from "../calendar/location/favorites";
import { usePlace } from "../calendar/useCalendar";

export function CalendarLocationScreen() {
  const t = useT();
  const { locale } = useI18n();
  const navigation = useNavigation();
  const { place, busy, failed, gpsAvailable, locateNow, choose } = usePlace();
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<Place[]>([]);

  useEffect(() => {
    void loadFavorites().then(setFavorites);
  }, []);

  // 「自动定位」放标题栏：它是这一页的主操作，摆在正文里会跟常用地点、
  // 搜索结果抢位置，而且滚下去就看不见了。
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={locateNow} disabled={busy} hitSlop={8} style={styles.headerAction}>
          <Ionicons
            name="locate"
            size={15}
            color={busy ? colors.inkFaint : colors.vermilion}
          />
          <Text style={[styles.headerActionText, busy && styles.headerActionBusy]}>
            {busy ? t("calendar.location.searching") : t("calendar.location.auto")}
          </Text>
        </Pressable>
      ),
    });
  }, [navigation, t, locateNow, busy]);

  const results = useMemo<City[]>(
    () => (query.trim().length >= 1 ? searchCities(query, 20) : []),
    [query],
  );

  const use = useCallback(
    async (next: Place) => {
      await choose(next);
      navigation.goBack();
    },
    [choose, navigation],
  );

  const currentIsSaved = favorites.some((p) => isSamePlace(p, place));

  return (
    <Screen contentStyle={styles.content}>
      {/*
        「定位失败」和「用户自己挑了城镇」是两回事，不能共用一句话：
        挑完城镇再进来还说「没能取到定位」，会让人以为定位坏了。
        真失败过才报警（金色框），手选城镇只给一句中性说明。
      */}
      {!gpsAvailable || failed ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            {gpsAvailable
              ? `${t("calendar.location.failedTitle")}。${t("calendar.location.failedBody")}`
              : t("calendar.location.unavailable")}
          </Text>
        </View>
      ) : place.source !== "gps" ? (
        <Text style={styles.hint}>{t("calendar.location.usingCity")}</Text>
      ) : null}

      <View style={styles.current}>
        <Ionicons
          name={place.source === "gps" ? "location" : "location-outline"}
          size={14}
          color={place.source === "gps" ? colors.success : colors.gold}
        />
        <Text style={styles.currentText} numberOfLines={1}>
          {place.name} · {place.lat.toFixed(3)}, {place.lon.toFixed(3)}
          {place.accuracy ? ` ±${Math.round(place.accuracy)} m` : ""} · {place.timeZone}
        </Text>
        {!currentIsSaved ? (
          <Pressable
            hitSlop={8}
            onPress={async () => setFavorites(await addFavorite(place))}
          >
            <Text style={styles.link}>{t("calendar.location.addFavorite")}</Text>
          </Pressable>
        ) : null}
      </View>

      {favorites.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("calendar.location.favorites")}</Text>
          {favorites.map((favorite) => (
            <Pressable
              key={`${favorite.lat},${favorite.lon}`}
              style={styles.row}
              onPress={() => use(favorite)}
            >
              <Ionicons name="bookmark" size={14} color={colors.ochre} />
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{favorite.name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {favorite.lat.toFixed(2)}, {favorite.lon.toFixed(2)} · {favorite.timeZone}
                </Text>
              </View>
              {isSamePlace(favorite, place) ? (
                <Ionicons name="checkmark" size={16} color={colors.vermilion} />
              ) : null}
              <Pressable
                hitSlop={10}
                onPress={async () => setFavorites(await removeFavorite(favorite))}
              >
                <Ionicons name="close" size={16} color={colors.inkFaint} />
              </Pressable>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextInput
        style={styles.field}
        value={query}
        onChangeText={setQuery}
        placeholder={t("calendar.location.search")}
        placeholderTextColor={colors.inkFaint}
        autoCorrect={false}
      />

      <View>
        {results.map((city) => {
          const asPlace = placeFromCity(city);
          const saved = favorites.some((p) => isSamePlace(p, asPlace));
          return (
            <Pressable
              key={`${city.name}-${city.lat}-${city.lon}`}
              style={styles.row}
              onPress={() => use(asPlace)}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{city.name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {city.ascii !== city.name ? `${city.ascii} · ` : ""}
                  {city.country}
                  {aliasForLocale(city, locale) ? ` · ${aliasForLocale(city, locale)}` : ""}
                </Text>
              </View>
              <Text style={styles.rowCoord}>
                {city.lat.toFixed(2)}, {city.lon.toFixed(2)}
                {"\n"}
                {city.timeZone}
              </Text>
              {/* + 只管收藏，点行本身才是「用这个地点」，两件事分开 */}
              <Pressable
                hitSlop={10}
                disabled={saved}
                onPress={async () => setFavorites(await addFavorite(asPlace))}
              >
                <Ionicons
                  name={saved ? "bookmark" : "add"}
                  size={18}
                  color={saved ? colors.ochre : colors.vermilion}
                />
              </Pressable>
            </Pressable>
          );
        })}
      </View>

      {query.length && !favorites.length ? (
        <Text style={styles.hint}>{t("calendar.location.favoriteHint")}</Text>
      ) : null}

      <Text style={styles.hint}>
        {t("calendar.location.offlineNote", { n: (CITY_COUNT / 10000).toFixed(1) })}
      </Text>
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
  link: { ...type.small, color: colors.vermilion },
  section: { gap: 2 },
  sectionTitle: { ...type.small, color: colors.inkFaint, marginBottom: spacing.xs },
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowText: { flex: 1 },
  rowName: { ...type.body },
  rowSub: { ...type.small, color: colors.inkFaint },
  rowCoord: { ...type.small, color: colors.inkFaint, textAlign: "right" },
  headerAction: { flexDirection: "row", alignItems: "center", gap: 4 },
  headerActionText: { ...type.body, color: colors.vermilion },
  headerActionBusy: { color: colors.inkFaint },
  hint: { ...type.small, color: colors.inkFaint },
});
