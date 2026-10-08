/**
 * 全局登录状态。
 *
 * 冷启动流程：读本地 token → 有则先用缓存的用户信息渲染（避免闪「未登录」）
 * → 后台向 `/auth/current` 校验：只有服务端明确拒绝（token 过期 / 被吊销）才清会话；
 * 断网 / 超时 / 服务故障保留会话，等回到前台时再校验（`isTokenRejected`）。
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
  useRef,
  useState,
} from "react";
import { Alert, AppState } from "react-native";
import { fetchCurrentUser, isTokenRejected, signIn as apiSignIn } from "../api/auth";
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
import { pauseAllDownloads, reconcileDownloads } from "../reading";
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
  const [token, setTokenState] = useState<string | null>(null);
  /** 当前会话 token 的同步副本：异步校验回来时据此判断会话是否已被换掉（登出/换号）。 */
  const tokenRef = useRef<string | null>(null);
  const setToken = useCallback((next: string | null) => {
    tokenRef.current = next;
    setTokenState(next);
  }, []);
  const [user, setUser] = useState<AuthUser | null>(null);
  /** 有 token 但还没跟服务端确认过（冷启动校验时连不上），回到前台时再校验。 */
  const unverifiedToken = useRef<string | null>(null);
  const alive = useRef(true);

  /** 向服务端确认会话：成功刷新用户，明确被拒则登出，连不上则保留会话稍后重试。 */
  const verifySession = useCallback(async (saved: string) => {
    // 校验期间用户登出或换了号：结果作废，别把旧会话写回来。
    const stale = () => !alive.current || tokenRef.current !== saved;
    try {
      const fresh = await fetchCurrentUser(saved);
      if (stale()) return;
      unverifiedToken.current = null;
      setUser(fresh);
      await saveUser(fresh);
      void syncNow();
    } catch (err) {
      if (stale()) return;
      if (!isTokenRejected(err)) {
        unverifiedToken.current = saved;
        return;
      }
      unverifiedToken.current = null;
      await clearSession();
      setToken(null);
      setUser(null);
    }
  }, [setToken]);

  useEffect(() => {
    alive.current = true;
    // 一次性把旧的 AsyncStorage 行为数据搬进游客库（docs/multi-user-sync.md §9）。
    void migrateLegacyAsyncStorage().catch(() => {
      /* 迁移失败不阻断启动，下次再试 */
    });
    (async () => {
      const saved = await loadToken();
      if (!alive.current) return;
      if (!saved) {
        setRestoring(false);
        return;
      }
      setToken(saved);
      const cached = await loadUser();
      if (alive.current && cached) setUser(cached);
      setRestoring(false);
      await verifySession(saved);
    })();
    return () => {
      alive.current = false;
    };
  }, [setToken, verifySession]);

  // 用户状态 → 用户作用域：登录切到 <user.id>，登出回到 <guest>。
  useEffect(() => {
    if (restoring) return;
    if (user?.id) {
      setUserScope({ kind: "user", id: user.id });
    } else {
      void getDeviceUuid().then((id) => setUserScope({ kind: "guest", id }));
    }
  }, [user, restoring]);

  // 冷启动：作用域解析完后对账一次（残留 downloading→paused）。
  const resumed = useRef(false);
  useEffect(() => {
    if (restoring || resumed.current) return;
    resumed.current = true;
    void reconcileDownloads().catch(() => {
      /* 对账失败不影响启动，下次下载时自愈 */
    });
  }, [restoring]);

  // 回到前台：冷启动没校验成的会话再校验一次；已登录则补推一次待同步项。
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (unverifiedToken.current) void verifySession(unverifiedToken.current);
      else if (user?.id) void syncNow();
    });
    return () => sub.remove();
  }, [user, verifySession]);

  const signIn = useCallback(async (username: string, password: string) => {
    const fresh = await apiSignIn(username, password);
    await saveToken(fresh);
    unverifiedToken.current = null;
    setToken(fresh);
    const me = await fetchCurrentUser(fresh);
    await saveUser(me);
    // 先暂停游客仍在跑/排队的下载（此刻作用域仍为 guest），再切到登录用户。
    await pauseAllDownloads();
    setUser(me);
    setUserScope({ kind: "user", id: me.id });
    void afterSignIn(me.id);
  }, [setToken]);

  const signOut = useCallback(async () => {
    unverifiedToken.current = null;
    await clearSession();
    // 先暂停该账号仍在跑/排队的下载（此刻作用域仍为该用户），再切回游客。
    await pauseAllDownloads();
    setToken(null);
    setUser(null);
    void getDeviceUuid().then((id) => setUserScope({ kind: "guest", id }));
  }, [setToken]);

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
