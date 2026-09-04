"use client";

/**
 * IdentityHeader — 账号信息页头部身份卡 + 所在租户展开区(批 5a,owner 定稿)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 整块是**一张**卡(不卡套卡):上半是身份行(头像 / 显示名 / 账号状态 / USR_ID /
 * 注册时间,不写「控制台用户」),右下角一枚「所在租户 · N 个」开关,默认收起;
 * 展开区在同一张卡里列出所在租户,租户之间实线分隔:名称 · 类型 · 角色标签
 * (icon + 身份)· T-编号 · 加入时间 · 「租户信息」跳转;工作区行与租户名左对齐、
 * 字号小一档、多工作区同一行;不给切换(切换归顶栏面板)。
 */

import { useTranslations } from "next-intl";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  Icon,
  StatusBadge,
  UserAvatar,
  type IconName,
} from "@vxture/design-system";
import { IdentityCard } from "@/components/detail";
import { formatTenantDisplay } from "@/features/tenant/tenant-display";

export interface TenantRow {
  tenantId: string;
  name: string;
  type: "personal" | "organization";
  tenantNo: string | null;
  role: string;
  joinedAt: string;
  isCurrent: boolean;
  /** 该租户下本人所在的工作区,默认工作区排第一;后端尚无多工作区时只有一个。 */
  workspaces: readonly { name: string; isDefault: boolean }[];
}

const ROLE_ICON: Record<string, IconName> = {
  owner: "medal",
  manager: "shield-check",
  member: "user",
  readonly: "user",
  guest: "user",
};
const KNOWN_ROLES = new Set(Object.keys(ROLE_ICON));

export function IdentityHeader({
  picture,
  displayName,
  statusLabel,
  statusTone,
  userNo,
  createdAt,
  loading,
  avatarBusy,
  onAvatarClick,
  onClearAvatar,
  canClearAvatar,
  onGoVerify,
  tenants,
  tenantsOpen,
  onTenantsOpenChange,
  onOpenTenant,
}: {
  readonly picture: string | null;
  readonly displayName: string;
  readonly statusLabel: string | null;
  readonly statusTone: "success" | "danger";
  readonly userNo: string;
  readonly createdAt: string;
  readonly loading: boolean;
  readonly avatarBusy: boolean;
  readonly onAvatarClick: () => void;
  readonly onClearAvatar: () => void;
  readonly canClearAvatar: boolean;
  readonly onGoVerify: () => void;
  readonly tenants: readonly TenantRow[];
  readonly tenantsOpen: boolean;
  readonly onTenantsOpenChange: (open: boolean) => void;
  readonly onOpenTenant: (tenant: TenantRow) => void;
}) {
  const t = useTranslations("profilePage");
  const roleLabel = (role: string) =>
    KNOWN_ROLES.has(role) ? t(`workspaces.role.${role}`) : role;

  return (
    <div className="flex flex-col rounded-xl bg-card shadow-raised ring-1 ring-foreground/10">
      <div className="px-lg pt-lg">
        <IdentityCard
          frame={false}
          avatar={
            <UserAvatar
              className="size-full"
              src={picture}
              alt={t("avatar.alt", { name: displayName })}
            />
          }
          avatarLabel={t("avatar.upload")}
          onAvatarClick={onAvatarClick}
          avatarDisabled={loading || avatarBusy}
          name={displayName}
          tags={
            statusLabel ? (
              <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
            ) : null
          }
          meta={
            <span className="flex flex-wrap items-center gap-lg">
              <span className="font-mono">
                {t("fields.userNo")}: {userNo}
              </span>
              <span>{t("identity.registeredAt", { date: createdAt })}</span>
            </span>
          }
          actions={
            <>
              <Button
                variant="ghost"
                size="md"
                onClick={onClearAvatar}
                disabled={avatarBusy || !canClearAvatar}
              >
                <Icon name="x" size="xs" fallback="placeholder" />
                <span>{t("actions.clearAvatar")}</span>
              </Button>
              <Button variant="outline" size="md" onClick={onGoVerify}>
                <Icon name="shield-check" size="xs" fallback="placeholder" />
                <span>{t("verification.goVerify")}</span>
              </Button>
            </>
          }
        />
      </div>

      {/* 所在租户开关:身份行右下角;默认收起 */}
      <div className="flex justify-end px-md pb-xs pt-sm">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onTenantsOpenChange(!tenantsOpen)}
          aria-expanded={tenantsOpen}
        >
          <Icon name="buildings" size="xs" fallback="placeholder" />
          <span>{t("identity.tenants", { count: tenants.length })}</span>
          <Icon
            name={tenantsOpen ? "chevron-up" : "chevron-down"}
            size="xs"
            fallback="placeholder"
          />
        </Button>
      </div>

      {/* 所在租户:一次全展开,租户之间实线分隔,不给切换 */}
      <Collapsible open={tenantsOpen} onOpenChange={onTenantsOpenChange}>
        <CollapsibleContent>
          <ul className="flex flex-col border-t border-border px-lg [&>*+*]:border-t [&>*+*]:border-border">
            {tenants.map((tenant) => (
              <li
                key={tenant.tenantId}
                className="flex items-start gap-md py-md"
              >
                <span
                  className="mt-2xs inline-flex size-icon-lg shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground"
                  aria-hidden="true"
                >
                  <Icon
                    name={tenant.type === "personal" ? "user" : "buildings"}
                    size="sm"
                    fallback="placeholder"
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                  <span className="flex flex-wrap items-center gap-md">
                    <span className="text-label-md text-foreground">
                      {formatTenantDisplay(tenant.name, tenant.type)}
                    </span>
                    {tenant.isCurrent ? (
                      <StatusBadge tone="brand">
                        {t("workspaces.current")}
                      </StatusBadge>
                    ) : null}
                    <StatusBadge tone="neutral">
                      {tenant.type === "personal"
                        ? t("identity.personalTenant")
                        : t("identity.orgTenant")}
                    </StatusBadge>
                    <StatusBadge tone="info">
                      <Icon
                        name={ROLE_ICON[tenant.role] ?? "user"}
                        size="xs"
                        fallback="placeholder"
                      />
                      {roleLabel(tenant.role)}
                    </StatusBadge>
                    {tenant.tenantNo ? (
                      <span className="font-mono text-body-sm text-muted-foreground">
                        T-{tenant.tenantNo}
                      </span>
                    ) : null}
                    <span className="text-body-sm text-muted-foreground">
                      {t("workspaces.joinedOn", { date: tenant.joinedAt })}
                    </span>
                  </span>
                  {/* 工作区:与租户名左对齐(徽标占左侧一列、盖住两行),字号小一档;
                      多个工作区排在同一行,默认的在最前,其余用间距分隔不换行 */}
                  <span className="flex flex-wrap items-center gap-md text-body-sm text-muted-foreground">
                    <span>{t("identity.workspace")}</span>
                    {(tenant.workspaces.length > 0
                      ? tenant.workspaces
                      : [
                          {
                            name: t("workspaces.defaultTag"),
                            isDefault: true,
                          },
                        ]
                    ).map((ws) => (
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenTenant(tenant)}
                >
                  <span>{t("identity.tenantInfo")}</span>
                  <Icon name="arrow-right" size="xs" fallback="placeholder" />
                </Button>
              </li>
            ))}
            {tenants.length === 0 ? (
              <li className="py-md text-body-sm text-muted-foreground">
                {loading ? t("common.loading") : t("sections.workspaces.empty")}
              </li>
            ) : null}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
