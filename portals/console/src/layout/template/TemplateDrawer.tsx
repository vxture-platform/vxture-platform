"use client";

/* 通知/系统信息抽屉：外壳走 DS Drawer（批 D——Radix 底座自带遮罩/Escape/
 * 动效/关闭钮，替代 shell-template 的 .drawer-* 手搓层）；设置行走
 * ShellPanelRow 只读态。通知内容为占位（demo）数据，待接真实消息中心。
 * 宽度按 Drawer 的 panel 梯取 sm（448px，原 400px 就近吸附）。 */

import {
  Button,
  Drawer,
  ShellPanelRow,
  toneSurfaceClasses,
  type Tone,
} from "@vxture/design-system";

export type DrawerType = "notifications" | "settings";

export interface DrawerNotif {
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
  settingsRows: Array<[string, string]>;
  labels: {
    notificationsTitle: string;
    settingsTitle: string;
    markAllRead: string;
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
            <Button variant="ghost" size="sm" onClick={() => {}}>
              <i className="ph ph-checks" aria-hidden="true"></i>
              {labels.markAllRead}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={labels.openCenter}
              aria-label={labels.openCenter}
              onClick={() => {}}
            >
              <i className="ph ph-arrow-square-out" aria-hidden="true"></i>
            </Button>
          </div>
          {notifications.map((n, i) => (
            <button
              key={i}
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
