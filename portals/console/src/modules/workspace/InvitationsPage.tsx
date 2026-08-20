"use client";

/**
 * InvitationsPage.tsx — 邀请管理(P1 占位页落地,owner 2026-08-21)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 组织租户的成员邀请台账:发出的邀请、状态(待接受/已接受/已过期/已撤销)、
 * 撤销操作。发起邀请仍在成员管理页(邀请即建 pending 成员,两页一体);
 * 「重发」依赖通知系统邀请模板(design_notification_100 二期),灰位挂账。
 * expired 为读侧派生(pending ∧ 已过期,库内无清扫)。表格遵守默认结构。
 */

import { useCallback, useEffect, useState } from "react";
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
  fetchInvitations,
  revokeInvitation,
  type ConsoleInvitation,
} from "@/api/console-bff";
import { useRouter } from "@/lib/i18n/navigation";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PageSection, SignalList } from "@/layout/shell";
import { fmtDate, fmtTime } from "@/modules/commerce/components/hubModel";

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

export function InvitationsPage() {
  const t = useTranslations("invitationsPage");
  const router = useRouter();
  const { session } = useConsoleSession();

  const [rows, setRows] = useState<ConsoleInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => fetchInvitations().then(setRows), []);

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [reload, session.tenant?.id]);

  const roleLabel = (code: string): string =>
    KNOWN_ROLES.has(code) ? t(`role.${code}`) : code;

  const handleRevoke = async (inv: ConsoleInvitation) => {
    setError(null);
    setBusyId(inv.id);
    try {
      const ok = await revokeInvitation(inv.id);
      if (!ok) setError(t("revokeFailed"));
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const menuItems = (inv: ConsoleInvitation): ActionMenuItem[] => [
    {
      id: "revoke",
      label: t("revoke"),
      danger: true,
      disabled: inv.status !== "pending" || busyId !== null,
      ...(inv.status !== "pending" ? { hint: t("revokeHint") } : {}),
      onSelect: () => void handleRevoke(inv),
    },
    {
      id: "resend",
      label: t("resend"),
      disabled: true,
      hint: t("resendHint"),
    },
  ];

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
        <StatusBadge tone={STATUS_TONES[r.status]}>
          {t(`status.${r.status}`)}
        </StatusBadge>
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
          <span className="tabular-nums">{fmtDate(r.expiresAt)}</span>
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
          empty={<EmptyState title={t("table.empty")} />}
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
          ]}
        />
      </PageSection>
    </ViewLayout>
  );
}
