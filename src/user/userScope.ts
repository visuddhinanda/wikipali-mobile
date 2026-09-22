/**
 * 当前用户作用域：决定 `reading.db3` 落在哪个用户子目录。
 *
 * - 未登录 → `guest`（设备 uuid，见 `deviceUuid.ts`）。
 * - 已登录 → `user`（`/auth/current` 返回的 `id` = user_uid，uuid）。
 *
 * 数据库层（`src/reading/db.ts`）订阅 `onScopeChange`，在用户切换时关闭旧连接、
 * 指向新库。设计见 `docs/multi-user-sync.md` §4。
 */
import { getDeviceUuid } from "./deviceUuid";

export type UserScope = {
  kind: "guest" | "user";
  /** 目录名用的 uuid：guest 是设备 uuid，user 是 user_uid。 */
  id: string;
};

let scope: UserScope = { kind: "guest", id: "" };
let ready: Promise<UserScope> | null = null;

const listeners = new Set<() => void>();

/** 当前作用域的同步快照（可能 id 尚为空，冷启动未解析完）。 */
export function currentScope(): UserScope {
  return scope;
}

/**
 * 解析当前作用域（游客则算/读设备 uuid，结果缓存）。
 * 登录用户的作用域由 `setUserScope` 设置后直接返回。
 */
export function resolveScope(): Promise<UserScope> {
  if (!ready) {
    ready = (async () => {
      if (scope.kind === "user" && scope.id) return scope;
      const id = await getDeviceUuid();
      scope = { kind: "guest", id };
      return scope;
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** 切换用户（登录 / 登出时由 auth 层调用）。 */
export function setUserScope(next: UserScope): void {
  const prev = scope;
  scope = next;
  ready = Promise.resolve(next);
  if (prev.id !== next.id || prev.kind !== next.kind) {
    for (const fn of listeners) fn();
  }
}

/** 订阅作用域变化，返回取消函数。 */
export function onScopeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 当前是否登录用户（同步；未解析完成前视为 guest）。 */
export function isLoggedIn(): boolean {
  return scope.kind === "user";
}
