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
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
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
import { buildDiagnosticsReport } from "../calendar/location/diagnostics";
import { usePlace } from "../calendar/useCalendar";

export function CalendarLocationScreen() {
  const t = useT();
  const { locale } = useI18n();
  const navigation = useNavigation();
  const { place, busy, failed, retrying, gpsAvailable, locateNow, choose } = usePlace();
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<Place[]>([]);
  const [debugText, setDebugText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void loadFavorites().then(setFavorites);
  }, []);

  // 自动定位失败不能静默：先问用户愿不愿意帮我们改进，愿意就把本次的
  // 设备/系统/报错现场展开成一份可复制的调试信息。
  const onLocate = useCallback(async () => {
    const result = await locateNow();
    if (result.failure) {
      Alert.alert(t("calendar.location.helpTitle"), t("calendar.location.helpBody"), [
        { text: t("calendar.location.helpNo"), style: "cancel" },
        {
          text: t("calendar.location.helpYes"),
          onPress: () => {
            setCopied(false);
            setDebugText(buildDiagnosticsReport(result));
          },
        },
      ]);
    }
  }, [locateNow, t]);

  const copyDebug = useCallback(async () => {
    if (!debugText) return;
    await Clipboard.setStringAsync(debugText);
    setCopied(true);
  }, [debugText]);

  // 「自动定位」放标题栏：它是这一页的主操作，摆在正文里会跟常用地点、
  // 搜索结果抢位置，而且滚下去就看不见了。
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={onLocate} disabled={busy} hitSlop={8} style={styles.headerAction}>
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
  }, [navigation, t, onLocate, busy]);

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

  const currentIsSaved = place ? favorites.some((p) => isSamePlace(p, place)) : false;

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
      ) : place && place.source !== "gps" ? (
        <Text style={styles.hint}>{t("calendar.location.usingCity")}</Text>
      ) : null}

      <View style={styles.current}>
        {place ? (
          <>
            <Ionicons
              name={place.source === "gps" ? "location" : "location-outline"}
              size={14}
              color={place.source === "gps" ? colors.success : colors.gold}
            />
            <View style={styles.currentText}>
              <Text style={styles.currentName} numberOfLines={1}>
                {place.name}
              </Text>
              <Text style={styles.currentSub} numberOfLines={1}>
                {place.subtitle ? `${place.subtitle} · ` : ""}
                {place.lat.toFixed(3)}, {place.lon.toFixed(3)}
                {place.accuracy ? ` ±${Math.round(place.accuracy)} m` : ""} · {place.timeZone}
              </Text>
            </View>
            {!currentIsSaved ? (
              <Pressable
                hitSlop={8}
                onPress={async () => setFavorites(await addFavorite(place))}
              >
                <Text style={styles.link}>{t("calendar.location.addFavorite")}</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <Ionicons name="locate" size={14} color={colors.gold} />
            <Text style={styles.currentText} numberOfLines={1}>
              {failed
                ? t("calendar.location.failedMark")
                : retrying
                  ? t("calendar.location.retrying")
                  : t("calendar.location.locating")}
            </Text>
          </>
        )}
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
              {place && isSamePlace(favorite, place) ? (
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

      <Modal
        transparent
        visible={debugText !== null}
        animationType="fade"
        onRequestClose={() => setDebugText(null)}
      >
        <View style={styles.debugBackdrop}>
          <View style={styles.debugSheet}>
            <View style={styles.debugHeader}>
              <Text style={styles.debugTitle}>{t("calendar.location.debugTitle")}</Text>
              <Pressable hitSlop={10} onPress={() => setDebugText(null)}>
                <Ionicons name="close" size={20} color={colors.inkFaint} />
              </Pressable>
            </View>
            <ScrollView style={styles.debugScroll}>
              <Text style={styles.debugText} selectable>
                {debugText}
              </Text>
            </ScrollView>
            <Pressable style={styles.debugCopy} onPress={copyDebug}>
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={16}
                color={colors.paperRaised}
              />
              <Text style={styles.debugCopyText}>
                {copied
                  ? t("calendar.location.debugCopied")
                  : t("calendar.location.debugCopy")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  currentText: { flex: 1 },
  currentName: { ...type.body, color: colors.ink },
  currentSub: { ...type.small, color: colors.inkFaint, marginTop: 1 },
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
  debugBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  debugSheet: {
    backgroundColor: colors.paperRaised,
    borderRadius: radius.lg,
    padding: spacing.md,
    maxHeight: "80%",
  },
  debugHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  debugTitle: { ...type.heading },
  debugScroll: { flexGrow: 0, marginBottom: spacing.md },
  debugText: {
    ...type.small,
    color: colors.inkSoft,
    fontFamily: "monospace",
    lineHeight: 18,
  },
  debugCopy: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.vermilion,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
  },
  debugCopyText: { color: colors.paperRaised, fontSize: 15, fontWeight: "600" },
});
