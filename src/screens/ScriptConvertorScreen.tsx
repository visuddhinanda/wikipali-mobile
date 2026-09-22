/**
 * 工具 → 编码转换：巴利文各种字体互转。
 *
 * 与网页版 `library/tools/script-convertor` 同一套转换表（`src/pali/script`），
 * 交互上有两点按移动端调整：
 * - **边打边转**，不用点「→」按钮 —— 转换是纯计算，最大的表转 5000 字符也就
 *   两毫秒左右，没有必要让用户多点一下；「→」按钮改成两栏互换。
 * - 宽屏左右分栏、窄屏上下堆叠（网页版是 768px 断点；这里走 `useLayout()`
 *   的统一档位，见 `docs/README.md` §4.9）。
 *
 * 页面自己占满高度（`Screen scroll={false}`），两栏各分一半 —— 输出区要能
 * 独立滚动，不能再套在页面的纵向 ScrollView 里（嵌套同向滚动会打架）。
 */
import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";
import { useLayout } from "../hooks/useLayout";
import { useT } from "../i18n/I18nContext";
import {
  DEFAULT_NIGGAHITA,
  NIGGAHITA_OPTIONS,
  SOURCE_LABELS,
  SOURCE_SCRIPTS,
  SOURCE_TO_TARGET,
  TARGET_TO_SOURCE,
  TARGET_LABELS,
  TARGET_SCRIPTS,
  convertScript,
  type Niggahita,
  type ScriptLabel,
  type SourceScript,
  type TargetScript,
} from "../pali/script";

