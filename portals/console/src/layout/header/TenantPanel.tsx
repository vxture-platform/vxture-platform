"use client";

/**
 * TenantPanel — console 的「当前范围」面板（header 上租户名那个下拉）。
 *
 * 业务内容留在产品侧、排版语法来自 DS：租户身份、配额、账单、计划、组织/
 * 工作区切换这些概念 DS 不认识也不该认识（零业务属性），但它们的**摆法**
 * ——头部标识行、发丝线分段、行的三种形态、带进度条的度量行——全部走
 * `ShellPanel*`。因此本面板跟任何产品自己拼的面板逐像素同构，只是词不同。
 *
 * 原实现是设计稿 1:1 转写的 `.vxh-org-*` 手搓弹层（`shell-template/app.css`），
 * 那套类名仍由 admin 消费，本次不动共享 CSS，只是 console 不再引用它。
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatPrincipalNo } from "@/lib/principal-no";
import {
  Popover,
  PopoverTrigger,
  ShellPanelContent,
  ShellPanelHeader,
  ShellPanelMeterRow,
  ShellPanelRow,
  ShellPanelSection,
  ShellScopeButton,
  StatusBadge,
} from "@vxture/design-system";
import type { ConsoleQuotaUsage } from "@/api/console-bff";
import type { TenantContext } from "@/entities/console";
import { formatTenantDisplay } from "@/features/tenant/tenant-display";
import { fmtCount as formatCount, formatBytes } from "@/lib/format-metrics";

function percentOf(used: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return (used / limit) * 100;
}

export interface TenantPanelProps {
  tenant: TenantContext | null | undefined;
  /** 当前工作空间名；未知时面板显示"默认工作空间"。 */
  workspaceName: string | null;
  quotaUsage: ConsoleQuotaUsage | null;
  /** 本月费用，已带币种符号与千分位——格式化是业务判断，不下推给 DS。 */
  billingLabel: string;
  /** 生效订阅的套餐名；null 表示未订阅，回落到免费套餐文案。 */
  planName: string | null;
  /**
   * 可切换的租户列表(真列表,批 4):每个租户一行,当前项标出;≤1 项时只剩当前
   * 一行,切换入口自然无处可点(功能在,只是无处可切)。
   */
  tenantOptions: ReadonlyArray<{
    id: string;
    name: string;
    type: "personal" | "organization";
    isCurrent: boolean;
  }>;
  onSwitchTenant: (tenantId: string) => void;
  onNavigate: (href: string) => void;
  /** 面板里任何一次跳转都要让 header 上其它弹层一起收起。 */
  onBeforeNavigate?: (() => void) | undefined;
}

