/**
 * 下载确认面板（全局一个，挂在 App 根部）：
 *
 * - **Wi‑Fi 下「全部下载」**：确认本数（已下载的跳过）→ 开始下载 / 取消。
 * - **移动网络且未允许移动网络下载**（单本或全部）：立即下载 / 等待 Wi‑Fi / 取消，
 *   外加「以后都用移动网络下载，不再询问」。交互依据见 `docs/download-manager.md` §8.5。
 *
 * 用法：`requestDownload(items, { title | batch })`（`downloadRequest.ts`）。
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, type } from "../theme";
import { useT } from "../i18n/I18nContext";

export interface PromptRequest {
  /** 将下载的本数。 */
  count: number;
  /** 已下载、将跳过的本数（全部下载时）。 */
  skipped?: number;
  /** 单本时的书名。 */
  title?: string;
  /** 是否在移动网络下询问。 */
  cellular: boolean;
}

export type PromptChoice =
  | { kind: "start" }
  | { kind: "now"; dontAsk: boolean }
  | { kind: "wifi" }
  | { kind: "cancel" };

type Pending = PromptRequest & { resolve: (c: PromptChoice) => void };

let show: ((p: Pending) => void) | null = null;

/** 弹出确认面板，等用户选择。宿主未挂载时按「开始」处理。 */
export function askDownload(req: PromptRequest): Promise<PromptChoice> {
  return new Promise((resolve) => {
    if (!show) return resolve(req.cellular ? { kind: "now", dontAsk: false } : { kind: "start" });
    show({ ...req, resolve });
  });
}

export function DownloadPromptHost() {
  const t = useT();
  const [req, setReq] = useState<Pending | null>(null);
  const [dontAsk, setDontAsk] = useState(false);

  useEffect(() => {
    show = (p) => {
      setDontAsk(false);
      setReq(p);
    };
    return () => {
      show = null;
    };
  }, []);

  const close = (choice: PromptChoice) => {
    req?.resolve(choice);
    setReq(null);
  };

  const what = req?.title
    ? t("download.cellular.bodyOne", { title: req.title })
    : t("download.cellular.bodyMany", { n: req?.count ?? 0 });

  return (
    <Modal
      visible={req != null}
      transparent
      animationType="slide"
      onRequestClose={() => close({ kind: "cancel" })}
    >
      <Pressable style={styles.scrim} onPress={() => close({ kind: "cancel" })}>
        {/* 面板本身吞掉点击，免得点到面板也关掉 */}
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.grip} />
          {req?.cellular ? (
            <>
              <Text style={styles.title}>{t("download.cellular.title")}</Text>
              <View style={styles.warn}>
                <Ionicons name="cellular" size={16} color={colors.ochre} />
                <Text style={styles.warnText}>{what}</Text>
              </View>
              {req.skipped ? (
                <Text style={styles.line}>{t("download.all.skipped", { n: req.skipped })}</Text>
              ) : null}
              <Pressable
                style={[styles.btn, styles.primary]}
                onPress={() => close({ kind: "now", dontAsk })}
              >
                <Text style={styles.primaryText}>{t("download.now")}</Text>
              </Pressable>
              <Pressable style={styles.btn} onPress={() => close({ kind: "wifi" })}>
                <Text style={styles.btnText}>{t("download.waitForWifi")}</Text>
              </Pressable>
              <Pressable style={styles.textBtn} onPress={() => close({ kind: "cancel" })}>
                <Text style={styles.textBtnText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable style={styles.check} onPress={() => setDontAsk((v) => !v)}>
                <Ionicons
                  name={dontAsk ? "checkbox" : "square-outline"}
                  size={20}
                  color={dontAsk ? colors.vermilion : colors.inkFaint}
                />
                <Text style={styles.checkText}>{t("download.cellular.dontAsk")}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>{t("channel.downloadAll")}</Text>
              <Text style={styles.line}>{t("download.all.count", { n: req?.count ?? 0 })}</Text>
              {req?.skipped ? (
                <Text style={styles.line}>{t("download.all.skipped", { n: req.skipped })}</Text>
              ) : null}
              <Text style={styles.hint}>{t("download.all.hint")}</Text>
              <View style={styles.row}>
                <Pressable style={[styles.btn, styles.half]} onPress={() => close({ kind: "cancel" })}>
                  <Text style={styles.btnText}>{t("common.cancel")}</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.primary, styles.half]}
                  onPress={() => close({ kind: "start" })}
                >
                  <Text style={styles.primaryText}>{t("download.startAll")}</Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,15,10,0.38)",
  },
  sheet: {
    backgroundColor: colors.paperRaised,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  grip: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  title: {
    ...type.heading,
    marginBottom: spacing.sm,
  },
  warn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#f6ead8",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  warnText: {
    ...type.caption,
    color: "#7a4b16",
    flex: 1,
  },
  line: {
    ...type.caption,
    marginBottom: spacing.xs,
  },
  hint: {
    ...type.small,
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
  },
  half: {
    flex: 1,
  },
  btn: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  btnText: {
    ...type.body,
  },
  primary: {
    backgroundColor: colors.vermilion,
    borderColor: colors.vermilion,
  },
  primaryText: {
    ...type.body,
    color: colors.paperRaised,
    fontWeight: "600",
  },
  textBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  textBtnText: {
    ...type.body,
    color: colors.inkSoft,
  },
  check: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  checkText: {
    ...type.caption,
    flex: 1,
  },
});
