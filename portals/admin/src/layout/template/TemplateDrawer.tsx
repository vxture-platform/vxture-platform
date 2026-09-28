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
  ShellPanelSection,
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
  /**
   * 点开这一行（走 `href`）**之前**做一件事，典型是把它标成已读（2026-09-28）。
   *
   * 为什么在这里而不是让外壳去猜：点进去这个动作只有本件知道发生了。外壳能看到的
   * 只有 `onNavigate(href)`，而 href 不是行的身份——两条通告可以指向同一个订单，
   * 按 href 反查会把没点的那条也一起标掉。
   *
   * 只有可点的行会调到它：不可点的行整行降级成静态展示，没有「点开」这回事。
   */
  onActivate?: (() => void) | undefined;
}

/**
 * 抽屉里的一段（2026-09-28）：运营通告在前、投递日志在后，各有标题、空态与去处。
 * 段本身不做数据，行由外壳喂进来——与单段时的 `notifications` 同一形状。
 */
export interface DrawerNotifSection {
  key: string;
  title: string;
  items: DrawerNotif[];
  /** 还没回来。与"回来了但是空"分开画。 */
  loading?: boolean | undefined;
  emptyTitle: string;
  emptyDescription?: string | undefined;
  /**
   * 段首的按钮们（如「全部标记已读」、「查看全部」）；不给就没有按钮。
   *
   * 原来只收一个 `action`（一个 href）。一个段要同时给「去别处」和「就地做一件事」
   * 两个按钮，所以改成列表，并且分成两种：`href` 的点了关抽屉再跳；`onClick` 的
   * **不关抽屉**——标记已读之后这一段要当场刷新给人看见，关掉就什么也看不到了。
   */
  actions?: readonly DrawerNotifSectionAction[] | undefined;
}

/** 段首一个按钮。`href` 与 `onClick` 二选一：前者是去处，后者是动作。 */
export interface DrawerNotifSectionAction {
  readonly key: string;
  readonly label: string;
  /** Phosphor 类名；与行图标同一套。不给就只有文字。 */
  readonly icon?: string | undefined;
  readonly href?: string | undefined;
  readonly onClick?: (() => void) | undefined;
  /** 在办中：按钮禁用，免得连按两次发两个请求。 */
  readonly disabled?: boolean | undefined;
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
  /**
   * 排在 `notifications` **前面**的段（运营通告）。给了它，`notifications` 那一段
   * 也会带上 `notificationsTitle` 作小标题，两段之间画分隔线。
   */
  sections?: DrawerNotifSection[] | undefined;
  /** `notifications` 那一段的小标题（「投递日志」）；只在有 `sections` 时显示。 */
  notificationsTitle?: string | undefined;
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

/** 一段的三态：读取中 / 空 / 列表。两段（通告、投递日志）共用，行的画法只有一份。 */
function NotifRows({
  items,
  loading,
  loadingLabel,
  emptyTitle,
  emptyDescription,
  onClose,
  onNavigate,
}: {
  items: DrawerNotif[];
  loading: boolean;
  loadingLabel: string;
  emptyTitle: string;
  emptyDescription?: string | undefined;
  onClose: () => void;
  onNavigate: (href: string) => void;
}) {
  return (
    <>
      {loading ? (
        <p className="p-md text-body-sm text-muted-foreground">
          {loadingLabel}
        </p>
      ) : items.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : null}
      {items.map((n) => {
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
                    /* 先标已读再跳：跳走之后这一段就卸载了，放在后面等于不做。
                       标记本身是乐观的（外壳先改本地态再发请求），所以它不会
                       让这一下点击变慢。 */
                    n.onActivate?.();
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
    </>
  );
}

export function TemplateDrawer({
  type,
  onClose,
  onNavigate,
  notifications,
  notificationsLoading = false,
  notificationCenterHref,
  sections,
  notificationsTitle,
  settingsRows,
  labels,
}: TemplateDrawerProps) {
  const hasSections = (sections?.length ?? 0) > 0;
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
          {(sections ?? []).map((section, index) => {
            const actions = section.actions ?? [];
            return (
              <ShellPanelSection
                key={section.key}
                title={section.title}
                divided={index > 0}
              >
                {actions.length > 0 ? (
                  <div className="flex items-center justify-end gap-2xs">
                    {actions.map((action) => (
                      <Button
                        key={action.key}
                        variant="ghost"
                        size="sm"
                        disabled={action.disabled ?? false}
                        onClick={() => {
                          /* 有 href 的是去处：关抽屉再跳。只有 onClick 的是就地
                             动作：抽屉留着，人要看见这一段跟着变了。 */
                          if (action.href) {
                            onClose();
                            onNavigate(action.href);
                            return;
                          }
                          action.onClick?.();
                        }}
                      >
                        {action.icon ? (
                          <i
                            className={"ph " + action.icon}
                            aria-hidden="true"
                          ></i>
                        ) : null}
                        {action.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <NotifRows
                  items={section.items}
                  loading={section.loading ?? false}
                  loadingLabel={labels.loading}
                  emptyTitle={section.emptyTitle}
                  emptyDescription={section.emptyDescription}
                  onClose={onClose}
                  onNavigate={onNavigate}
                />
              </ShellPanelSection>
            );
          })}
          <ShellPanelSection
            {...(hasSections && notificationsTitle
              ? { title: notificationsTitle }
              : {})}
            divided={hasSections}
          >
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
            <NotifRows
              items={notifications}
              loading={notificationsLoading}
              loadingLabel={labels.loading}
              emptyTitle={labels.emptyTitle}
              emptyDescription={labels.emptyDescription}
              onClose={onClose}
              onNavigate={onNavigate}
            />
          </ShellPanelSection>
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