export function TenantPanel({
  tenant,
  workspaceName,
  quotaUsage,
  billingLabel,
  planName,
  tenantOptions,
  onSwitchTenant,
  onNavigate,
  onBeforeNavigate,
}: TenantPanelProps) {
  const t = useTranslations("shell");
  const [open, setOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);

  const tenantName =
    formatTenantDisplay(tenant?.name, tenant?.tenantType) || t("tenantOrg");
  const tenantTypeLabel =
    tenant?.tenantType === "personal" ? t("personalTenant") : t("orgTenant");
  const suspended =
    tenant?.status === "suspended" || tenant?.status === "cancelled";

  const go = (href: string) => {
    setOpen(false);
    setScopeOpen(false);
    onBeforeNavigate?.();
    onNavigate(href);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 嵌套的"切换范围"子面板不能比父面板活得久，否则再打开时它还是展开的。
        if (!next) setScopeOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        <ShellScopeButton
          icon="buildings"
          label={tenantName}
          ariaLabel={t("tenantOrg")}
          active={open}
        />
      </PopoverTrigger>

      <ShellPanelContent align="start">
        <ShellPanelHeader
          icon="buildings"
          title={tenantName}
          titleAside={
            <StatusBadge tone={suspended ? "warning" : "neutral"}>
              {suspended ? t("verifySuspended") : t("verifyUnknown")}
            </StatusBadge>
          }
          metaRows={[
            ...(tenant?.tenantNo
              ? [
                  {
                    key: "no",
                    content: formatPrincipalNo(tenant.tenantNo, "tenant") ?? "",
                  },
                ]
              : []),
            { key: "type", content: tenantTypeLabel },
            {
              key: "workspace",
              icon: "cube" as const,
              content: workspaceName || t("defaultWorkspace"),
            },
          ]}
        />

        <ShellPanelSection title={t("usageQuota")}>
          <ShellPanelMeterRow
            icon="stack"
            label={t("storageQuota")}
            valueLabel={
              quotaUsage
                ? `${formatBytes(quotaUsage.storage.used)} / ${formatBytes(quotaUsage.storage.limit)}`
                : "—"
            }
            percent={
              quotaUsage
                ? percentOf(quotaUsage.storage.used, quotaUsage.storage.limit)
                : 0
            }
          />
          <ShellPanelMeterRow
            icon="coins"
            label={t("aiCredits")}
            valueLabel={
              quotaUsage
                ? `${formatCount(quotaUsage.aiCredit.used)} / ${formatCount(quotaUsage.aiCredit.limit)}`
                : "—"
            }
            percent={
              quotaUsage
                ? percentOf(quotaUsage.aiCredit.used, quotaUsage.aiCredit.limit)
                : 0
            }
          />
          <ShellPanelRow
            icon="gauge"
            label={t("usageLimit")}
            onClick={() => go("/quotas")}
          />
        </ShellPanelSection>

        <ShellPanelSection title={t("billing")}>
          <ShellPanelRow
            icon="receipt"
            label={`${t("monthlyCost")} ${billingLabel}`}
            description={t("monthlyCostDesc")}
            onClick={() => go("/billing")}
          />
          <ShellPanelRow
            icon="credit-card"
            label={t("payBill")}
            description={t("payBillDesc")}
            onClick={() => go("/billing")}
          />
        </ShellPanelSection>

        <ShellPanelSection title={t("plan")}>
          <ShellPanelRow
            icon="currency-cny"
            label={planName ?? t("freePlan")}
            onClick={() => go("/subscription")}
          />
        </ShellPanelSection>

        <ShellPanelSection>
          <ShellPanelRow
            icon="settings"
            label={t("tenantSettings")}
            onClick={() => go("/settings")}
          />

          {/* 切换范围:嵌套弹层,锚在这一行右侧。租户是真列表(批 4:此前只有一行
              「切换组织」,点下去跳到第一个非当前租户,三个租户的用户根本选不到
              第三个);工作区暂不可切(后端尚无多工作区),保留结构置灰,不假装能点。 */}
          <Popover open={scopeOpen} onOpenChange={setScopeOpen}>
            <PopoverTrigger asChild>
              <div>
                <ShellPanelRow
                  icon="arrow-left-right"
                  label={t("switchScope")}
                  active={scopeOpen}
                  onClick={() => setScopeOpen((current) => !current)}
                />
              </div>
            </PopoverTrigger>
            <ShellPanelContent side="right" align="start">
              <ShellPanelSection title={t("tenantList")} divided={false}>
                {tenantOptions.map((option) => (
                  <ShellPanelRow
                    key={option.id}
                    icon={option.type === "personal" ? "user" : "buildings"}
                    label={formatTenantDisplay(option.name, option.type)}
                    description={
                      option.type === "personal"
                        ? t("personalTenant")
                        : t("orgTenant")
                    }
                    active={option.isCurrent}
                    {...(option.isCurrent
                      ? { value: t("currentTag"), disabled: true }
                      : {
                          onClick: () => {
                            setOpen(false);
                            setScopeOpen(false);
                            onSwitchTenant(option.id);
                          },
                        })}
                  />
                ))}
              </ShellPanelSection>
              <ShellPanelSection title={t("workspace")}>
                <ShellPanelRow
                  icon="cube"
                  label={workspaceName || t("defaultWorkspace")}
                  description={t("workspaceSwitchComingSoon")}
                  value={t("defaultTag")}
                  disabled
                />
              </ShellPanelSection>
            </ShellPanelContent>
          </Popover>
        </ShellPanelSection>
      </ShellPanelContent>
    </Popover>
  );
}
