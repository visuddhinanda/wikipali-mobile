import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { API_SERVERS, DEFAULT_SERVER, getApiServer } from "../settings/server";
import { ENV_API_URL } from "../api/config";
import { colors, radius, spacing, type } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { useI18n } from "../i18n/I18nContext";
import { getUposathaNotify, setUposathaNotify } from "../settings/notifications";
import {
  notifyTextOf,
  rescheduleUposathaNotifications,
  scheduleTestNotification,
} from "../calendar/notifications";
import { defaultSystemFor } from "../calendar/lunar";
import { fallbackPlace, loadSavedPlace } from "../calendar/location/place";
import { useCalendarSystem } from "../calendar/useCalendar";
import { LOCALE_OPTIONS } from "../i18n";
import type { MessageKey } from "../i18n";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const [server, setServer] = useState<string>(DEFAULT_SERVER);
  const { t, preference, locale } = useI18n();
  const [notify, setNotify] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  // 排出去几条 / 有没有被系统拒权限，都要让用户看得见 —— 否则打开开关之后
  // 什么反馈都没有，只能等到下一个布萨日才知道成没成。
  const [scheduled, setScheduled] = useState<number | null>(null);
  const [denied, setDenied] = useState(false);
  const [system] = useCalendarSystem(defaultSystemFor(locale));

  // 开发期真机自检：两分钟后发一条，好当场看到通知长什么样，不用等下一个布萨日。
  // 只在 __DEV__ 出现，release 包里没有这个入口。
  const [testAt, setTestAt] = useState<Date | null>(null);
  const sendTest = useCallback(async () => {
    const place = (await loadSavedPlace()) ?? fallbackPlace();
    setTestAt(
      await scheduleTestNotification({ system, timeZone: place.timeZone, text: notifyTextOf(t) }),
    );
  }, [system, t]);

  const toggleNotify = useCallback(
    async (next: boolean) => {
      setNotifyBusy(true);
      // 先落盘再排程：万一排程过程中被杀掉，下次启动也能按用户的意愿恢复。
      await setUposathaNotify(next);
      setNotify(next);
      const place = (await loadSavedPlace()) ?? fallbackPlace();
      const n = await rescheduleUposathaNotifications({
        enabled: next,
        system,
        timeZone: place.timeZone,
        text: notifyTextOf(t),
      });
      // 开了却一条没排出去，只可能是权限被拒。
      setDenied(next && n === 0);
      setScheduled(next ? n : null);
      setNotifyBusy(false);
    },
    [system, t],
  );

  // 「跟随系统」时显示实际生效的语言，让用户一眼看到当前是哪种。
  const currentLanguageLabel =
    preference === "system"
      ? `${t("settings.language.system")} · ${
          LOCALE_OPTIONS.find((o) => o.id === locale)?.label ?? locale
        }`
      : (LOCALE_OPTIONS.find((o) => o.id === preference)?.label ?? preference);

  // .env 覆盖时选择不生效，直接显示真正在用的地址，免得看起来像 bug。
  const currentServerLabel =
    ENV_API_URL ||
    (API_SERVERS.find((s) => s.id === server)?.label ?? server);

  // 从下级页面返回时要反映刚改过的选择，所以每次获得焦点都重读一次。
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getApiServer().then((v) => {
        if (alive) setServer(v);
      });
      getUposathaNotify().then((v) => {
        if (alive) setNotify(v);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <Screen contentStyle={styles.content}>
      {/* 界面语言：详情在下级页面，这里只显示当前值 */}
      <Text style={styles.sectionTitle}>{t("settings.language")}</Text>
      <Pressable
        style={styles.row}
        onPress={() => navigation.navigate("LanguageSettings")}
      >
        <Ionicons name="language" size={20} color={colors.inkSoft} />
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel}>{currentLanguageLabel}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
      </Pressable>

      <View style={styles.divider} />

      {/* API 服务器：详情在下级页面，这里只显示当前生效的值 */}
      <Text style={styles.sectionTitle}>{t("settings.apiServer")}</Text>
      <Pressable
        style={styles.row}
        onPress={() => navigation.navigate("ApiServerSettings")}
      >
        <Ionicons name="server-outline" size={20} color={colors.inkSoft} />
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel}>{currentServerLabel}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
      </Pressable>

      <View style={styles.divider} />

      {/* 布萨日提醒：纯本地排程，不需要后端（docs/buddhist-calendar.md §2.10） */}
      <Text style={styles.sectionTitle}>{t("settings.notifications")}</Text>
      <View style={styles.row}>
        <Ionicons name="notifications-outline" size={20} color={colors.inkSoft} />
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel}>{t("settings.uposathaNotify")}</Text>
          <Text style={styles.rowHint}>{t("settings.uposathaNotifyHint")}</Text>
          {denied ? (
            <Text style={styles.rowWarn}>{t("settings.uposathaNotifyDenied")}</Text>
          ) : scheduled ? (
            <Text style={styles.rowHint}>
              {t("settings.uposathaNotifyScheduled", { n: scheduled })}
            </Text>
          ) : null}
        </View>
        <Switch
          value={notify}
          disabled={notifyBusy}
          onValueChange={(v) => void toggleNotify(v)}
          trackColor={{ true: colors.vermilion, false: colors.border }}
        />
      </View>

      {__DEV__ ? (
        <Pressable style={styles.row} onPress={() => void sendTest()}>
          <Ionicons name="flask-outline" size={20} color={colors.inkSoft} />
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>发一条测试通知（仅开发版）</Text>
            <Text style={styles.rowHint}>
              {testAt
                ? `将在 ${testAt.toLocaleTimeString()} 发出 —— 现在可以退出 App 锁屏等它`
                : "两分钟后发出，内容取自下一个真实布萨日，走正式排程的同一条路径"}
            </Text>
          </View>
        </Pressable>
      ) : null}

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>{t("settings.others")}</Text>
      {(
        [
          // 尚未实现的项没有 route，点击暂不响应。
          { icon: "text", label: "settings.display" as MessageKey },
          { icon: "download", label: "settings.downloads" as MessageKey },
          {
            icon: "information-circle",
            label: "settings.about" as MessageKey,
            route: "About" as const,
          },
        ]
      ).map((row) => (
        <Pressable
          key={row.label}
          style={styles.row}
          onPress={() => row.route && navigation.navigate(row.route)}
          disabled={!row.route}
        >
          <Ionicons name={row.icon as any} size={20} color={colors.inkSoft} />
          <Text style={styles.rowLabel}>{t(row.label)}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
  },
  sectionTitle: {
    ...type.heading,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  rowBody: {
    flex: 1,
  },
  rowLabel: {
    ...type.body,
  },
  rowHint: {
    ...type.small,
    color: colors.inkFaint,
    marginTop: 2,
  },
  rowWarn: {
    ...type.small,
    color: colors.ochre,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.lg,
  },
});