export function ScriptConvertorScreen() {
  const t = useT();
  const { isWide } = useLayout();

  const [from, setFrom] = useState<SourceScript>("roman");
  const [to, setTo] = useState<TargetScript>("myanmar");
  const [niggahita, setNiggahita] = useState<Niggahita>(DEFAULT_NIGGAHITA);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const output = useMemo(
    () => convertScript(text, { from, to, niggahita }),
    [text, from, to, niggahita],
  );

  const label = (l: ScriptLabel) =>
    l.noteKey ? `${l.name}（${t(l.noteKey)}）` : l.name;

  /** 互换两栏：只有两边都有对应项时才可用（如天城体只能作输出）。 */
  const swappable = TARGET_TO_SOURCE[to] !== undefined && SOURCE_TO_TARGET[from] !== undefined;
  const swap = () => {
    const nextFrom = TARGET_TO_SOURCE[to];
    const nextTo = SOURCE_TO_TARGET[from];
    if (!nextFrom || !nextTo) return;
    setFrom(nextFrom);
    setTo(nextTo);
    setText(output);
  };

  const copy = async () => {
    await Clipboard.setStringAsync(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Screen scroll={false} contentStyle={styles.content}>
      <View style={[styles.layout, isWide && styles.layoutWide]}>
        <View style={styles.panel}>
          <Text style={styles.label}>{t("tools.script.input")}</Text>
          <ScriptSelect
            value={from}
            options={SOURCE_SCRIPTS}
            labelOf={(id) => label(SOURCE_LABELS[id])}
            onChange={setFrom}
          />
          <TextInput
            style={[styles.area, styles.areaFill]}
            value={text}
            onChangeText={setText}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t("tools.script.inputHint")}
            placeholderTextColor={colors.inkFaint}
          />
        </View>

        {/* 中间控件：宽屏竖排在两栏之间，窄屏横排成一行 */}
        <View style={[styles.middle, isWide && styles.middleWide]}>
          <View style={styles.niggahitaBox}>
            <Text style={styles.middleLabel}>
              {t("tools.script.niggahita")}
            </Text>
            <View style={styles.pillRow}>
              {NIGGAHITA_OPTIONS.map((n) => {
                const active = n === niggahita;
                return (
                  <Pressable
                    key={n}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => setNiggahita(n)}
                  >
                    <Text style={active ? styles.pillTextActive : styles.pillText}>
                      {n}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Pressable
            style={[styles.swap, !swappable && styles.swapDisabled]}
            disabled={!swappable}
            onPress={swap}
          >
            <Ionicons
              name={isWide ? "swap-horizontal" : "swap-vertical"}
              size={20}
              color="#fdfaf1"
            />
          </Pressable>
        </View>

        <View style={styles.panel}>
          <View style={styles.outputHead}>
            <Text style={styles.label}>{t("tools.script.output")}</Text>
            <Pressable
              style={styles.copy}
              disabled={!output}
              onPress={copy}
              hitSlop={8}
            >
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={15}
                color={output ? colors.vermilion : colors.inkFaint}
              />
              <Text
                style={[
                  styles.copyText,
                  { color: output ? colors.vermilion : colors.inkFaint },
                ]}
              >
                {t(copied ? "tools.script.copied" : "tools.script.copy")}
              </Text>
            </Pressable>
          </View>
          <ScriptSelect
            value={to}
            options={TARGET_SCRIPTS}
            labelOf={(id) => label(TARGET_LABELS[id])}
            onChange={setTo}
          />
          {/* 输出用可滚动文本而不是只读输入框：长结果能滚，也能长按选中复制 */}
          <ScrollView
            style={[styles.area, styles.areaFill]}
            contentContainerStyle={styles.areaContent}
          >
            <Text selectable style={styles.outputText}>
              {output || t("tools.script.outputHint")}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Screen>
  );
}

/** 字体下拉：点开一个居中浮层选，选项名一律用该字体自己的写法。 */
function ScriptSelect<T extends string>({
  value,
  options,
  labelOf,
  onChange,
}: {
  value: T;
  options: readonly T[];
  labelOf: (id: T) => string;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={styles.select} onPress={() => setOpen(true)}>
        <Text style={styles.selectText} numberOfLines={1}>
          {labelOf(value)}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.inkSoft} />
      </Pressable>
      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <ScrollView>
            {options.map((id) => {
              const active = id === value;
              return (
                <Pressable
                  key={id}
                  style={styles.option}
                  onPress={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                >
                  <Text
                    style={[styles.optionText, active && styles.optionActive]}
                  >
                    {labelOf(id)}
                  </Text>
                  {active ? (
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={colors.vermilion}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  layout: {
    flex: 1,
    gap: spacing.md,
  },
  layoutWide: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  panel: {
    flex: 1,
  },
  label: {
    ...type.caption,
    marginBottom: spacing.xs,
  },
  select: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  selectText: {
    flex: 1,
    ...type.body,
    fontSize: 15,
  },
  area: {
    backgroundColor: colors.paperSunken,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 180,
    fontSize: 16,
    lineHeight: 26,
    color: colors.ink,
  },
  areaFill: {
    // 两栏等高：撑满各自面板剩下的高度，宽窄屏都不写死像素
    flex: 1,
  },
  areaContent: {
    paddingBottom: spacing.sm,
  },
  outputText: {
    fontSize: 16,
    lineHeight: 26,
    color: colors.ink,
  },
  outputHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  copy: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: spacing.xs,
  },
  copyText: {
    ...type.caption,
  },
  middle: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  middleWide: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  middleLabel: {
    ...type.small,
    marginBottom: spacing.xs,
  },
  niggahitaBox: {
    alignItems: "center",
  },
  pillRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  pill: {
    minWidth: 38,
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.paperSunken,
  },
  pillActive: {
    backgroundColor: colors.vermilion,
  },
  pillText: {
    fontSize: 15,
    color: colors.ink,
  },
  pillTextActive: {
    fontSize: 15,
    color: "#fdfaf1",
  },
  swap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.vermilion,
  },
  swapDisabled: {
    opacity: 0.35,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(30,24,16,0.35)",
  },
  sheet: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    top: "18%",
    maxHeight: "64%",
    backgroundColor: colors.paperRaised,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionText: {
    ...type.body,
  },
  optionActive: {
    color: colors.vermilion,
    fontWeight: "600",
  },
});
