/**
 * 时刻倒计时：临近明相 / 日中 / 日落时给出 `1:32:53`。
 *
 * 只在两小时以内显示 —— 再早没有意义，反而让三个数字互相抢注意力。
 */

export const COUNTDOWN_WINDOW_MS = 2 * 3600_000;

/** `h:mm:ss`；不在窗口内（已过、或还早）返回 null。 */
export function countdownTo(target: Date | null, now: Date): string | null {
  if (!target) return null;
  const left = target.getTime() - now.getTime();
  if (left <= 0 || left > COUNTDOWN_WINDOW_MS) return null;
  const total = Math.floor(left / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
