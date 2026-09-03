"use client";

/**
 * InvitationsPage.tsx — 邀请管理(批 2 收口)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 组织租户的成员邀请台账:发出的邀请、状态(待接受 / 已接受 / 已过期 / 已撤销)、
 * 撤销与重发。发起邀请仍在成员管理页(邀请即目录里的 Invited 行,两页一体)。
 * 重发 = 换链接 + 顺延有效期 + 再发一封邮件(InviteLinkDialog 兜底复制);
 * expired 为读侧派生(pending ∧ 已过期),所以过期的也能重发。表格遵守默认结构。
 */

import { useCallback, useEffect, useState } from "react";
import { useConfirmLabels } from "@/lib/destructive";
import { useTranslations } from "next-intl";
import {
  ActionMenu,
  Banner,
  Button,
  DataTable,
  EmptyState,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  StatusBadgeTone,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  fetchInvitations,
  memberErrorCode,
  resendInvitation,
  revokeInvitation,
  type ConsoleInvitation,
  type InviteMemberResult,
} from "@/api/console-bff";
import { useRouter } from "@/lib/i18n/navigation";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PageSection, SignalList } from "@/layout/shell";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { fmtDate, fmtTime } from "@/modules/commerce/components/hubModel";
import { InviteLinkDialog } from "./components/InviteLinkDialog";

const STATUS_TONES: Record<ConsoleInvitation["status"], StatusBadgeTone> = {
  pending: "info",
  accepted: "success",
  expired: "neutral",
  revoked: "neutral",
};

const KNOWN_ROLES = new Set([
  "owner",
  "manager",
  "member",
  "readonly",
  "guest",
]);

const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000;

export function InvitationsPage() {
  const t = useTranslations("invitationsPage");
  const router = useRouter();
  const { session } = useConsoleSession();

  const [rows, setRows] = useState<ConsoleInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<InviteMemberResult | null>(
    null,
  );
  const withLabels = useConfirmLabels();

  const reload = useCallback(() => fetchInvitations().then(setRows), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    reload()
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload, session.tenant?.id, reloadKey]);

  const roleLabel = (code: string): string =>
    KNOWN_ROLES.has(code) ? t(`role.${code}`) : code;

  const errorText = (caught: unknown, fallbackKey: string): string => {
    const code = memberErrorCode(caught);
    if (code) return t(`errors.${code}`);
    return caught instanceof ConsoleBffError && caught.message
      ? caught.message
      : t(fallbackKey);
  };

  const handleRevoke = async (inv: ConsoleInvitation) => {
    setError(null);
    setMessage(null);
    setBusyId(inv.id);
    try {
      await revokeInvitation(inv.id);
      await reload();
      setMessage(t("revoked", { email: inv.email }));
    } catch (caught) {
      /* 重新抛出:DS 的确认件按 Promise 是否 rejected 决定关不关框。失败的理由
         已经落在 `error` 横幅上,但框不能关——用户得看见自己按的那一下没成。 */
      setError(errorText(caught, "revokeFailed"));
      throw caught;
    } finally {
      setBusyId(null);
    }
  };

  const handleResend = async (inv: ConsoleInvitation) => {
    setError(null);
    setMessage(null);
    setBusyId(inv.id);
    try {
      const result = await resendInvitation(inv.id);
      await reload();
      setInviteResult(result);
      setMessage(
        result.emailSent
          ? t("resent", { email: inv.email })
          : t("resentNoEmail", { email: inv.email }),
      );
    } catch (caught) {
      setError(errorText(caught, "resendFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const canResend = (inv: ConsoleInvitation) =>
    inv.status === "pending" || inv.status === "expired";

  const menuItems = (inv: ConsoleInvitation): ActionMenuItem[] => [
    {
      id: "resend",
      label: t("resend"),
      icon: "mail",
      disabled: !canResend(inv) || busyId !== null,
      ...(canResend(inv) ? {} : { hint: t("resendHint") }),
      onSelect: () => void handleResend(inv),
    },
    {
      id: "revoke",
      label: t("revoke"),
      icon: "x",
      danger: true,
      disabled: inv.status !== "pending" || busyId !== null,
      ...(inv.status !== "pending" ? { hint: t("revokeHint") } : {}),
      confirm: withLabels({
        verb: t("revokeVerb"),
        target: inv.email,
        consequence: t("revokeConsequence"),
        cancelLabel: t("revokeKeep"),
        onConfirm: () => handleRevoke(inv),
      }),
    },
  ];

  const expiringSoon = (inv: ConsoleInvitation) =>
    inv.status === "pending" &&
    new Date(inv.expiresAt).getTime() - Date.now() < EXPIRING_SOON_MS;

  const columns: DataTableColumn<ConsoleInvitation>[] = [
    {
      id: "email",
      header: t("table.colEmail"),
      cell: (r) => (
        <span className="flex flex-col">
          <span className="text-foreground">{r.email}</span>
          <span className="text-body-sm text-muted-foreground">
            {t("table.invitedBy", { name: r.inviterName ?? "—" })}
          </span>
        </span>
      ),
    },
    {
      id: "role",
      header: t("table.colRole"),
      align: "center",
      cell: (r) => roleLabel(r.roleCode),
    },
    {
      id: "status",
      header: t("table.colStatus"),
      align: "center",
      cell: (r) => (
        <span className="inline-flex items-center gap-xs">
          <StatusBadge tone={STATUS_TONES[r.status]}>
            {t(`status.${r.status}`)}
          </StatusBadge>
          {expiringSoon(r) ? (
            <StatusBadge tone="warning">{t("expiringSoon")}</StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      id: "createdAt",
      header: t("table.colCreatedAt"),
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-body-sm text-muted-foreground">
          {fmtDate(r.createdAt)} {fmtTime(r.createdAt)}
        </span>
      ),
    },
    {
      id: "expiresAt",
      header: t("table.colExpiresAt"),
      align: "right",
      cell: (r) =>
        r.status === "accepted" && r.acceptedAt ? (
          <span className="tabular-nums text-body-sm text-muted-foreground">
            {t("table.acceptedAt", { date: fmtDate(r.acceptedAt) })}
          </span>
        ) : (
          <span className="tabular-nums">
            {fmtDate(r.expiresAt)} {fmtTime(r.expiresAt)}
          </span>
        ),
    },
  ];

  return (
    <ViewLayout>
      <ViewHeader
        icon="mail"
        title={t("title")}
        description={t("description")}
        action={
          <Button size="md" onClick={() => router.push("/members")}>
            {t("inviteAction")}
          </Button>
        }
      />

      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}
      {message ? <Banner tone="success" title={message} /> : null}
      {error ? <Banner tone="danger" title={error} /> : null}

      <PageSection
        icon="mail"
        level={2}
        title={t("table.title")}
        description={t("table.description")}
      >
        <DataTable<ConsoleInvitation>
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          indexStart={1}
          rowActions={(r) => (
            <ActionMenu label={t("rowMenu")} items={menuItems(r)} />
          )}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("table.empty")} />
            )
          }
        />
      </PageSection>

      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SignalList
          items={[
            { title: t("notes.flowTitle"), description: t("notes.flowBody") },
            {
              title: t("notes.expiryTitle"),
              description: t("notes.expiryBody"),
            },
            {
              title: t("notes.resendTitle"),
              description: t("notes.resendBody"),
            },
          ]}
        />
      </PageSection>

      <InviteLinkDialog
        result={inviteResult}
        resent
        onClose={() => setInviteResult(null)}
      />
    </ViewLayout>
  );
}
