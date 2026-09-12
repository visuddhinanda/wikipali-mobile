/**
 * 定位失败的调试信息 —— 拼成一份可直接复制、贴进 issue 的纯文本。
 *
 * 收集的设备 / 系统 / 应用信息全部来自已在依赖里的 `expo-constants` 与
 * `react-native` 的 `Platform`，不新增原生依赖。报告用英文技术标签，
 * 因为它的去向是开发者看的 bug 单，而不是普通用户界面。
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import { getLocales } from "expo-localization";
import type { GpsResult } from "./gps";

function platformConstants(): Record<string, unknown> {
  return (Platform.constants ?? {}) as Record<string, unknown>;
}

function rnVersion(): string {
  const v = platformConstants().reactNativeVersion as
    | { major: number; minor: number; patch: number }
    | undefined;
  return v ? `${v.major}.${v.minor}.${v.patch}` : "unknown";
}

function line(key: string, value: unknown): string {
  const v = value === undefined || value === null ? "—" : String(value);
  return `${key}: ${v}`;
}

function coord(
  c: { latitude: number; longitude: number; accuracy: number | null } | null,
): string {
  if (!c) return "none";
  return `${c.latitude}, ${c.longitude}` + (c.accuracy != null ? ` ±${c.accuracy}m` : "");
}

/**
 * 组装报告正文。
 *
 * `result` 为定位函数刚返回的结果；`null` 表示在定位函数之外就失败了
 * （理论上不会发生，防御一下）。
 */
export function buildDiagnosticsReport(result: GpsResult | null): string {
  const pc = platformConstants();
  const d = result?.diagnostics;

  const sections: string[] = [];

  sections.push("=== WikiPali location debug report ===\n");

  sections.push(
    [
      "--- Device ---",
      line("deviceName", Constants.deviceName),
      line("manufacturer", pc.Manufacturer),
      line("brand", pc.Brand),
      line("model", pc.Model),
      line("device", pc.Device),
      line("yearClass", Constants.deviceYearClass),
      line("os", Platform.OS),
      line("osVersion", Platform.Version),
      line("osRelease", pc.Release),
      line("reactNative", rnVersion()),
      line("expoVersion", Constants.expoVersion),
      line("expoSdk", Constants.expoConfig?.sdkVersion),
      line("appName", Constants.expoConfig?.name),
      line("appVersion", Constants.expoConfig?.version),
      line("executionEnvironment", Constants.executionEnvironment),
      line("locale", getLocales().map((l) => l.languageTag).join(", ")),
      "",
    ].join("\n"),
  );

  if (d) {
    sections.push(
      [
        "--- Location module ---",
        line("nativeRegistered", d.nativeRegistered),
        line("moduleLoaded", d.moduleLoaded),
        line("permissionStatus", d.permissionStatus),
        line("permissionError", d.permissionError),
        "",
        "--- Last known position ---",
        line("coords", coord(d.lastKnown)),
        line("error", d.lastKnownError),
        "",
        "--- Current position ---",
        line("coords", coord(d.current)),
        line("error", d.currentError),
        line("attempts", d.attempts),
        line("retried", d.retried),
        line("timedOut", d.timedOut),
        line("elapsedMs", d.elapsedMs),
        "",
        line("failure", result?.failure ?? "none"),
        "",
      ].join("\n"),
    );
  } else {
    sections.push(`--- Location module ---\nno diagnostics available\n\n`);
  }

  return sections.join("\n").trimEnd() + "\n";
}
