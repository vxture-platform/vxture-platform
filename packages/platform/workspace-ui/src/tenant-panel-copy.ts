/**
 * Shared tenant panel copy keeps portal descriptions and scope labels aligned.
 * @package @vxture/platform-workspace-ui
 * @layer Infrastructure
 * @category presentation
 * @author AI-Generated
 * @date 2026-11-06
 */
import type { TenantPanelOverviewProps } from "./TenantPanelOverview";

// ============================================================================
// Localized panel presentation
// ============================================================================
interface TenantPanelCopy {
  overview: TenantPanelOverviewProps["labels"];
  organization: string;
  personal: string;
  billingPeriod: string;
  switchScope: string;
  switchScopeHint: string;
  defaultWorkspace: string;
  enterTenant: string;
}

const CHINESE: TenantPanelCopy = {
  overview: {
    resources: "资源",
    storage: "存储容量",
    aiCredits: "AI 点数",
    pointsUnit: "点",
    unavailable: "暂时无法读取用量",
    totalQuota: "总配额",
    usageSummary: (percent, used) => `已使用 ${used} · ${percent}%`,
    billing: "账务",
    accountBalance: "账户余额",
    balanceHint: "不含平台卡券",
    monthlyBill: "本月账单",
    tenantInfo: "组织信息",
    tenantInfoHint: "查看组织资料与认证",
  },
  organization: "组织租户",
  personal: "个人租户",
  billingPeriod: "本月后付费应付",
  switchScope: "切换组织",
  switchScopeHint: "选择组织及其工作空间",
  defaultWorkspace: "登录后默认进入",
  enterTenant: "进入此组织选择工作空间",
};

const ENGLISH: TenantPanelCopy = {
  overview: {
    resources: "Resources",
    storage: "Storage",
    aiCredits: "AI Credits",
    pointsUnit: "credits",
    unavailable: "Usage is temporarily unavailable",
    totalQuota: "Total quota",
    usageSummary: (percent, used) => `Used ${used} · ${percent}%`,
    billing: "Billing",
    accountBalance: "Account balance",
    balanceHint: "Excludes platform vouchers",
    monthlyBill: "Monthly bill",
    tenantInfo: "Organization information",
    tenantInfoHint: "Organization profile and verification",
  },
  organization: "Organization",
  personal: "Personal",
  billingPeriod: "Unpaid postpaid charges this month",
  switchScope: "Switch organization",
  switchScopeHint: "Choose an organization and its workspace",
  defaultWorkspace: "Default after sign-in",
  enterTenant: "Choose a workspace in this organization",
};

// ============================================================================
// Public locale selection
// ============================================================================
/**
 * Select one shared copy source for both portal adapters.
 * @param locale - Portal language; unsupported languages fall back to English.
 * @returns Read-only panel wording without portal-specific navigation details.
 */
export function getTenantPanelCopy(locale: string): Readonly<TenantPanelCopy> {
  return locale.toLowerCase().startsWith("zh") ? CHINESE : ENGLISH;
}
