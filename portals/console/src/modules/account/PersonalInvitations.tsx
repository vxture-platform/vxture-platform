"use client";

/**
 * PersonalInvitations.tsx - Incoming tenant invitations for the current user.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-11
 */
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Banner, Button, Card } from "@vxture/design-system";
import {
  acceptIncomingInvitation,
  declineIncomingInvitation,
  fetchIncomingInvitations,
  type IncomingInvitation,
} from "@/api/console-bff";
import { PageSection } from "@/layout/shell";
import { RoleTag } from "@/components/role-tag";
import { formatBusinessDay } from "@/lib/display-format";

// ===== Incoming invitations =====
/**
 * Reuse the existing identity-bound invitation acceptance flow.
 * @param props - User identity to invalidate requests when accounts change.
 * @returns Invitations with retryable loading and mutation feedback.
 */
export function PersonalInvitations({
  userId,
}: {
  userId: string | undefined;
}) {
  const t = useTranslations("membershipsPage.invitations");
  const locale = useLocale();
  const [items, setItems] = useState<IncomingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setItems([]);
    void fetchIncomingInvitations()
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, reload]);

  async function respond(id: string, accept: boolean) {
    if (busy) return;
    setBusy(id);
    setActionFailed(false);
    try {
      if (accept) {
        await acceptIncomingInvitation(id);
        // Membership, permissions and tenant options must refresh together.
        window.location.reload();
      } else {
        await declineIncomingInvitation(id);
        setItems((rows) => rows.filter((row) => row.id !== id));
      }
    } catch {
      setActionFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageSection title={t("title")} description={t("description")} icon="users">
      {actionFailed ? <Banner tone="danger" title={t("actionFailed")} /> : null}
      <Card className="gap-0 px-lg py-0">
        {failed ? (
          <div
            className="flex flex-wrap items-center justify-between gap-sm py-md"
            role="status"
          >
            <span>{t("failed")}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReload((x) => x + 1)}
            >
              {t("retry")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-md text-body-sm text-muted-foreground" role="status">
            {t(loading ? "loading" : "empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-md py-md"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-xs">
                  <span className="flex flex-wrap items-center gap-sm">
                    <strong className="break-words text-label-md">
                      {item.tenantName || t("unnamedTenant")}
                    </strong>
                    <RoleTag code={item.roleCode} />
                  </span>
                  <span className="text-body-sm text-muted-foreground">
                    {t("expires", {
                      date: formatBusinessDay(item.expiresAt, locale, "—"),
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-sm">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void respond(item.id, false)}
                  >
                    {t("decline")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void respond(item.id, true)}
                  >
                    {t(busy === item.id ? "processing" : "accept")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageSection>
  );
}
