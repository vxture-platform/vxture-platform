"use client";

/**
 * MemberWorkspacesDialog.tsx — 管一个成员的工作空间归属。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * owner 2026-09-09：「关于用户，有两层，tenant 级、workspace 级」。成员管理页那张表
 * 现在有了「所属工作空间」列（读侧），这个对话框是写侧——把这个人加进某个空间、
 * 或从某个空间移出。
 *
 * ── 为什么是「逐个开关」而不是「多选保存」 ──
 * 每一次进出都是一次独立的授权变更，各有各的失败原因（默认空间移不掉、目标不在租户里、
 * 我管不了那个空间）。攒成一次提交的话，五个开关里坏了一个，界面只能说「保存失败」，
 * 说不清是哪一个、为什么。逐个点、逐个报，做完即生效。
 *
 * ── 移出 ≠ 移出租户 ──
 * 这里的移除只解除「他在这个空间里」，人还在租户里。移出租户是成员行菜单里的
 * 「解除关联」，那是另一个动作、另一个后果（库里的 FK 会连着把所有空间成员行一起删）。
 *
 * ── 默认工作空间移不掉 ──
 * 会话解析要落到一个工作空间上；把人从默认空间踢出去，他登录后没有工作空间上下文，
 * 症状是页面到处空白，而不是一句「你没权限」。后端挡（default_locked），
 * 这里把那一项禁掉并说明原因，不让人点了才知道。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  DialogForm,
  EmptyState,
  StatusBadge,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  addWorkspaceMember,
  fetchWorkspaces,
  removeWorkspaceMember,
  type ConsoleWorkspace,
} from "@/api/console-bff";
import type { MemberRecord } from "@/entities/console";

/** 与 console-bff 的 `WORKSPACE_ERRORS` 同一张表；闭集，多的走通用兜底。 */
const ERROR_CODES = [
  "not_found",
  "name_taken",
  "default_locked",
  "last_active",
  "archived",
  "not_empty",
  "member_not_found",
  "workspace_scope_denied",
] as const;
type ErrorCode = (typeof ERROR_CODES)[number];

export function MemberWorkspacesDialog({
  member,
  onClose,
  onChanged,
}: {
  readonly member: MemberRecord;
  readonly onClose: () => void;
  /** 有变更时通知调用方重取成员列表——「所属工作空间」那一列要跟着变。 */
  readonly onChanged: () => void;
}) {
  const t = useTranslations("memberWorkspaces");

  const [all, setAll] = useState<ConsoleWorkspace[] | null>(null);
  /** 这个人当前在哪些空间里。本地维护，每次动作后就地更新，不整页重取。 */
  const [joined, setJoined] = useState<Set<string>>(
    () => new Set(member.workspaces.map((w) => w.id)),
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* 一次只处理一个空间：两个动作同时在飞，失败提示会互相盖掉。 */
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchWorkspaces()
      .then((list) => {
        if (!active) return;
        /* 停用的空间不列：既不能加人进去，也不该让人以为还能用。 */
        setAll(list.filter((w) => w.status === "active"));
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const errorText = useCallback(
    (caught: unknown) => {
      const code =
        caught instanceof ConsoleBffError &&
        (ERROR_CODES as readonly string[]).includes(caught.message)
          ? (caught.message as ErrorCode)
          : null;
      return code ? t(`errors.${code}`) : t("errors.generic");
    },
    [t],
  );

  async function toggle(ws: ConsoleWorkspace) {
    if (busyId) return;
    setBusyId(ws.id);
    setError(null);
    const wasIn = joined.has(ws.id);
    try {
      if (wasIn) {
        await removeWorkspaceMember(ws.id, member.accountId);
      } else {
        await addWorkspaceMember(ws.id, member.accountId);
      }
      setJoined((cur) => {
        const next = new Set(cur);
        if (wasIn) next.delete(ws.id);
        else next.add(ws.id);
        return next;
      });
      onChanged();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <DialogForm
      open
      title={t("title", { name: member.name })}
      description={t("description")}
      /* 没有「保存」：每一次进出做完即生效，攒起来提交会让失败说不清是哪一个。 */
      submitLabel={t("done")}
      cancelLabel={t("close")}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {error ? <Banner tone="danger" title={error} /> : null}
      {loadFailed ? <Banner tone="danger" title={t("loadFailed")} /> : null}

      {all === null && !loadFailed ? (
        <EmptyState icon="clock" title={t("loading")} />
      ) : all && all.length === 0 ? (
        <EmptyState icon="stack" title={t("noWorkspaces")} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {(all ?? []).map((ws) => {
            const isIn = joined.has(ws.id);
            /* 默认空间：进得去、出不来。禁的是「移出」，不是整行。 */
            const lockedOut = isIn && ws.isDefault;
            return (
              <li
                key={ws.id}
                className="flex items-center justify-between gap-md py-md"
              >
                <span className="flex min-w-0 flex-col gap-2xs">
                  <span className="flex items-center gap-sm">
                    <span className="truncate text-label-md text-foreground">
                      {ws.name}
                    </span>
                    {ws.isDefault ? (
                      <StatusBadge tone="info">{t("defaultTag")}</StatusBadge>
                    ) : null}
                  </span>
                  <span className="text-body-sm text-muted-foreground">
                    {lockedOut
                      ? t("defaultLockedHint")
                      : isIn
                        ? t("inWorkspace")
                        : t("notInWorkspace")}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant={isIn ? "outline" : "default"}
                  disabled={busyId !== null || lockedOut}
                  onClick={() => void toggle(ws)}
                >
                  {isIn ? t("remove") : t("add")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </DialogForm>
  );
}
