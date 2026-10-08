import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { API_SERVERS, DEFAULT_SERVER, getApiServer } from "../settings/server";
import {
  debugApiUrl,
  getDebugConfig,
  setDebugConfig,
  useDebugConfig,
  type DebugConfig,
} from "../settings/debug";
import { resetAiRuntimeProbe } from "../ai/availability";
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
import { loadSavedPlace } from "../calendar/location/place";
import { deviceTimeZone } from "../calendar/tz";
import { useCalendarSystem } from "../calendar/useCalendar";
import { hasAggressivePowerManagement, openAppSettings } from "../settings/powerRestriction";
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
  // 厂商是固定的，没必要每次渲染都问一次原生常量。
  const powerRestricted = useMemo(() => hasAggressivePowerManagement(), []);

  // 开发期真机自检：两分钟后发一条，好当场看到通知长什么样，不用等下一个布萨日。
  // 只在 __DEV__ 出现，release 包里没有这个入口。
  const [testAt, setTestAt] = useState<Date | null>(null);
  const sendTest = useCallback(async () => {
    const timeZone = (await loadSavedPlace())?.timeZone ?? deviceTimeZone();
    setTestAt(
      await scheduleTestNotification({ system, timeZone, text: notifyTextOf(t) }),
    );
  }, [system, t]);

  const toggleNotify = useCallback(
    async (next: boolean) => {
      setNotifyBusy(true);
      // 先落盘再排程：万一排程过程中被杀掉，下次启动也能按用户的意愿恢复。
      await setUposathaNotify(next);
      setNotify(next);
      const timeZone = (await loadSavedPlace())?.timeZone ?? deviceTimeZone();
      const n = await rescheduleUposathaNotifications({
        enabled: next,
        system,
        timeZone,
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

  // 调试模式填了 API 地址时选择不生效，直接显示真正在用的地址，免得看起来像 bug。
  const debug = useDebugConfig();
  const currentServerLabel =
    debugApiUrl(debug) ||
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

  // 应用是 edge-to-edge，adjustResize 不再替我们让位；调试地址输入框在页面中下部，
  // 不垫一下就被键盘盖住。
  const headerHeight = useHeaderHeight();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
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

        {/* 调试：手填 API / AI Runtime 地址，关掉就用代码里的值（src/settings/debug.ts） */}
        <Text style={styles.sectionTitle}>{t("settings.debug")}</Text>
        <DebugSection config={debug} />

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
            {/*
              省电策略的提示只在**开关打开后**出现：没开提醒时说这个是噪音。
              这一条比权限被拒更隐蔽 —— 权限被拒至少没有通知，省电限制是通知会
              来但迟到好几天，用户根本不会归因到这里（见 powerRestriction.ts）。
            */}
            {notify && powerRestricted ? (
              <>
                <Text style={styles.rowWarn}>{t("settings.uposathaNotifyPower")}</Text>
                <Pressable onPress={() => void openAppSettings()} hitSlop={6}>
                  <Text style={styles.rowAction}>
                    {t("settings.uposathaNotifyPowerAction")}
                  </Text>
                </Pressable>
              </>
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
    </KeyboardAvoidingView>
  );
}

/**
 * 输入框本地编辑、失焦/回车才落盘 —— 每敲一个字就切一次地址，
 * 半截 URL 会让正在进行的请求全打到错误的地方。
 */
function DebugSection({ config }: { config: DebugConfig }) {
  const { t } = useI18n();
  const [apiUrl, setApiUrl] = useState(config.apiUrl);
  const [runtimeUrl, setRuntimeUrl] = useState(config.runtimeUrl);

  // 启动时配置是异步读出来的，读到之后同步一次输入框。
  useEffect(() => {
    setApiUrl(config.apiUrl);
    setRuntimeUrl(config.runtimeUrl);
  }, [config.apiUrl, config.runtimeUrl]);

  // 安卓用返回键收起键盘不会触发 blur，直接离开页面也不会；所以除了失焦/回车，
  // 键盘收起和卸载时也把还没落盘的输入补存一次，免得改了却没生效。
  const draft = useRef({ apiUrl, runtimeUrl });
  draft.current = { apiUrl, runtimeUrl };
  const commit = useCallback(() => {
    const saved = getDebugConfig();
    const { apiUrl: a, runtimeUrl: r } = draft.current;
    if (a === saved.apiUrl && r === saved.runtimeUrl) return;
    if (r !== saved.runtimeUrl) resetAiRuntimeProbe();
    void setDebugConfig({ apiUrl: a, runtimeUrl: r });
  }, []);
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidHide", commit);
    return () => {
      sub.remove();
      commit();
    };
  }, [commit]);

  return (
    <View style={[styles.row, styles.rowTop]}>
      <Ionicons name="bug-outline" size={20} color={colors.inkSoft} />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{t("settings.debug")}</Text>
        <Text style={styles.rowHint}>{t("settings.debugHint")}</Text>
        {config.enabled ? (
          <>
            <Text style={styles.fieldLabel}>EXPO_PUBLIC_API_URL</Text>
            <TextInput
              style={styles.input}
              value={apiUrl}
              onChangeText={setApiUrl}
              onBlur={commit}
              onSubmitEditing={commit}
              placeholder="http://192.168.x.x:8000/api/v2"
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.fieldLabel}>EXPO_PUBLIC_RUNTIME_URL</Text>
            <TextInput
              style={styles.input}
              value={runtimeUrl}
              onChangeText={setRuntimeUrl}
              onBlur={commit}
              onSubmitEditing={commit}
              placeholder="http://192.168.x.x:3001/api/copilotkit"
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </>
        ) : null}
      </View>
      <Switch
        value={config.enabled}
        onValueChange={(enabled) => {
          resetAiRuntimeProbe();
          // 连同还没失焦的输入一起存，免得开关一切换就丢了刚敲的地址。
          void setDebugConfig({ enabled, apiUrl, runtimeUrl });
        }}
        trackColor={{ true: colors.vermilion, false: colors.border }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
  rowAction: {
    ...type.small,
    color: colors.vermilion,
    marginTop: spacing.xs,
    textDecorationLine: "underline",
  },
  rowTop: {
    alignItems: "flex-start",
  },
  fieldLabel: {
    ...type.small,
    color: colors.inkSoft,
    marginTop: spacing.sm,
  },
  input: {
    ...type.small,
    color: colors.ink,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.lg,
  },
});
