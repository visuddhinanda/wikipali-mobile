/**
 * 发起下载的统一入口（单本按钮 / 频道页「全部下载」都走这里）：
 * 需要时弹确认面板，再把书交给调度器入队。规则见 `docs/download-manager.md` §8.5。
 */
import { enqueueDownloads, shouldAskCellular, type EnqueueItem } from "../reading";
import { getDownloadSettings, setDownloadSettings } from "../settings/download";
import { t } from "../i18n";
import { askDownload } from "./DownloadPromptHost";
import { toast } from "./toast";

/**
 * @returns 是否入队了（用户取消返回 false）。
 */
export async function requestDownload(
  items: EnqueueItem[],
  opts: { title?: string; batch?: boolean; skipped?: number } = {},
): Promise<boolean> {
  if (items.length === 0) return false;
  const cellular = shouldAskCellular();
  const batchId = opts.batch ? `b${Date.now()}` : undefined;

  // Wi‑Fi（或已允许移动网络）下点单本：直接入队，不打扰。
  if (!cellular && !opts.batch) {
    await enqueueDownloads(items);
    return true;
  }

  const choice = await askDownload({
    count: items.length,
    skipped: opts.skipped,
    title: opts.title,
    cellular,
  });
  switch (choice.kind) {
    case "cancel":
      return false;
    case "start":
      await enqueueDownloads(items, { batchId });
      return true;
    case "now":
      if (choice.dontAsk) {
        await setDownloadSettings({ cellularAllowed: true });
        toast(t("download.cellular.enabledToast"));
      }
      await enqueueDownloads(items, { batchId, allowCellular: true });
      return true;
    case "wifi":
      await enqueueDownloads(items, { batchId });
      toast(
        t(
          getDownloadSettings().autoOnWifi
            ? "download.cellular.queuedToast"
            : "download.cellular.queuedManualToast",
        ),
      );
      return true;
  }
}
