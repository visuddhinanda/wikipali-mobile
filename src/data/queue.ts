/**
 * 同步队列（`sync_outbox`）写入助手。
 *
 * 设计（`docs/multi-user-sync.md` §5.5）：一条本地记录对应一行 outbox，`local_key` 唯一。
 * - `upsert`：该记录存在且待推送到服务器；
 * - `delete`：该记录已删除、待从服务器删除（仅 like 类有服务器删除接口）。
 *
 * **游客只在本地 db 记录，永远不与服务器同步**：因此游客身份下这三个函数都是 no-op，
 * 不产生任何 `sync_outbox` 条目。只有当身份是登录用户时才入队。
 *
 * 本地写操作与入队必须放在**同一个事务**里（`withReadingTransaction`），
 * 保证「本地状态」与「待同步状态」不会半途不一致。
 */
import type { SQLiteDatabase } from "expo-sqlite";
import { isLoggedIn } from "../user/userScope";

/** 是否入队：仅登录用户（游客永远不同步）。 */
function syncable(): boolean {
  return isLoggedIn();
}

export type SyncKind = "reading" | "favorite" | "bookmark" | "download";

/** 稳定的去重键：同一本地记录，多次 upsert/delete 只占一行。 */
export function localKey(
  kind: SyncKind,
  book: number,
  paragraph?: number,
  channel?: string,
): string {
  switch (kind) {
    case "reading":
    case "favorite":
      return `${kind}:${book}`;
    case "bookmark":
      return `${kind}:${book}-${paragraph ?? 0}`;
    case "download":
      return `${kind}:${channel ?? ""}-${book}`;
  }
}

/** 入队一条 upsert（存在待推送）。`serverId` 是此前同步回填的服务器 id。 */
export function outboxUpsert(
  db: SQLiteDatabase,
  key: string,
  kind: SyncKind,
  payload: Record<string, unknown>,
  serverId: string | null,
): Promise<unknown> {
  if (!syncable()) return Promise.resolve();
  return db.runAsync(
    `INSERT OR REPLACE INTO sync_outbox
       (local_key, kind, op, payload, server_id, created_at, attempts, last_error)
     VALUES (?, ?, 'upsert', ?, ?, ?, 0, NULL)`,
    [key, kind, JSON.stringify(payload), serverId, Date.now()],
  );
}

/** 入队一条 delete（已删除，待服务器删除）。 */
export function outboxDelete(
  db: SQLiteDatabase,
  key: string,
  kind: SyncKind,
  payload: Record<string, unknown>,
  serverId: string | null,
): Promise<unknown> {
  if (!syncable()) return Promise.resolve();
  return db.runAsync(
    `INSERT OR REPLACE INTO sync_outbox
       (local_key, kind, op, payload, server_id, created_at, attempts, last_error)
     VALUES (?, ?, 'delete', ?, ?, ?, 0, NULL)`,
    [key, kind, JSON.stringify(payload), serverId, Date.now()],
  );
}

/** 移除某条本地记录对应的待同步行（无服务器操作，如「清空阅读记录」）。 */
export function outboxRemove(db: SQLiteDatabase, key: string): Promise<unknown> {
  if (!syncable()) return Promise.resolve();
  return db.runAsync("DELETE FROM sync_outbox WHERE local_key = ?", [key]);
}
