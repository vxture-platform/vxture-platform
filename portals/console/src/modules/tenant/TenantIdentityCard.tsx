"use client";

/**
 * TenantIdentityCard — 租户信息页的身份卡(批 5c)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 与账号信息页的身份卡同一形状:整块**一张卡**(IdentityCard frame={false} 套在
 * 外层卡里),右下角一枚展开开关。只读事实全部收在这里——类型、状态、认证、
 * `ID: T-…`、创建时间、所有者、成员数——下面的信息卡不再重复(owner 2026-09-05)。
 *
 * 展开区列所在工作空间:名称 · 默认标签 · `ID: W-…` · 只列不建不切。
 */

import { useTranslations } from "next-intl";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Collapsible,
  CollapsibleContent,
  Icon,
  Section,
  StatusBadge,
  type IconName,
} from "@vxture/design-system";
import { IdentityCard } from "@/components/detail";
import { PrincipalNo } from "@/components/principal-no";
import { formatTenantDisplay } from "@/features/tenant/tenant-display";

export type TenantVerifiedStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected"
  | "superseded"
  | null;

export interface TenantWorkspaceRow {
  workspaceId: string | null;
  name: string | null;
  workspaceNo: string | null;
  isDefault: boolean;
}

const VERIFY_TONE: Record<
  string,
  "success" | "warning" | "danger" | "neutral"
> = {
  verified: "success",
  pending: "warning",
  rejected: "danger",
  superseded: "danger",
  unverified: "neutral",
};

