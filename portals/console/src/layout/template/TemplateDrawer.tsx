"use client";

/* 1:1 转写自设计稿 shell.jsx Drawer / DrawerNotifications / DrawerSettings.
 * 通知/设置内容为占位（demo）数据，待接真实消息中心 / 系统设置。 */

import { useEffect } from "react";
import { toneSurfaceClasses, type Tone } from "@vxture/design-system";

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

/* The three tokens this used to reference (--vx-color-danger-600 /
 * -warning-500 / -info-600) do not exist in the design tokens, so the icon
 * colour and its tint both resolved to nothing. Use the DS tone helper, which
 * pairs a same-hue foreground with a same-hue muted surface — exactly what the
 * hand-rolled color-mix was approximating. */
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isNotif = type === "notifications";
  const title = isNotif ? labels.notificationsTitle : labels.settingsTitle;
  const icon = isNotif ? "ph-bell" : "ph-gear-six";

  return (
    <div className="drawer-layer">
      <div className="drawer-backdrop" onClick={onClose}></div>
      <aside
        className="drawer"
        role="dialog"
        aria-label={title}
        aria-modal="true"
      >
        <div className="drawer-hd">
          <div className="drawer-title">
            <i className={"ph " + icon}></i>
            {title}
          </div>
          <div className="drawer-actions">
            {isNotif && (
              <>
                <button className="drawer-act" onClick={() => {}}>
                  <i className="ph ph-checks"></i>
                  {labels.markAllRead}
                </button>
                <button
                  className="drawer-iconbtn"
                  title={labels.openCenter}
                  aria-label={labels.openCenter}
                  onClick={() => {}}
                >
                  <i className="ph ph-arrow-square-out"></i>
                </button>
              </>
            )}
            <button
              className="drawer-close"
              onClick={onClose}
              aria-label={labels.close}
            >
              <i className="ph ph-x"></i>
            </button>
          </div>
        </div>
        <div className="drawer-body">
          {isNotif ? (
            <div className="dn-list">
              {notifications.map((n, i) => (
                <button
                  key={i}
                  className="dn-item"
                  onClick={() => {
                    onClose();
                    onNavigate(n.href);
                  }}
                >
                  <span
                    className={`dn-ico ${toneSurfaceClasses[LEVEL_TONE[n.level]]}`}
                  >
                    <i className={"ph-fill " + n.icon}></i>
                  </span>
                  <span className="dn-text">
                    <span className="dn-title">{n.title}</span>
                    <span className="dn-meta">{n.meta}</span>
                  </span>
                  <i className="ph ph-caret-right dn-caret"></i>
                </button>
              ))}
            </div>
          ) : (
            <div className="ds-list">
              {settingsRows.map(([k, v]) => (
                <div className="ds-row" key={k}>
                  <span className="ds-key">{k}</span>
                  <span className="ds-val">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
