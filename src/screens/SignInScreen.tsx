/**
 * 登录页（对应 Web 端 `dashboard-v6/src/components/users/SignIn.tsx`）。
 *
 * 表单只有「用户名 / 邮箱 + 密码」两项，校验规则与 Web 端一致（4–255 / 4–32）。
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";
import { useAuth } from "../auth/AuthContext";
import { useT } from "../i18n/I18nContext";

export function SignInScreen() {
  const navigation = useNavigation();
  const { signIn } = useAuth();
  const t = useT();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const name = username.trim();
  const pwd = password.trim();
  const valid =
    name.length >= 4 && name.length <= 255 && pwd.length >= 4 && pwd.length <= 32;

  async function onSubmit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await signIn(name, pwd);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("signIn.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen contentStyle={styles.content}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {error ? (
          <View style={styles.alert}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.alertText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>{t("signIn.username")}</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          maxLength={255}
          placeholder={t("signIn.usernamePlaceholder")}
          placeholderTextColor={colors.inkFaint}
          returnKeyType="next"
        />

        <Text style={styles.label}>{t("signIn.password")}</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={secure}
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            maxLength={32}
            placeholder={t("signIn.passwordPlaceholder")}
            placeholderTextColor={colors.inkFaint}
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />
          <Pressable
            style={styles.eye}
            onPress={() => setSecure((v) => !v)}
            hitSlop={8}
          >
            <Ionicons
              name={secure ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={colors.inkSoft}
            />
          </Pressable>
        </View>

        <Pressable
          style={[styles.submit, (!valid || busy) && styles.submitDisabled]}
          onPress={onSubmit}
          disabled={!valid || busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.paperRaised} />
          ) : (
            <Text style={styles.submitText}>{t("signIn.submit")}</Text>
          )}
        </Pressable>

        <Text style={styles.hint}>{t("signIn.serverHint")}</Text>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.xl,
  },
  alert: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#f8e7e4",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  alertText: {
    flex: 1,
    ...type.caption,
    color: colors.danger,
  },
  label: {
    ...type.caption,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.paperSunken,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    fontSize: 16,
    color: colors.ink,
  },
  passwordRow: {
    position: "relative",
    justifyContent: "center",
  },
  passwordInput: {
    paddingRight: spacing.xxl + spacing.sm,
  },
  eye: {
    position: "absolute",
    right: spacing.md,
    // 输入框下方有 marginBottom，图标要跟着上移同样的量才居中
    top: 0,
    bottom: spacing.lg,
    justifyContent: "center",
  },
  submit: {
    backgroundColor: colors.vermilion,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  submitDisabled: {
    opacity: 0.45,
  },
  submitText: {
    color: colors.paperRaised,
    fontWeight: "600",
    fontSize: 16,
  },
  hint: {
    ...type.small,
    textAlign: "center",
    marginTop: spacing.lg,
  },
});