export function TenantIdentityCard({
  logoSrc,
  name,
  tenantType,
  tenantNo,
  status,
  verifiedStatus,
  createdAt,
  ownerName,
  memberCount,
  canManage,
  logoBusy,
  onLogoClick,
  onClearLogo,
  onGoVerify,
  onConvert,
  onTransfer,
  onOpenMembers,
  workspaces,
  workspacesOpen,
  onWorkspacesOpenChange,
  loading,
}: {
  readonly logoSrc: string | null;
  readonly name: string;
  readonly tenantType: "personal" | "organization";
  readonly tenantNo: string | null;
  readonly status: string | null;
  readonly verifiedStatus: TenantVerifiedStatus;
  readonly createdAt: string;
  readonly ownerName: string | null;
  readonly memberCount: number | null;
  readonly canManage: boolean;
  readonly logoBusy: boolean;
  readonly onLogoClick: () => void;
  readonly onClearLogo: () => void;
  readonly onGoVerify: () => void;
  /** 个人租户:转为组织租户(走查 2026-09-05:入口在认证之后)。 */
  readonly onConvert?: () => void;
  /** 组织租户所有者:转让所有权(走查 2026-09-05:从危险操作搬到所有者一行)。 */
  readonly onTransfer?: () => void;
  readonly onOpenMembers: () => void;
  readonly workspaces: readonly TenantWorkspaceRow[];
  readonly workspacesOpen: boolean;
  readonly onWorkspacesOpenChange: (open: boolean) => void;
  readonly loading: boolean;
}) {
  const t = useTranslations("tenantInfoPage");
  const typeIcon: IconName =
    tenantType === "personal" ? "user" : "building-library";

  return (
    <div className="flex flex-col rounded-xl bg-card shadow-raised ring-1 ring-foreground/10">
      <div className="px-lg pt-lg">
        <IdentityCard
          frame={false}
          avatar={
            // 走查(owner 2026-09-05):租户要有默认头像。此前无 logo 时画首字母,
            // 在可点击的上传按钮壳里没有自己的尺寸,看上去就是一块空白。改用 DS Avatar:
            // 有 logo 画图,图挂了或没有都回落到「建筑 / 用户」图标块,方角区别于人像。
            <Avatar className="size-media-md rounded-md">
              {logoSrc ? (
                <AvatarImage
                  src={logoSrc}
                  alt=""
                  className="rounded-md object-cover"
                />
              ) : null}
              <AvatarFallback
                className="rounded-md bg-accent text-muted-foreground"
                aria-hidden="true"
              >
                <Icon name={typeIcon} size="md" fallback="placeholder" />
              </AvatarFallback>
            </Avatar>
          }
          avatarLabel={t("logo.upload")}
          {...(canManage ? { onAvatarClick: onLogoClick } : {})}
          avatarDisabled={logoBusy}
          name={formatTenantDisplay(name, tenantType)}
          tags={
            <>
              <StatusBadge tone="neutral" icon={typeIcon}>
                {tenantType === "personal"
                  ? t("tenantType.personal")
                  : t("tenantType.organization")}
              </StatusBadge>
              <StatusBadge tone={status === "active" ? "success" : "warning"}>
                {status === "active"
                  ? t("status.active")
                  : t("status.suspended")}
              </StatusBadge>
              <StatusBadge
                tone={VERIFY_TONE[verifiedStatus ?? "unverified"] ?? "neutral"}
              >
                {t(`verify.${verifiedStatus ?? "unverified"}`)}
              </StatusBadge>
            </>
          }
          meta={
            <span className="flex flex-wrap items-center gap-lg">
              <PrincipalNo no={tenantNo} kind="tenant" />
              <span>{t("identity.createdOn", { date: createdAt })}</span>
              {ownerName ? (
                <span className="inline-flex items-center gap-xs">
                  <span>{t("identity.owner", { name: ownerName })}</span>
                  {tenantType === "organization" && onTransfer ? (
                    <Button
                      variant="link"
                      size="xs"
                      className="h-auto p-0"
                      onClick={onTransfer}
                    >
                      {t("identity.transfer")}
                    </Button>
                  ) : null}
                </span>
              ) : null}
              {tenantType === "organization" && memberCount !== null ? (
                <Button
                  variant="link"
                  size="xs"
                  className="h-auto p-0"
                  onClick={onOpenMembers}
                >
                  {t("identity.members", { count: memberCount })}
                </Button>
              ) : null}
            </span>
          }
          actions={
            <>
              {canManage && logoSrc ? (
                <Button
                  variant="ghost"
                  size="md"
                  onClick={onClearLogo}
                  disabled={logoBusy}
                >
                  <Icon name="x" size="xs" fallback="placeholder" />
                  <span>{t("logo.clear")}</span>
                </Button>
              ) : null}
              <Button variant="outline" size="md" onClick={onGoVerify}>
                <Icon name="shield-check" size="xs" fallback="placeholder" />
                <span>
                  {verifiedStatus === "verified"
                    ? t("verify.view")
                    : t("verify.go")}
                </span>
              </Button>
              {tenantType === "personal" && onConvert ? (
                <Button variant="outline" size="md" onClick={onConvert}>
                  <Icon
                    name="building-library"
                    size="xs"
                    fallback="placeholder"
                  />
                  <span>{t("identity.convert")}</span>
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      <div className="flex justify-end px-md pb-xs pt-sm">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onWorkspacesOpenChange(!workspacesOpen)}
          aria-expanded={workspacesOpen}
        >
          <Icon name="cube" size="xs" fallback="placeholder" />
          <span>{t("workspaces.toggle", { count: workspaces.length })}</span>
          <Icon
            name={workspacesOpen ? "chevron-up" : "chevron-down"}
            size="xs"
            fallback="placeholder"
          />
        </Button>
      </div>

      <Collapsible open={workspacesOpen} onOpenChange={onWorkspacesOpenChange}>
        <CollapsibleContent>
          <ul className="flex flex-col border-t border-border px-lg [&>*+*]:border-t [&>*+*]:border-border">
            {workspaces.map((ws) => (
              <li
                key={ws.workspaceId ?? ws.name}
                className="flex flex-wrap items-center gap-lg py-md"
              >
                <span
                  className="inline-flex size-icon-lg shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground"
                  aria-hidden="true"
                >
                  <Icon name="cube" size="sm" fallback="placeholder" />
                </span>
                <span className="text-label-md text-foreground">
                  {ws.name ?? t("workspaces.unnamed")}
                </span>
                {ws.isDefault ? (
                  <StatusBadge tone="neutral">
                    {t("workspaces.defaultTag")}
                  </StatusBadge>
                ) : null}
                <PrincipalNo
                  no={ws.workspaceNo}
                  kind="workspace"
                  className="text-body-sm text-muted-foreground"
                />
              </li>
            ))}
            {workspaces.length === 0 ? (
              <li className="py-md text-body-sm text-muted-foreground">
                {loading ? t("common.loading") : t("workspaces.empty")}
              </li>
            ) : null}
          </ul>
          <p className="px-lg pb-md pt-xs text-body-sm text-muted-foreground">
            {t("workspaces.hint")}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** 卡片外壳:与账号信息页同一套(Section tone=raised + CardRows 缩进)。 */
export function TenantSection({
  icon,
  titleKey,
  descriptionKey,
  action,
  titleExtra,
  children,
}: {
  readonly icon: IconName;
  readonly titleKey: string;
  readonly descriptionKey?: string;
  /** 标题行右侧的动作(如「编辑」)。 */
  readonly action?: React.ReactNode;
  /** 紧跟在标题文字后面的内容(如主管理员卡的已关联徽章 + 关联成员按钮)。 */
  readonly titleExtra?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  const t = useTranslations("tenantInfoPage");
  return (
    <Section
      tone="raised"
      level={2}
      icon={icon}
      title={
        titleExtra ? (
          <span className="flex flex-wrap items-center gap-sm">
            <span>{t(titleKey)}</span>
            {titleExtra}
          </span>
        ) : (
          t(titleKey)
        )
      }
      {...(descriptionKey ? { description: t(descriptionKey) } : {})}
      {...(action ? { action } : {})}
    >
      {children}
    </Section>
  );
}
