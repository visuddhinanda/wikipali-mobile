import React, { useCallback, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { useT } from "../i18n/I18nContext";
import { colors, radius, spacing, type } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { parseWikipaliUrl, readerRouteParams } from "../linking/wikipali-url";

type Props = NativeStackScreenProps<RootStackParamList, "Scan">;

/**
 * 二维码扫描：认 WikiPali 网页链接，直接跳到对应阅读界面。
 *
 * 只在本页做「扫到 → 解析 → 跳转」，链接语义都在 `src/linking/wikipali-url.ts`，
 * 与外部分享进来的链接共用同一份解析。
 */
export function ScanScreen({ navigation }: Props) {
  const t = useT();
  const [permission, requestPermission] = useCameraPermissions();
  // 相机会连续回调同一个码，扫到第一个之后就别再处理了。
  const handled = useRef(false);
  const [scanning, setScanning] = useState(true);

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      if (handled.current) return;
      const target = parseWikipaliUrl(data);
      if (!target) {
        handled.current = true;
        setScanning(false);
        Alert.alert(t("scan.unknownTitle"), `${t("scan.unknownBody")}\n\n${data}`, [
          {
            text: t("common.ok"),
            onPress: () => {
              handled.current = false;
              setScanning(true);
            },
          },
        ]);
        return;
      }
      handled.current = true;
      setScanning(false);
      navigation.replace("Reader", readerRouteParams(target));
    },
    [navigation, t],
  );

  if (!permission) return <Screen scroll={false}>{null}</Screen>;

  if (!permission.granted) {
    return (
      <Screen contentStyle={styles.center}>
        <Text style={styles.permTitle}>{t("scan.permissionTitle")}</Text>
        <Text style={styles.permBody}>{t("scan.permissionBody")}</Text>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonText}>{t("scan.grant")}</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanning ? onScanned : undefined}
      />
      <View pointerEvents="none" style={styles.overlay}>
        <View style={styles.frame} />
        <Text style={styles.hint}>{t("scan.hint")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#000" },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: colors.paperRaised,
    borderRadius: radius.md,
    backgroundColor: "transparent",
  },
  hint: {
    ...type.body,
    marginTop: spacing.lg,
    color: colors.paperRaised,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  center: { alignItems: "center", justifyContent: "center", paddingTop: spacing.xl },
  permTitle: { ...type.title, marginBottom: spacing.sm },
  permBody: {
    ...type.body,
    color: colors.inkFaint,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  button: {
    backgroundColor: colors.vermilion,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  buttonText: { ...type.body, color: colors.paperRaised, fontWeight: "600" },
});
