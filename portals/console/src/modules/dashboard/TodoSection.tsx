"use client";

/**
 * TodoSection.tsx — Actionable overview alerts derived from current account state.
 * @package @vxture/console
 * @layer Presentation
 * @category Module
 *
 * Reuse the inbox derivation so alerts disappear when their source is resolved.
 * Successful empty results render nothing; source failures remain retryable.
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Banner, Button } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { useDerivedTodos } from "@/features/todos/useDerivedTodos";

// ===== Actionable alerts =====
/** @returns Non-dismissible alerts for outstanding tasks and source failures. */
export function TodoSection() {
  const t = useTranslations("dashboard.todos");
  const tTodo = useTranslations("todosPage");
  const { todos, partialFailed, reload } = useDerivedTodos();

  useEffect(() => {
    // Revalidate after handling an item in another tab without background polling.
    const refresh = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);

  if (todos.length === 0 && !partialFailed) return null;
  return (
    <div className="flex flex-col gap-sm" aria-label={t("title")}>
      {todos.slice(0, 5).map((todo) => (
        <Banner
          key={todo.key}
          tone="warning"
          title={todo.title}
          description={todo.detail}
          action={
            <Button asChild variant="outline" size="md">
              <Link href={todo.href}>{todo.actionLabel}</Link>
            </Button>
          }
        />
      ))}
      {todos.length > 5 ? (
        <Button asChild variant="outline" size="md" className="self-start">
          <Link href="/inbox?filter=todo">
            {t("more", { count: todos.length - 5 })}
          </Link>
        </Button>
      ) : null}
      {partialFailed ? (
        <Banner
          tone="warning"
          title={tTodo("loadFailed")}
          action={
            <Button size="md" variant="outline" onClick={reload}>
              {t("retry")}
            </Button>
          }
        />
      ) : null}
    </div>
  );
}
