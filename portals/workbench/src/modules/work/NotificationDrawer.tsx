"use client";

/**
 * Account notifications with explicit read actions and context-preserving details.
 * @package @vxture/workbench
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-06
 */
import { useWorkLocale } from "../../lib/locale";
import { useEffect, useRef, useState } from "react";
import { Button, Drawer } from "@vxture/design-system";
import { formatDateTime } from "@vxture-platform/shared";
import { loadInbox, markNotificationsRead } from "../../lib/api";
import { buildConsoleEntry, notificationEntry } from "../../lib/console-entry";
import type {
  LoadResult,
  WorkData,
  WorkInbox,
  WorkRuntime,
} from "../../lib/contracts";

// ============================================================================
// Requests are scoped to this mounted account/workspace and active drawer.
// ============================================================================
/**
 * Render the latest notifications without navigating on bell activation.
 * @param props - Verified display context and controlled visibility.
 * @returns One DS drawer with explicit loading, failure and empty states.
 */
export function NotificationDrawer({
  data,
  runtime,
  open,
  onClose,
}: {
  data: WorkData;
  runtime: WorkRuntime;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { locale, t } = useWorkLocale();
  const [result, setResult] = useState<LoadResult<WorkInbox> | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    controller.current = request;
    setResult(null);
    setBusy(false);
    setActionError("");
    void loadInbox(request.signal)
      .then((value) => {
        if (!request.signal.aborted) setResult(value);
      })
      .catch(() => {
        /* Cancellation does not replace the visible result. */
      });
    return () => {
      request.abort();
      controller.current = null;
    };
  }, [open, revision]);

  const markRead = async (id: string | null): Promise<void> => {
    const request = controller.current;
    if (!request || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await markNotificationsRead(id, request.signal);
      const next = await loadInbox(request.signal);
      if (!request.signal.aborted) setResult(next);
    } catch {
      if (!request.signal.aborted) setActionError("标记已读失败，请重试");
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };
  const inbox = result?.status === "ready" ? result.data : null;

  // ========================================================================
  // Content remains mounted unchanged throughout the DS exit animation.
  // ========================================================================
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="sm"
      className="max-w-full"
      title={t("工作通知")}
      description={t("最近消息与处理进展")}
      closeLabel={t("关闭通知")}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy || !inbox?.unreadCount}
            onClick={() => void markRead(null)}
          >
            {t("全部已读")}
          </Button>
          <Button variant="secondary" asChild>
            <a
              href={buildConsoleEntry(
                data,
                runtime.consoleUrl,
                "inbox",
                locale,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("查看全部")}
            </a>
          </Button>
        </>
      }
    >
      {result === null ? (
        <p role="status">{t("正在加载通知…")}</p>
      ) : result.status === "error" ? (
        <div role="alert" className="flex flex-col gap-md">
          <p>{t(result.message)}</p>
          <Button
            variant="secondary"
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("重新加载")}
          </Button>
        </div>
      ) : inbox?.items.length === 0 ? (
        <p role="status">{t("暂无通知")}</p>
      ) : (
        <ul className="flex flex-col gap-lg" aria-label={t("最近通知")}>
          {inbox?.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-sm border-b border-border pb-lg"
            >
              <div className="flex items-start justify-between gap-md">
                <h3 className="text-title-sm">{item.title}</h3>
                {!item.readAt && (
                  <span className="shrink-0 text-body-sm text-primary">
                    {t("未读")}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words text-body-sm text-muted-foreground">
                {item.body}
              </p>
              <time
                className="text-body-sm text-muted-foreground"
                dateTime={item.createdAt}
              >
                {formatDateTime(item.createdAt, locale)}
              </time>
              <div className="flex items-center justify-end gap-sm">
                {!item.readAt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void markRead(item.id)}
                    aria-label={t("标为已读：{0}", item.title)}
                  >
                    {t("标为已读")}
                  </Button>
                )}
                <Button size="sm" variant="secondary" asChild>
                  <a
                    href={notificationEntry(
                      data,
                      runtime.consoleUrl,
                      item.link,
                      locale,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("查看详情：{0}", item.title)}
                  >
                    {t("查看详情")}
                  </a>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {actionError && (
        <p role="alert" className="text-body-sm text-destructive">
          {t(actionError)}
        </p>
      )}
    </Drawer>
  );
}
