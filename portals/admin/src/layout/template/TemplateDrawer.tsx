"use client";

/* 通知/系统信息抽屉：外壳走 DS Drawer（批 D——Radix 底座自带遮罩/Escape/
 * 动效/关闭钮，替代 shell-template 的 .drawer-* 手搓层）；设置行走
 * ShellPanelRow 只读态。通知条目由外壳从投递台账喂进来（AdminAppShell），
 * 这里只画：读取中 / 空态 / 列表三态。原先的"全部已读"按钮随演示数据一起
 * 摘掉——台账没有已读态，一个 onClick 空函数的按钮只是在假装有（2026-08-30）。
 * 宽度按 Drawer 的 panel 梯取 sm（448px，原 400px 就近吸附）。 */

import {
  Button,
  Drawer,
  EmptyState,
  ShellPanelRow,
  toneSurfaceClasses,
  type Tone,
} from "@vxture/design-system";

export type DrawerType = "notifications" | "settings";

export interface DrawerNotif {
  id: string;
  level: "danger" | "warning" | "info";
  icon: string;
  title: string;
  meta: string;
  href: string;
}

export interface TemplateDrawerProps {
  type: DrawerType;
  onClose: () => void;
  onNavigate: (href: string) => void;
  notifications: DrawerNotif[];
  /** 台账还没回来。与"回来了但是空"分开画，免得先闪一下空态。 */
  notificationsLoading?: boolean;
  /** "前往消息中心"落到的完整台账页。 */
  notificationCenterHref: string;
  settingsRows: Array<[string, string]>;
  labels: {
    notificationsTitle: string;
    settingsTitle: string;
    loading: string;
    emptyTitle: string;
    emptyDescription: string;
    openCenter: string;
    close: string;
  };
}

const LEVEL_TONE: Record<DrawerNotif["level"], Tone> = {
  danger: "danger",
  warning: "warning",
  info: "info",
};

export function TemplateDrawer({
  type,
  onClose,
  onNavigate,
  notifications,
  notificationsLoading = false,
  notificationCenterHref,
  settingsRows,
  labels,
}: TemplateDrawerProps) {
  const isNotif = type === "notifications";
  const title = isNotif ? labels.notificationsTitle : labels.settingsTitle;
  const icon = isNotif ? "ph-bell" : "ph-gear-six";

  return (
    <Drawer
      open
      onClose={onClose}
      side="right"
      width="sm"
      title={
        <span className="flex items-center gap-sm">
          <i className={"ph " + icon} aria-hidden="true"></i>
          {title}
        </span>
      }
    >
      {isNotif ? (
        <div className="flex flex-col gap-xs">
          <div className="flex items-center justify-end gap-2xs">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onClose();
                onNavigate(notificationCenterHref);
              }}
            >
              <i className="ph ph-arrow-square-out" aria-hidden="true"></i>
              {labels.openCenter}
            </Button>
          </div>
          {notificationsLoading ? (
            <p className="p-md text-body-sm text-muted-foreground">
              {labels.loading}
            </p>
          ) : notifications.length === 0 ? (
            <EmptyState
              title={labels.emptyTitle}
              description={labels.emptyDescription}
            />
          ) : null}
          {notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              className="flex w-full items-center gap-md rounded-lg p-md text-left transition-colors hover:bg-accent"
              onClick={() => {
                onClose();
                onNavigate(n.href);
              }}
            >
              <span
                className={`inline-flex size-icon-xl shrink-0 items-center justify-center rounded-lg ${toneSurfaceClasses[LEVEL_TONE[n.level]]}`}
              >
                <i className={"ph-fill " + n.icon} aria-hidden="true"></i>
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                <span className="truncate text-label-md font-semibold text-foreground">
                  {n.title}
                </span>
                <span className="truncate text-body-sm text-muted-foreground">
                  {n.meta}
                </span>
              </span>
              <i
                className="ph ph-caret-right shrink-0 text-muted-foreground"
                aria-hidden="true"
              ></i>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col">
          {settingsRows.map(([k, v]) => (
            <ShellPanelRow key={k} label={k} value={v} />
          ))}
        </div>
      )}
    </Drawer>
  );
}
