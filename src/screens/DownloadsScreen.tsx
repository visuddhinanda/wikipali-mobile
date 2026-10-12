/**
 * 下载管理（`docs/download-manager.md` §8.2）：只管**还没下完**的书 —— 进行中
 * （下载中 / 等待中 / 排队中）与已暂停 / 失败；下完的书在「书架 → 已下载」。
 *
 * 入口：书架「已下载」顶部状态条、频道页的批次进度、我 → 设置 → 下载管理。
 * 页面底部是两个下载设置（使用移动网络下载 / 连上 Wi‑Fi 时自动下载）。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../components/Screen";
import {
  allowCellular,
  cancelDownload,
  channelNames,
  estimateTotalBytes,
  moveDownloadToTop,
  pauseAllDownloads,
  pauseDownload,
  resumeAllDownloads,
  resumeDownload,
  type DownloadProgress,
} from "../reading";
import { bookEntryAt } from "../catalog";
import {
  summarize,
  useDownloadEnv,
  useDownloadRow,
  useDownloadRows,
  useRunningDownload,
} from "../hooks/useDownloads";
import {
  formatBytes,
  formatRemaining,
  formatSpeed,
  statusLine,
} from "../components/downloadText";
import {
  getDownloadSettings,
  loadDownloadSettings,
  onDownloadSettingsChange,
  setDownloadSettings,
  type DownloadSettings,
} from "../settings/download";
import { colors, radius, spacing, type, serifFont } from "../theme";
import { useI18n, useT } from "../i18n/I18nContext";
import { bookTitleText } from "../i18n/bookTitles";

const ORDER: Record<string, number> = { downloading: 0, waiting: 1, queued: 2 };

type Section = { key: "active" | "stopped"; data: DownloadProgress[] };

export function DownloadsScreen() {
  const { t, locale } = useI18n();
  const rows = useDownloadRows();
  const env = useDownloadEnv();
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [settings, setSettings] = useState<DownloadSettings>(getDownloadSettings());
  // 退避倒计时要每秒走一下。
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void loadDownloadSettings().then(setSettings);
    return onDownloadSettingsChange(setSettings);
  }, []);

  const inProgress = useMemo(
    () =>
      rows
        .filter((r) => r.status in ORDER)
        .sort(
          (a, b) =>
            ORDER[a.status] - ORDER[b.status] ||
            (a.queuePos ?? Infinity) - (b.queuePos ?? Infinity),
        ),
    [rows],
  );
  const stopped = useMemo(
    () => rows.filter((r) => r.status === "paused" || r.status === "error"),
    [rows],
  );
  const queueIndex = useMemo(() => {
    const m = new Map<string, number>();
    inProgress
      .filter((r) => r.status === "queued")
      .forEach((r, i) => m.set(`${r.channel}/${r.book}`, i));
    return m;
  }, [inProgress]);

  const uids = useMemo(
    () => [...new Set([...inProgress, ...stopped].map((r) => r.channel))].sort().join(","),
    [inProgress, stopped],
  );
  useEffect(() => {
    if (!uids) return;
    let alive = true;
    channelNames(uids.split(",")).then((m) => alive && setNames(m));
    return () => {
      alive = false;
    };
  }, [uids]);

  const hasRetry = inProgress.some((r) => r.reason === "retry");
  useEffect(() => {
    if (!hasRetry) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasRetry]);

  const title = useCallback(
    (r: DownloadProgress) => {
      const entry = bookEntryAt(r.book, r.anchorPara ?? undefined);
      return (
        (entry ? bookTitleText(locale, r.book, entry.paragraph) : undefined) ??
        entry?.toc ??
        String(r.book)
      );
    },
    [locale],
  );

  const openMenu = useCallback(
    (r: DownloadProgress) => {
      const buttons: Parameters<typeof Alert.alert>[2] = [];
      if (r.status !== "downloading") {
        buttons.push({ text: t("download.moveToTop"), onPress: () => void moveDownloadToTop(r.channel, r.book) });
      }
      if (r.status === "waiting" && r.reason === "wifi") {
        buttons.push({ text: t("download.useCellular"), onPress: () => void allowCellular([{ channel: r.channel, book: r.book }]) });
      }
      buttons.push({
        text: t("download.cancel"),
        style: "destructive",
        onPress: () => void cancelDownload(r.channel, r.book),
      });
      buttons.push({ text: t("common.cancel"), style: "cancel" });
      Alert.alert(title(r), names.get(r.channel), buttons);
    },
    [names, t, title],
  );

  const sections = useMemo<Section[]>(
    () =>
      [
        { key: "active" as const, data: inProgress },
        { key: "stopped" as const, data: stopped },
      ].filter((s) => s.data.length > 0),
    [inProgress, stopped],
  );

  const waitingWifi = inProgress.filter((r) => r.status === "waiting" && r.reason === "wifi");

  return (
    <Screen scroll={false} contentStyle={styles.fill}>
      <SectionList<DownloadProgress, Section>
        sections={sections}
        keyExtractor={(r) => `${r.channel}/${r.book}`}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <SummaryCard
            inProgress={inProgress}
            stopped={stopped}
            cellularAllowed={settings.cellularAllowed}
            waitingWifi={waitingWifi}
            onCellular={env.cellular}
          />
        }
        renderSectionHeader={({ section }) =>
          section.key === "active" ? (
            <Text style={styles.section}>
              {t("downloads.section.active")} ({section.data.length})
            </Text>
          ) : (
            <View style={styles.sectionRow}>
              <Text style={styles.section}>
                {t("downloads.section.stopped")} ({section.data.length})
              </Text>
              <Pressable onPress={() => void resumeAllDownloads()} hitSlop={8}>
                <Text style={styles.link}>{t("download.resumeAll")}</Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item }) => (
          <DownloadRow
            row={item}
            title={title(item)}
            channelName={names.get(item.channel)}
            queueIndex={queueIndex.get(`${item.channel}/${item.book}`)}
            now={item.reason === "retry" ? now : 0}
            onMenu={openMenu}
          />
        )}
        ListFooterComponent={
          <>
            <Text style={styles.section}>{t("downloads.section.settings")}</Text>
            <View style={styles.list}>
              <SettingRow
                label={t("settings.download.cellular")}
                desc={t("settings.download.cellular.desc")}
                value={settings.cellularAllowed}
                onChange={(v) => void setDownloadSettings({ cellularAllowed: v })}
              />
              <SettingRow
                label={t("settings.download.autoWifi")}
                desc={t("settings.download.autoWifi.desc")}
                value={settings.autoOnWifi}
                onChange={(v) => void setDownloadSettings({ autoOnWifi: v })}
                last
              />
            </View>
          </>
        }
      />
    </Screen>
  );
}

/** 顶部汇总卡：总量、速度、剩余时间、全部暂停 / 继续、等 Wi‑Fi 提示（只有它订阅速度）。 */
function SummaryCard({
  inProgress,
  stopped,
  cellularAllowed,
  waitingWifi,
  onCellular,
}: {
  inProgress: DownloadProgress[];
  stopped: DownloadProgress[];
  cellularAllowed: boolean;
  waitingWifi: DownloadProgress[];
  onCellular: boolean;
}) {
  const t = useT();
  const { speed } = useRunningDownload();
  const sum = summarize(inProgress, speed);
  const pending = [...inProgress, ...stopped];
  const bytes = pending.reduce((s, r) => s + r.bytes, 0);
  // 还有没开工的书（估不出总量）时不显示「约总量」和剩余时间，免得把几百本说成几 MB。
  const estimates = pending.map((r) => estimateTotalBytes(r.bytes, r.done, r.total));
  const totalBytes = estimates.every((e) => e != null)
    ? estimates.reduce<number>((s, e) => s + (e ?? 0), 0)
    : 0;
  const remain =
    speed > 0 && totalBytes > bytes ? formatRemaining(t, (totalBytes - bytes) / speed) : "";
  // 进度条按段数算（每本开工前就有分母兜底），不依赖估出来的总字节。
  const paras = pending.reduce((n, r) => n + r.total, 0);
  const ratio = paras > 0 ? Math.min(1, pending.reduce((n, r) => n + r.done, 0) / paras) : 0;

  const head =
    sum.active > 0
      ? [
          sum.downloading ? t("downloads.summary.downloading", { n: sum.downloading }) : null,
          sum.queued ? t("downloads.summary.queued", { n: sum.queued }) : null,
          sum.waiting ? t("downloads.summary.waiting", { n: sum.waiting }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : stopped.length > 0
        ? t("downloads.summary.stopped", { n: stopped.length })
        : t("downloads.empty.title");

  return (
    <View style={styles.card}>
      <Text style={styles.head}>{head}</Text>
      {pending.length > 0 ? (
        <>
          <View style={[styles.bar, styles.barBig]}>
            <View style={[styles.barFill, { flex: ratio }]} />
            <View style={{ flex: 1 - ratio }} />
          </View>
          <Text style={styles.muted}>
            {[
              totalBytes > 0 ? `${formatBytes(bytes)} / ~${formatBytes(totalBytes)}` : formatBytes(bytes),
              sum.downloading ? formatSpeed(speed) : null,
              remain || null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </>
      ) : (
        <Text style={styles.muted}>{t("downloads.empty.sub")}</Text>
      )}
      <View style={styles.cardActions}>
        {sum.active > 0 ? (
          <Pressable style={styles.btn} onPress={() => void pauseAllDownloads()}>
            <Ionicons name="pause" size={14} color={colors.ink} />
            <Text style={styles.btnText}>{t("download.pauseAll")}</Text>
          </Pressable>
        ) : stopped.length > 0 ? (
          <Pressable style={styles.btn} onPress={() => void resumeAllDownloads()}>
            <Ionicons name="play" size={14} color={colors.ink} />
            <Text style={styles.btnText}>{t("download.resumeAll")}</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Text style={styles.small}>
          {cellularAllowed ? t("downloads.policy.cellular") : t("downloads.policy.wifiOnly")}
        </Text>
      </View>
      {waitingWifi.length > 0 ? (
        <View style={styles.wifiRow}>
          <Ionicons name="wifi" size={15} color="#7a4b16" />
          <Text style={styles.wifiText}>
            {t("downloads.waitingWifi", { n: waitingWifi.length })}
          </Text>
          {onCellular ? (
            <Pressable
              style={styles.wifiBtn}
              onPress={() =>
                void allowCellular(waitingWifi.map((r) => ({ channel: r.channel, book: r.book })))
              }
            >
              <Text style={styles.wifiBtnText}>{t("download.useCellular")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** 一本书一行；只有正在下载的那行跟着速度刷新。 */
const DownloadRow = React.memo(function DownloadRow({
  row: r,
  title,
  channelName,
  queueIndex,
  now,
  onMenu,
}: {
  row: DownloadProgress;
  title: string;
  channelName?: string;
  queueIndex?: number;
  now: number;
  onMenu: (r: DownloadProgress) => void;
}) {
  const t = useT();
  const { speed } = useDownloadRow(r.channel, r.book);
  const line = statusLine(t, r, { speed, queueIndex, now: now || undefined });
  const ratio = r.total > 0 ? Math.min(1, r.done / r.total) : 0;
  const main =
    r.status === "paused"
      ? { icon: "play" as const, label: t("download.resume"), run: () => resumeDownload(r.channel, r.book) }
      : r.status === "error"
        ? { icon: "refresh" as const, label: t("download.retry"), run: () => resumeDownload(r.channel, r.book) }
        : r.status === "waiting" && r.reason === "wifi_ready"
          ? { icon: "play" as const, label: t("download.start"), run: () => resumeDownload(r.channel, r.book) }
          : { icon: "pause" as const, label: t("download.pause"), run: () => pauseDownload(r.channel, r.book) };
  return (
    <Pressable style={styles.item} onPress={() => onMenu(r)}>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {title}
        </Text>
        {channelName ? (
          <Text style={styles.itemChannel} numberOfLines={1}>
            {channelName}
          </Text>
        ) : null}
        <Text
          style={[
            styles.itemSub,
            line.tone === "warn" && styles.warn,
            line.tone === "error" && styles.error,
          ]}
          numberOfLines={2}
        >
          {line.text}
        </Text>
        {r.status !== "queued" || ratio > 0 ? (
          <View style={styles.bar}>
            <View
              style={[
                styles.barFill,
                { flex: ratio },
                r.status === "waiting" && { backgroundColor: colors.ochre },
                (r.status === "paused" || r.status === "error") && {
                  backgroundColor: colors.inkFaint,
                },
              ]}
            />
            <View style={{ flex: 1 - ratio }} />
          </View>
        ) : null}
      </View>
      <Pressable
        style={styles.roundBtn}
        onPress={() => void main.run()}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={main.label}
      >
        <Ionicons name={main.icon} size={16} color={colors.vermilion} />
      </Pressable>
      <Pressable
        onPress={() => onMenu(r)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("download.more")}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.inkFaint} />
      </Pressable>
    </Pressable>
  );
});

function SettingRow({
  label,
  desc,
  value,
  onChange,
  last,
}: {
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.setRow, last && styles.lastRow]}>
      <View style={styles.itemBody}>
        <Text style={styles.setLabel}>{label}</Text>
        <Text style={styles.small}>{desc}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.vermilion, false: colors.border }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    paddingVertical: 0,
  },
  content: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
  },
  head: {
    ...type.heading,
  },
  muted: {
    ...type.caption,
    marginTop: spacing.xs,
  },
  small: {
    ...type.small,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  btnText: {
    ...type.caption,
    color: colors.ink,
  },
  wifiRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#f6ead8",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  wifiText: {
    ...type.caption,
    color: "#7a4b16",
    flex: 1,
  },
  wifiBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#c9a77a",
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  wifiBtnText: {
    ...type.small,
    color: "#7a4b16",
  },
  section: {
    ...type.caption,
    fontWeight: "600",
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  link: {
    ...type.caption,
    color: colors.vermilion,
  },
  list: {
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.md,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  itemBody: {
    flex: 1,
  },
  itemTitle: {
    ...type.body,
    fontFamily: serifFont,
    fontWeight: "600",
  },
  itemChannel: {
    ...type.small,
  },
  itemSub: {
    ...type.small,
    color: colors.inkSoft,
    marginTop: 2,
  },
  warn: {
    color: colors.ochre,
  },
  error: {
    color: "#b0412e",
  },
  bar: {
    flexDirection: "row",
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.paperSunken,
    overflow: "hidden",
    marginTop: 6,
  },
  barBig: {
    height: 6,
    marginTop: spacing.md,
  },
  barFill: {
    backgroundColor: colors.vermilion,
  },
  roundBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  setLabel: {
    ...type.body,
  },
});
