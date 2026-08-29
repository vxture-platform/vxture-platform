"use client";

/* 通知抽屉：外壳走 DS Drawer（批 D——Radix 底座自带遮罩/Escape/动效/关闭钮，
 * 替代 shell-template 的 .drawer-* 手搓层）。宽度按 Drawer 的 panel 梯取 sm
 * （448px，原 400px 就近吸附）。
 *
 * 原先还兼做「系统设置」抽屉（2026-08-30 删）：那一支没有任何入口——header 的
 * 齿轮直接去 /settings——而它的四行值全是编出来的词条（会话超时 30 分钟、审计
 * 保留 180 天），与 /settings 的真实默认值还互相矛盾。
 *
 * 通知列表目前由调用方传空：没有消息源接进来之前，宁可空态也不放假消息。 */

import {
  Button,
  Drawer,
  toneSurfaceClasses,
  type Tone,
} from "@vxture/design-system";

export interface DrawerNotif {
  level: "danger" | "warning" | "info";
  icon: string;
  title: string;
  meta: string;
  href: string;
}

export interface TemplateDrawerProps {
  onClose: () => void;
  onNavigate: (href: string) => void;
  notifications: DrawerNotif[];
  labels: {
    title: string;
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
  onClose,
  onNavigate,
  notifications,
  labels,
}: TemplateDrawerProps) {
  return (
    <Drawer
      open
      onClose={onClose}
      side="right"
      width="sm"
      title={
        <span className="flex items-center gap-sm">
          <i className="ph ph-bell" aria-hidden="true"></i>
          {labels.title}
        </span>
      }
    >
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
    </Drawer>
  );
}
