/**
 * 全局登录状态。
 *
 * 冷启动流程：读本地 token → 有则先用缓存的用户信息渲染（避免闪「未登录」）
 * → 后台向 `/auth/current` 校验；校验失败（token 过期 / 被吊销）即清会话。
 *
 * 多用户：登录/登出会切换「用户作用域」（`src/user/userScope.ts`），
 * 使 `reading.db3` 指向该用户自己的子目录；登录后询问是否合并游客数据并触发同步。
 * 设计见 `docs/multi-user-sync.md` §4 / §8.4。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Alert, AppState } from "react-native";
import { fetchCurrentUser, signIn as apiSignIn } from "../api/auth";
import { ApiError } from "../api/client";
import { setUserScope } from "../user/userScope";
import { getDeviceUuid } from "../user/deviceUuid";
import { migrateLegacyAsyncStorage } from "../data/migrate";
import {
  guestHasData,
  guestMergedFor,
  mergeGuestIntoUser,
  pullReactions,
  pullReadingHistory,
  syncNow,
} from "../data/sync";
import { t } from "../i18n";
import {
  clearSession,
  loadToken,
  loadUser,
  saveToken,
  saveUser,
  type AuthUser,
} from "./session";

interface AuthState {
  /** 会话恢复中（冷启动首帧为 true）。 */
  restoring: boolean;
  token: string | null;
  user: AuthUser | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/** 登录成功后的异步收尾：合并询问 + 拉取 + 推送。 */
async function afterSignIn(userId: string): Promise<void> {
  // 未合并过游客数据、且游客有数据 → 询问是否合并。
  try {
    if (!(await guestMergedFor(userId)) && (await guestHasData())) {
      Alert.alert(t("sync.mergeTitle"), t("sync.mergeMessage"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("sync.mergeSkip") },
        {
          text: t("sync.mergeConfirm"),
          onPress: () => {
            void mergeGuestIntoUser(userId)
              .then(() => syncNow())
              .catch(() => {
                /* 合并失败不影响登录态 */
              });
          },
        },
      ]);
    }
  } catch {
    /* 合并检查失败不阻断登录 */
  }
  // 拉取服务器阅读记录（较新者胜）、下拉收藏/书签/下载（反查还原），再推送本地待同步项。
  void pullReadingHistory(userId).catch(() => {
    /* 离线时留到下次 */
  });
  void pullReactions().catch(() => {
    /* 离线或反查接口缺失时留到下次 */
  });
  void syncNow();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [restoring, setRestoring] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let alive = true;
    // 一次性把旧的 AsyncStorage 行为数据搬进游客库（docs/multi-user-sync.md §9）。
    void migrateLegacyAsyncStorage().catch(() => {
      /* 迁移失败不阻断启动，下次再试 */
    });
    (async () => {
      const saved = await loadToken();
      if (!alive) return;
      if (!saved) {
        setRestoring(false);
        return;
      }
      setToken(saved);
      const cached = await loadUser();
      if (alive && cached) setUser(cached);
      setRestoring(false);

      try {
        const fresh = await fetchCurrentUser(saved);
        if (!alive) return;
        setUser(fresh);
        await saveUser(fresh);
        void syncNow();
      } catch (err) {
        // 网络不可达时保留本地会话，只有服务端明确拒绝才登出。
        if (err instanceof ApiError && err.status === undefined && !cached) {
          return;
        }
        if (!alive) return;
        await clearSession();
        setToken(null);
        setUser(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 用户状态 → 用户作用域：登录切到 <user.id>，登出回到 <guest>。
  useEffect(() => {
    if (restoring) return;
    if (user?.id) {
      setUserScope({ kind: "user", id: user.id });
    } else {
      void getDeviceUuid().then((id) => setUserScope({ kind: "guest", id }));
    }
  }, [user, restoring]);

  // 回到前台且已登录时，补推一次待同步项。
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && user?.id) void syncNow();
    });
    return () => sub.remove();
  }, [user]);

  const signIn = useCallback(async (username: string, password: string) => {
    const fresh = await apiSignIn(username, password);
    await saveToken(fresh);
    setToken(fresh);
    const me = await fetchCurrentUser(fresh);
    setUser(me);
    await saveUser(me);
    setUserScope({ kind: "user", id: me.id });
    void afterSignIn(me.id);
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setToken(null);
    setUser(null);
    void getDeviceUuid().then((id) => setUserScope({ kind: "guest", id }));
  }, []);

  const value = useMemo<AuthState>(
    () => ({ restoring, token, user, signIn, signOut }),
    [restoring, token, user, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
