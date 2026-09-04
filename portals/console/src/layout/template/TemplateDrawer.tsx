"use client";

/* 通知抽屉:外壳走 DS Drawer(批 D——Radix 底座自带遮罩/Escape/动效/关闭钮,
 * 替代 shell-template 的 .drawer-* 手搓层)。宽度按 Drawer 的 panel 梯取 sm
 * (448px,原 400px 就近吸附)。
 *
 * 原先还兼做「系统设置」抽屉(2026-08-30 删):那一支没有任何入口——header 的
 * 齿轮直接去 /settings——而它的四行值全是编出来的词条(会话超时 30 分钟、审计
 * 保留 180 天),与 /settings 的真实默认值还互相矛盾。
 *
 * 消息源 = 站内收件箱(product_330 P2-g,console-bff /api/me/inbox):调用方喂最近几条,
 * 「全部已读」与「前往消息中心」由调用方接实现;空态是真实的"没有消息"。
 *
 * 批 4:图标改走 DS `Icon`(此前是 Phosphor 字体类 `ph-fill ph-*`,而 console 只挂了
 * regular / bold 两套字体,fill 那套从来没加载——图标位一直是空的);「全部已读」
 * 按**整个收件箱**的未读数启用(此前按抽屉里那几条算,而抽屉一打开就把展示出来的
 * 逐条标已读,按钮永远是灰的)。 */

import {
  Button,
  Drawer,
  Icon,
  toneSurfaceClasses,
  type IconName,
  type Tone,
} from "@vxture/design-system";

export interface DrawerNotif {
  level: "danger" | "warning" | "info";
  icon: IconName;
  title: string;
  meta: string;
  href: string;
  unread?: boolean;
}

/** 待办(批 4b):派生自真实业务状态,置顶、无已读,带「去处理」。 */
export interface DrawerTodo {
  key: string;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
}

export interface TemplateDrawerProps {
  onClose: () => void;
  onNavigate: (href: string) => void;
  onMarkAllRead?: () => void;
  /** 整个收件箱还有没有未读(抽屉只展示最近几条,不能拿它们判断)。 */
  canMarkAllRead?: boolean;
  onOpenCenter?: () => void;
  todos?: DrawerTodo[];
  notifications: DrawerNotif[];
  labels: {
    title: string;
    markAllRead: string;
    openCenter: string;
    close: string;
    empty?: string;
    todosTitle?: string;
    messagesTitle?: string;
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
  onMarkAllRead,
  canMarkAllRead = false,
  onOpenCenter,
  todos = [],
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
          <Icon name="bell" size="sm" fallback="info" aria-hidden="true" />
          {labels.title}
        </span>
      }
    >
      <div className="flex flex-col gap-xs">
        <div className="flex items-center justify-end gap-2xs">
          <Button
            variant="ghost"
            size="sm"
            disabled={!onMarkAllRead || !canMarkAllRead}
            onClick={() => onMarkAllRead?.()}
          >
            <Icon name="check" size="xs" fallback="placeholder" />
            {labels.markAllRead}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={labels.openCenter}
            aria-label={labels.openCenter}
            onClick={() => {
              onClose();
              onOpenCenter?.();
            }}
          >
            <Icon name="arrow-right" size="xs" fallback="placeholder" />
          </Button>
        </div>
        {/* 待办置顶:同一件事只出现一次(有待办的事项不再在下面的消息里重复)。 */}
        {todos.length > 0 ? (
          <div className="flex flex-col gap-2xs">
            {labels.todosTitle ? (
              <span className="px-md pt-xs text-label-sm text-muted-foreground">
                {labels.todosTitle}
              </span>
            ) : null}
            {todos.map((todo) => (
              <div
                key={todo.key}
                className="flex items-center gap-md rounded-lg p-md"
              >
                <span
                  className={`inline-flex size-icon-xl shrink-0 items-center justify-center rounded-lg ${toneSurfaceClasses.warning}`}
                >
                  <Icon
                    name="list-checks"
                    size="sm"
                    fallback="info"
                    aria-hidden="true"
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                  <span className="truncate text-label-md font-semibold text-foreground">
                    {todo.title}
                  </span>
                  <span className="truncate text-body-sm text-muted-foreground">
                    {todo.detail}
                  </span>
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    onClose();
                    onNavigate(todo.href);
                  }}
                >
                  {todo.actionLabel}
                </Button>
              </div>
            ))}
            {labels.messagesTitle && notifications.length > 0 ? (
              <span className="px-md pt-sm text-label-sm text-muted-foreground">
                {labels.messagesTitle}
              </span>
            ) : null}
          </div>
        ) : null}
        {notifications.length === 0 && todos.length === 0 && labels.empty ? (
          <p className="p-md text-center text-body-sm text-muted-foreground">
            {labels.empty}
          </p>
        ) : null}
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
              <Icon
                name={n.icon}
                size="sm"
                fallback="info"
                aria-hidden="true"
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-2xs">
              <span
                className={`truncate text-label-md text-foreground ${n.unread ? "font-semibold" : "font-normal"}`}
              >
                {n.title}
              </span>
              <span className="truncate text-body-sm text-muted-foreground">
                {n.meta}
              </span>
            </span>
            <Icon
              name="arrow-right"
              size="xs"
              fallback="placeholder"
              className="shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </Drawer>
  );
}
