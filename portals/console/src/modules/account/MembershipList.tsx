"use client";
/**
 * Personal-center tenant relationships and context actions.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-11
 */
import { useTranslations } from "next-intl";
import { ActionMenu, Button, Icon, StatusBadge } from "@vxture/design-system";
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
  onSwitchTenant,
  settingDefaultId,
}: {
  tenants: readonly TenantRow[];
  loading: boolean;
  onOpenTenant: (tenant: TenantRow) => void;
  onSetDefault: (tenant: TenantRow) => void;
  onSwitchTenant: (tenant: TenantRow) => void;
  settingDefaultId: string | null;
}) {
  const t = useTranslations("membershipsPage");
  return (
    <div>
      <ul className="@container flex flex-col gap-md">
        {tenants.map((tenant) => (
          <li
            key={tenant.tenantId}
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-lg gap-y-sm rounded-md border border-border bg-card p-lg"
          >
            <TenantAvatar
              src={tenant.logoSrc}
              tenantType={tenant.type}
              size="lg"
              className="row-span-2"
            />
            <span className="col-start-2 row-start-1 min-w-0 break-words text-label font-semibold text-foreground">
              {formatTenantDisplay(tenant.name, tenant.type)}
            </span>
            <span className="col-span-2 col-start-2 row-start-2 flex min-w-0 flex-col gap-xs">
              <span className="flex flex-wrap items-center gap-md">
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
                    className="text-body-small text-muted-foreground"
                  />
                ) : null}
                <span className="text-body-small text-muted-foreground">
                  {t("workspaces.joinedOn", { date: tenant.joinedAt })}
                </span>
              </span>

              <span className="flex flex-wrap items-center gap-md text-body-small text-muted-foreground">
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

            <div className="col-start-3 row-start-1 @2xl:hidden">
              <ActionMenu
                label={t("identity.tenantActions")}
                items={[
                  ...(!tenant.isCurrent
                    ? [
                        {
                          id: "switch",
                          label: t("identity.switchTenant"),
                          disabled: settingDefaultId !== null,
                          onSelect: () => onSwitchTenant(tenant),
                        },
                      ]
                    : []),
                  ...(!tenant.isDefault
                    ? [
                        {
                          id: "default",
                          label: t("identity.setDefault"),
                          disabled: settingDefaultId !== null,
                          onSelect: () => onSetDefault(tenant),
                        },
                      ]
                    : []),
                  {
                    id: "info",
                    label: t("identity.tenantInfo"),
                    onSelect: () => onOpenTenant(tenant),
                  },
                ]}
              />
            </div>
            <span className="hidden min-w-0 flex-wrap items-start justify-end gap-2xs @2xl:col-start-3 @2xl:row-start-1 @2xl:flex">
              {!tenant.isCurrent ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={settingDefaultId !== null}
                  onClick={() => onSwitchTenant(tenant)}
                >
                  {t("identity.switchTenant")}
                </Button>
              ) : null}
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
          <li className="py-md text-body-small text-muted-foreground">
            {loading ? t("common.loading") : t("sections.workspaces.empty")}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
