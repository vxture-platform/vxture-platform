"use client";
/**
 * MemberDetailDrawer.tsx - Tenant-scoped, read-only member identity and access facts.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-19
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  Drawer,
  PhoneNumber,
  StatusBadge,
  UserAvatar,
} from "@vxture/design-system";
import { formatPhoneForDisplay } from "@vxture/core-utils/phone";
import { fetchProductSeats } from "@/api/console-bff";
import type { MemberRecord } from "@/entities/console";
import { RoleTag } from "@/components/role-tag";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { useDateFormat } from "@/lib/use-date-format";
import { formatPrincipalNoOr } from "@vxture-platform/shared";

// ===== Read-only assignments =====
type Assignment = { workspace: string; product: string; grantedAt: string };

// ===== Member facts and scoped assignments =====
/** @param props Selected tenant member. @returns A drawer without account mutations. */
export function MemberDetailDrawer({
  member,
  onClose,
}: {
  readonly member: MemberRecord;
  readonly onClose: () => void;
}) {
  const t = useTranslations("membersPage.details");
  const tMembers = useTranslations("membersPage");
  const { fmtDateTime } = useDateFormat();
  const { session } = useConsoleSession();
  const canReadAssignments = hasCapability(
    session.capabilities,
    "workspace.member.manage",
  );
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!canReadAssignments || member.status === "Invited") return;
    let active = true;
    setAssignments(null);
    setFailed(false);
    void Promise.all(
      member.workspaces.map(async (workspace) => {
        const products = await fetchProductSeats(workspace.id);
        return products.flatMap((product) =>
          product.holders
            .filter((h) => h.userId === member.accountId)
            .map((holder) => ({
              workspace: workspace.name,
              product: product.productName,
              grantedAt: holder.grantedAt,
            })),
        );
      }),
    )
      .then((rows) => {
        if (active) setAssignments(rows.flat());
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [
    canReadAssignments,
    member.accountId,
    member.status,
    member.workspaces,
    retry,
  ]);
  const facts = [
    [
      t("userNo"),
      member.userNo ? formatPrincipalNoOr(member.userNo, "user", "—") : "—",
    ],
    [t("username"), member.username || "—"],
    [
      t("phone"),
      member.phone ? (
        <PhoneNumber key="phone" {...formatPhoneForDisplay(member.phone)} />
      ) : (
        "—"
      ),
    ],
    [t("email"), member.email || "—"],
    [
      t("registeredAt"),
      member.registeredAt ? fmtDateTime(member.registeredAt) : "—",
    ],
  ] as const;
  return (
    <Drawer
      open
      onClose={onClose}
      side="right"
      width="lg"
      title={t("title")}
      closeLabel={t("close")}
      footer={
        <Button variant="outline" size="md" onClick={onClose}>
          {t("close")}
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-lg">
        <div className="flex items-center gap-md">
          <UserAvatar
            src={member.avatarUrl ?? null}
            alt={member.name}
            className="size-media-md"
          />
          <strong className="break-words text-heading-2">{member.name}</strong>
        </div>
        <section className="flex flex-col gap-sm" aria-label={t("identity")}>
          <h3 className="text-heading-3">{t("identity")}</h3>
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-lg gap-y-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="flex flex-col gap-sm">
          <h3 className="text-heading-3">{t("relationship")}</h3>
          <span className="break-words">{session.tenant?.name ?? "—"}</span>
          <RoleTag code={member.roleCode} fallback={member.role} />
          <div className="flex flex-wrap gap-xs">
            {member.workspaces.map((w) => (
              <StatusBadge key={w.id} tone="neutral">
                {w.name}
              </StatusBadge>
            ))}
          </div>
          <span>
            {t("joinedAt")}：
            {member.status === "Invited" ? "—" : fmtDateTime(member.joinedAt)}
          </span>
        </section>
        <section className="flex flex-col gap-sm">
          <h3 className="text-heading-3">{t("access")}</h3>
          <span className="text-body-small text-muted-foreground">
            {t("presenceHint")}
          </span>
          <span>
            {tMembers(`status.${member.status}`)}
            {member.status === "Active"
              ? ` · ${tMembers(`presence.${member.presence ?? "unknown"}`)}`
              : ""}
          </span>
          <span>
            {t("lastLoginAt")}：
            {member.lastLoginAt ? fmtDateTime(member.lastLoginAt) : "—"}
          </span>
        </section>
        {canReadAssignments && member.status !== "Invited" ? (
          <section className="flex flex-col gap-sm">
            <h3 className="text-heading-3">{t("applications")}</h3>
            {failed ? (
              <Banner
                tone="warning"
                title={t("loadFailed")}
                action={
                  <Button onClick={() => setRetry((n) => n + 1)}>
                    {t("retry")}
                  </Button>
                }
              />
            ) : assignments === null ? (
              <span>{t("loading")}</span>
            ) : assignments.length === 0 ? (
              <span className="text-muted-foreground">
                {t("noApplications")}
              </span>
            ) : (
              <ul className="flex flex-col gap-sm">
                {assignments.map((a, i) => (
                  <li key={i} className="flex flex-col gap-2xs">
                    <strong>{a.product}</strong>
                    <span className="text-body-small text-muted-foreground">
                      {a.workspace} · {fmtDateTime(a.grantedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
