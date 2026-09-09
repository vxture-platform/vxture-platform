"use client";

/**
 * TodoSection.tsx — 概览页第二块：要你做什么。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * owner 2026-09-09：概览第二块是**需要处理的事项**——待办与紧要信息。
 *
 * ── 复用 useDerivedTodos，不另算一套 ──
 * 「待办与消息」页、顶栏抽屉、这里，三处读的是**同一份派生逻辑**。待办是从订阅、
 * 订单、认证等真实状态推出来的视图，不落库；三处各算一遍就一定会有一处先漂。
 *
 * ── 空态是常态，也是好消息 ──
 * 大多数时候没有待办。那时写一句「暂无待处理」，不画一块灰白占位——占位会让人
 * 以为有东西没加载出来，而这一页的空恰恰是「一切正常」。
 *
 * ── 只给前几条 ──
 * 概览是一眼能看完的量。多的去「待办与消息」，那一页才是台账。
 */

import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, StatusBadge } from "@vxture/design-system";
import { PageSection } from "@/layout/shell";
import { Link } from "@/lib/i18n/navigation";
import { useDerivedTodos } from "@/features/todos/useDerivedTodos";

/** 概览上最多列几条。超过的去「待办与消息」看全量。 */
const MAX_ROWS = 5;

export function TodoSection() {
  const t = useTranslations("dashboard.todos");
  const tTodo = useTranslations("todosPage");
  const derived = useDerivedTodos();
  const rows = derived.todos.slice(0, MAX_ROWS);
  const more = derived.todos.length - rows.length;

  return (
    <PageSection
      icon="bell"
      level={2}
      title={t("title")}
      description={t("description")}
      action={
        derived.todos.length > 0 ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/inbox">{t("viewAll")}</Link>
          </Button>
        ) : undefined
      }
    >
      {derived.loading ? (
        <EmptyState icon="clock" title={t("loading")} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="check"
          title={t("empty")}
          description={t("emptyHint")}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((todo) => (
            <li
              key={todo.key}
              className="flex items-start justify-between gap-md py-md"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                <span className="flex items-center gap-sm">
                  <StatusBadge tone="warning" dot>
                    {t("badge")}
                  </StatusBadge>
                  <Badge variant="outline">{tTodo(`kind.${todo.kind}`)}</Badge>
                  <span className="min-w-0 truncate text-label-md font-semibold text-foreground">
                    {todo.title}
                  </span>
                </span>
                <span className="text-body-sm text-muted-foreground">
                  {todo.detail}
                </span>
              </span>
              <Button asChild size="sm" className="shrink-0">
                <Link href={todo.href}>{todo.actionLabel}</Link>
              </Button>
            </li>
          ))}
          {more > 0 ? (
            <li className="py-md text-body-sm text-muted-foreground">
              {t("more", { count: more })}
            </li>
          ) : null}
        </ul>
      )}

      {/* 部分来源读失败时说一句：待办是多路数据推出来的，少一路就可能少几条，
          静默少列比报错更坏——人会以为那件事不用处理了。 */}
      {derived.partialFailed ? (
        <span className="text-body-sm text-warning-text">
          {tTodo("loadFailed")}
        </span>
      ) : null}
    </PageSection>
  );
}
