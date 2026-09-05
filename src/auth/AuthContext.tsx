/**
 * 全局登录状态。
 *
 * 冷启动流程：读本地 token → 有则先用缓存的用户信息渲染（避免闪「未登录」）
 * → 后台向 `/auth/current` 校验；校验失败（token 过期 / 被吊销）即清会话。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { fetchCurrentUser, signIn as apiSignIn } from "../api/auth";
import { ApiError } from "../api/client";
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [restoring, setRestoring] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let alive = true;
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

  const signIn = useCallback(async (username: string, password: string) => {
    const fresh = await apiSignIn(username, password);
    await saveToken(fresh);
    setToken(fresh);
    const me = await fetchCurrentUser(fresh);
    setUser(me);
    await saveUser(me);
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setToken(null);
    setUser(null);
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
