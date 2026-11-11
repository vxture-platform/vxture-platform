"use client";
/**
 * Membership rows retained from the former profile page.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-11
 */
import { useTranslations } from "next-intl";
import { Button, Card, Icon, StatusBadge } from "@vxture/design-system";
import { TenantAvatar } from "@/components/tenant-avatar";
import { PrincipalNo } from "@/components/principal-no";
import { RoleTag } from "@/components/role-tag";
import { formatTenantDisplay } from "@/features/tenant/tenant-display";
// ===== Types =====
export interface TenantRow {
  tenantId: string;
  name: string;
  type: "personal" | "organization";
  tenantNo: string | null;
  role: string;
  joinedAt: string;
  isCurrent: boolean;

  isDefault: boolean;

  logoSrc: string | null;

  workspaces: readonly { name: string; isDefault: boolean }[];
}

// ===== Membership list =====
export function MembershipList({
  tenants,
  loading,
  onOpenTenant,
  onSetDefault,
  settingDefaultId,
}: {
  tenants: readonly TenantRow[];
  loading: boolean;
  onOpenTenant: (tenant: TenantRow) => void;
  onSetDefault: (tenant: TenantRow) => void;
  settingDefaultId: string | null;
}) {
  const t = useTranslations("membershipsPage");
  return (
    <Card className="gap-0 py-0">
      <ul className="flex flex-col px-lg [&>*+*]:border-t [&>*+*]:border-border">
        {tenants.map((tenant) => (
          <li
            key={tenant.tenantId}
            className="flex flex-wrap items-start gap-lg py-md"
          >
            <TenantAvatar
              src={tenant.logoSrc}
              tenantType={tenant.type}
              size="sm"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-xs">
              <span className="flex flex-wrap items-center gap-md">
                <span className="text-label-md text-foreground">
                  {formatTenantDisplay(tenant.name, tenant.type)}
                </span>

                <StatusBadge
                  tone="neutral"
                  icon={tenant.type === "personal" ? "user" : "buildings"}
                >
                  {tenant.type === "personal"
                    ? t("identity.personalTenant")
                    : t("identity.orgTenant")}
                </StatusBadge>
                <RoleTag code={tenant.role} />
                {tenant.isDefault ? (
                  <StatusBadge tone="neutral" icon="check">
                    {t("identity.defaultTag")}
                  </StatusBadge>
                ) : null}
                {tenant.isCurrent ? (
                  <StatusBadge tone="brand">
                    {t("workspaces.current")}
                  </StatusBadge>
                ) : null}
                {tenant.tenantNo ? (
                  <PrincipalNo
                    no={tenant.tenantNo}
                    kind="tenant"
                    className="text-body-sm text-muted-foreground"
                  />
                ) : null}
                <span className="text-body-sm text-muted-foreground">
                  {t("workspaces.joinedOn", { date: tenant.joinedAt })}
                </span>
              </span>

              <span className="flex flex-wrap items-center gap-md text-body-sm text-muted-foreground">
                <span>{t("identity.workspace")}</span>
                {tenant.workspaces.length === 0 ? <span>—</span> : null}
                {tenant.workspaces.map((ws) => (
                  <span
                    key={ws.name}
                    className="inline-flex items-center gap-xs text-foreground"
                  >
                    {ws.name}
                    {ws.isDefault ? (
                      <StatusBadge tone="neutral">
                        {t("workspaces.defaultTag")}
                      </StatusBadge>
                    ) : null}
                  </span>
                ))}
              </span>
            </span>

            <span className="flex shrink-0 items-center gap-2xs">
              {tenant.isDefault ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  title={t("identity.setDefaultTitle")}
                  disabled={settingDefaultId !== null}
                  onClick={() => onSetDefault(tenant)}
                >
                  <Icon
                    name={
                      settingDefaultId === tenant.tenantId ? "spinner" : "check"
                    }
                    size="xs"
                    fallback="placeholder"
                  />
                  <span>{t("identity.setDefault")}</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenTenant(tenant)}
              >
                <span>{t("identity.tenantInfo")}</span>
                <Icon name="arrow-right" size="xs" fallback="placeholder" />
              </Button>
            </span>
          </li>
        ))}
        {tenants.length === 0 ? (
          <li className="py-md text-body-sm text-muted-foreground">
            {loading ? t("common.loading") : t("sections.workspaces.empty")}
          </li>
        ) : null}
      </ul>
    </Card>
  );
}
