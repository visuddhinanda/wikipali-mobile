import React from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { useAuth } from "../auth/AuthContext";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { restoring, user, signOut } = useAuth();

  function confirmSignOut() {
    Alert.alert("退出登录", "退出后将无法同步书架与提问历史。", [
      { text: "取消", style: "cancel" },
      {
        text: "退出",
        style: "destructive",
        onPress: () => void signOut(),
      },
    ]);
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.hero}>
        {user?.avatar ? (
          <Image source={{ uri: user.avatar }} style={styles.avatar} />
        ) : (
          <View style={styles.avatar}>
            <Ionicons name="person" size={40} color={colors.paperRaised} />
          </View>
        )}

        {restoring ? (
          <ActivityIndicator color={colors.vermilion} />
        ) : user ? (
          <>
            <Text style={styles.title}>
              {user.nickName || user.realName || user.id}
            </Text>
            <Text style={styles.subtitle}>已登录</Text>
            <Pressable style={styles.logoutBtn} onPress={confirmSignOut}>
              <Text style={styles.logoutBtnText}>退出登录</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>尚未登录</Text>
            <Text style={styles.subtitle}>登录后同步书架、进度与提问历史</Text>
            <Pressable
              style={styles.loginBtn}
              onPress={() => navigation.navigate("SignIn")}
            >
              <Text style={styles.loginBtnText}>登录 / 注册</Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={styles.divider} />

      <Pressable
        style={styles.row}
        onPress={() => navigation.navigate("NewChat")}
      >
        <Ionicons name="chatbubble-outline" size={20} color={colors.inkSoft} />
        <Text style={styles.rowLabel}>我的提问历史</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
      </Pressable>

      <Pressable
        style={styles.row}
        onPress={() => navigation.navigate("Settings")}
      >
        <Ionicons name="settings-outline" size={20} color={colors.inkSoft} />
        <Text style={styles.rowLabel}>设置</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
      </Pressable>

      {/* 仅开发构建可见：实时查看响应式断点判定（DESIGN.md §4.9） */}
      {__DEV__ ? (
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate("DebugLayout")}
        >
          <Ionicons name="bug-outline" size={20} color={colors.inkSoft} />
          <Text style={styles.rowLabel}>布局调试</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.xl,
  },
  hero: {
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.ochre,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: {
    ...type.title,
  },
  subtitle: {
    ...type.caption,
    textAlign: "center",
  },
  loginBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.vermilion,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  logoutBtn: {
    marginTop: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  logoutBtnText: {
    color: colors.inkSoft,
    fontWeight: "600",
    fontSize: 15,
  },
  loginBtnText: {
    color: colors.paperRaised,
    fontWeight: "600",
    fontSize: 15,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginBottom: spacing.md,
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
  rowLabel: {
    flex: 1,
    ...type.body,
  },
});
