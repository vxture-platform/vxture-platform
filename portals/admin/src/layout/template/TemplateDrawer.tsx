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
  /** 落地页；没有就渲染成不可点的一行（见 notificationCenterHref 的注释）。 */
  href?: string | undefined;
}

export interface TemplateDrawerProps {
  type: DrawerType;
  onClose: () => void;
  onNavigate: (href: string) => void;
  notifications: DrawerNotif[];
  /** 台账还没回来。与"回来了但是空"分开画，免得先闪一下空态。 */
  notificationsLoading?: boolean;
  /**
   * "前往消息中心"落到的完整台账页。**不给就不渲染那个按钮**——
   * admin 侧自 2026-09-08 起就是不给：完整台账页随治理平面 cutover（#121）
   * 迁去 arche 了，admin 里那个 `/notification-logs` 路由已不存在，
   * 按钮和每一行都还指着它（点了 404，直到 2026-09-08 走查才发现）。
   * 抽屉本身照常——看最近几条投递记录不需要落地页。
   */
  notificationCenterHref?: string | undefined;
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
          {notificationCenterHref ? (
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
          ) : null}
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
          {notifications.map((n) => {
            const href = n.href;
            /* 没有落地页就不做成按钮：不可点的东西长得像按钮（hover 变色、右侧
               箭头）是在骗人。整行降级成静态展示，箭头也一并撤掉。 */
            const Row = href ? "button" : "div";
            return (
              <Row
                key={n.id}
                {...(href
                  ? {
                      type: "button" as const,
                      onClick: () => {
                        onClose();
                        onNavigate(href);
                      },
                    }
                  : {})}
                className={
                  "flex w-full items-center gap-md rounded-lg p-md text-left" +
                  (href ? " transition-colors hover:bg-accent" : "")
                }
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
                {href ? (
                  <i
                    className="ph ph-caret-right shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  ></i>
                ) : null}
              </Row>
            );
          })}
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
