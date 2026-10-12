/**
 * 下载调度决策自检（`src/reading/downloadPolicy.ts`，与 App 同一份实现）。
 *
 *   node scripts/check-download-queue.mjs
 *
 * 用内存里的一张「download_state」模拟调度器：入队 12 本 → 单写者逐本下 →
 * 切后台 / 断网 / 移动网络 / 等 Wi‑Fi / 失败退避 / 杀进程重启，逐项断言状态。
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { blocker, settle, pickNext, retryAt, afterFailure, SpeedMeter, estimateTotalBytes, RETRY_DELAYS_MS } =
  await import(join(root, "src/reading/downloadPolicy.ts"));

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failed++;
}

const ENV = { active: true, connected: true, cellular: false, cellularAllowed: false, autoOnWifi: true };

/** 一张 12 本的队列，全部 queued。 */
function freshQueue() {
  return Array.from({ length: 12 }, (_, i) => ({
    book: i + 1,
    status: "queued",
    reason: null,
    queuePos: i + 1,
    allowCellular: false,
    nextRetryAt: null,
  }));
}

/** 调度器一拍：归位 + 单写者补位（与 downloadManager.tickOnce 同逻辑）。 */
function tick(rows, env, now = 0) {
  for (const r of rows) {
    if (r.status === "downloading") {
      const b = blocker(r, env);
      if (b) Object.assign(r, { status: "waiting", reason: b });
      continue;
    }
    const next = settle(r, env, now);
    if (next) Object.assign(r, next);
  }
  if (!rows.some((r) => r.status === "downloading")) {
    const i = pickNext(rows, env);
    if (i >= 0) Object.assign(rows[i], { status: "downloading", reason: null });
  }
}
const count = (rows, status, reason) =>
  rows.filter((r) => r.status === status && (reason === undefined || r.reason === reason)).length;

// 1. 全部下载：12 本一次入队，单写者只跑 1 本，其余 11 本排队
let q = freshQueue();
tick(q, ENV);
check("入队 12 本：1 本下载中、11 本排队中", count(q, "downloading") === 1 && count(q, "queued") === 11);
check("先下 queue_pos 最小的", q[0].status === "downloading");

// 2. 下完一本自动接下一本
q[0].status = "done";
tick(q, ENV);
check("下完第 1 本自动接第 2 本", q[1].status === "downloading" && count(q, "downloading") === 1);

// 3. 切后台：在跑的 + 排队的都转 waiting/background；回前台全部恢复
tick(q, { ...ENV, active: false });
check("切后台：没有在跑的", count(q, "downloading") === 0);
check("切后台：10+1 本等待中·后台", count(q, "waiting", "background") === 11);
tick(q, ENV);
check("回前台：自动续上 1 本，其余排队", count(q, "downloading") === 1 && count(q, "queued") === 10);

// 4. 杀进程重启：对账 downloading → queued（不是 paused），再 tick 自动开跑
for (const r of q) if (r.status === "downloading") Object.assign(r, { status: "queued", reason: null });
tick(q, ENV);
check("杀进程重启：未完成的 11 本仍在队列并自动开跑", count(q, "downloading") === 1 && count(q, "queued") === 10 && count(q, "pending") === 0);

// 5. 断网 → 等待网络；恢复后自动继续
tick(q, { ...ENV, connected: false });
check("断网：全部等待网络", count(q, "waiting", "network") === 11);
tick(q, ENV);
check("网络恢复：自动继续", count(q, "downloading") === 1);

// 6. 移动网络 + 未允许：等 Wi‑Fi；allowCellular 的那本照常下
const CELL = { ...ENV, cellular: true };
q[5].allowCellular = true;
tick(q, CELL);
check("移动网络：未放行的等 Wi‑Fi", count(q, "waiting", "wifi") === 10);
check("移动网络：点过「立即下载」的那本照常下", q[5].status === "downloading");
q[5].status = "done";
tick(q, CELL);
check("放行的下完后不会接着用移动网络下别的", count(q, "downloading") === 0);

// 7. 连上 Wi‑Fi：自动下载开 → 恢复；关 → 停在 wifi_ready，等用户点开始
tick(q, { ...ENV, autoOnWifi: false });
check("自动下载关：连上 Wi‑Fi 停在「已连上 Wi‑Fi，点开始」", count(q, "waiting", "wifi_ready") === 10 && count(q, "downloading") === 0);
tick(q, { ...CELL, autoOnWifi: false });
check("wifi_ready 回到移动网络又变等 Wi‑Fi", count(q, "waiting", "wifi") === 10);
tick(q, ENV);
check("自动下载开：连上 Wi‑Fi 自动开始", count(q, "downloading") === 1);

// 8. 设置「使用移动网络下载」开：不再等 Wi‑Fi
tick(q, { ...CELL, cellularAllowed: true });
check("允许移动网络：移动网络下也照常下", count(q, "downloading") === 1 && count(q, "waiting", "wifi") === 0);

// 9. 用户暂停不受环境影响
const p = q.find((r) => r.status === "queued");
Object.assign(p, { status: "paused", reason: "user" });
tick(q, { ...ENV, active: false });
tick(q, ENV);
check("用户暂停：切后台 / 回前台都不自动恢复", p.status === "paused");

// 10. 失败退避：5s / 30s / 120s，第 4 次转 error
check("退避间隔 5s/30s/120s", RETRY_DELAYS_MS.join() === "5000,30000,120000");
check("第 1 次失败 5 秒后重试", retryAt(1, 1000) === 6000);
check("第 4 次失败不再重试", retryAt(4, 0) === null);
const r = { status: "waiting", reason: "retry", queuePos: 1, allowCellular: false, nextRetryAt: 6000 };
check("未到点：保持等待", settle(r, ENV, 5000) === null);
check("到点：回排队", settle(r, ENV, 6000)?.status === "queued");
check("退避中断网：显示等网络", settle(r, { ...ENV, connected: false }, 1000)?.reason === "network");

// 11. 失败后的落点：真没网才等网络；有网却连不上必须计失败，不能空转
check("系统没网的失败：等待网络、不计次数", (() => { const f = afterFailure(true, false, 0, 0); return f.status === "waiting" && f.reason === "network" && f.attempts === 0; })());
check("有网却连不上服务器：计一次失败、5 秒后重试", (() => { const f = afterFailure(true, true, 0, 1000); return f.reason === "retry" && f.attempts === 1 && f.nextRetryAt === 6000; })());
check("有网却连不上：settle 不会立刻把它排回队列", settle({ status: "waiting", reason: "retry", queuePos: 1, allowCellular: false, nextRetryAt: 6000 }, ENV, 1500) === null);
check("连续 3 次后第 4 次失败转 error", afterFailure(true, true, 3, 0).status === "error");
check("超时 / HTTP 错误同样走退避", afterFailure(false, true, 1, 0).nextRetryAt === 30000);

// 12. 测速与总量估算
const m = new SpeedMeter();
m.add(100_000, 0);
m.add(100_000, 1000);
m.add(100_000, 2000);
check("测速：约 150 KB/s 量级（EMA 平滑）", m.speed(2000) > 50_000 && m.speed(2000) < 400_000);
check("测速：超过窗口无新样本归零", m.speed(9000) === 0);
check("总量估算：1 MB / 100 段 × 300 段 ≈ 3 MB", estimateTotalBytes(1_000_000, 100, 300) === 3_000_000);
check("总量估算：没开工给 null", estimateTotalBytes(0, 0, 300) === null);

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
