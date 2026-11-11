"use client";

/**
 * User-scoped memberships and default tenant selection.
 * @package @vxture/console
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-11
 */
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Banner, ViewHeader, ViewLayout } from "@vxture/design-system";
import type { Locale } from "@vxture-platform/shared";
import {
  fetchMyWorkspaces,
  setDefaultTenant,
  tenantLogoUrl,
} from "@/api/console-bff";
import type { ConsoleWorkspaceItem } from "@/entities/console";
import { LoadFailedBanner } from "@/components/load/LoadFailed";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useTenant } from "@/features/tenant";
import { getPathname, useRouter } from "@/lib/i18n/navigation";
import { formatBusinessDay } from "@/lib/display-format";
import { MembershipList, type TenantRow } from "./MembershipList";

// ===== Data and actions =====
export function MembershipsPage() {
  const t = useTranslations("membershipsPage");
  const locale = useLocale();
  const router = useRouter();
  const { session, refreshSession } = useConsoleSession();
  const { switchTenantContext } = useTenant();
  const [items, setItems] = useState<ConsoleWorkspaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"saved" | "error" | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    void fetchMyWorkspaces()
      .then((data) => {
        if (active) setItems(data);
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
  }, [session.user?.id, reload]);

  const tenants: TenantRow[] = items.map((ws) => ({
    tenantId: ws.tenantId,
    tenantNo:
      ws.tenantNo ??
      session.tenantOptions?.find((x) => x.id === ws.tenantId)?.tenantNo ??
      null,
    name: ws.tenantName,
    type: ws.tenantType,
    role: ws.role,
    joinedAt: formatBusinessDay(ws.joinedAt, locale, "—"),
    isCurrent: ws.isCurrent,
    isDefault: ws.isDefault === true,
    logoSrc: ws.logoHash ? tenantLogoUrl(ws.tenantId, ws.logoHash) : null,
    workspaces: ws.workspaceName
      ? [{ name: ws.workspaceName, isDefault: true }]
      : [],
  }));

  async function openTenant(tenant: TenantRow) {
    try {
      if (tenant.isCurrent) {
        router.push("/tenant");
        return;
      }
      await switchTenantContext(
        tenant.tenantId,
        getPathname({ href: "/tenant", locale: locale as Locale }),
      );
    } catch {
      setFeedback("error");
    }
  }

  async function changeDefault(tenant: TenantRow) {
    setBusyId(tenant.tenantId);
    setFeedback(null);
    try {
      await setDefaultTenant(tenant.tenantId);
      setItems(await fetchMyWorkspaces());
      await refreshSession({ silent: true });
      setFeedback("saved");
    } catch {
      setFeedback("error");
    } finally {
      setBusyId(null);
    }
  }

  // ===== Business view =====
  return (
    <ViewLayout>
      <ViewHeader
        icon="buildings"
        title={t("header.title")}
        description={t("header.description")}
      />
      {failed ? (
        <LoadFailedBanner
          onRetry={() => setReload((x) => x + 1)}
          retrying={loading}
        />
      ) : null}
      {feedback ? (
        <Banner
          tone={feedback === "saved" ? "success" : "danger"}
          title={t(`feedback.${feedback}`)}
        />
      ) : null}
      {!failed ? (
        <MembershipList
          tenants={tenants}
          loading={loading}
          settingDefaultId={busyId}
          onOpenTenant={(tenant) => void openTenant(tenant)}
          onSetDefault={(tenant) => void changeDefault(tenant)}
        />
      ) : null}
    </ViewLayout>
  );
}
