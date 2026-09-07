import type { Capability } from "@/entities/console";
import type { IconName } from "@vxture/design-system";

export interface NavigationItem {
  href: string;
  labelKey: string;
  icon: IconName;
  descriptionKey: string;
  capability?: Capability;
  tenantTypes?: Array<"personal" | "organization">;
}

export interface NavigationSection {
  titleKey: string;
  items: NavigationItem[];
}

/**
 * 顶层视图（应用中心 / 控制台）。Header 九宫格 launcher 据此渲染切换项。
 */
export interface ConsoleView {
  id: "appcenter" | "console";
  labelKey: string;
  descriptionKey: string;
  icon: IconName;
}

/**
 * 功能域：导航分组之上的组织层，也是「灵活授权」的整域门控点。
 * `capabilityAnyOf` 命中任一即放行整域；为空则不做域级门控，
 * 仍由各 item 的 capability / tenantTypes 决定可见性。
 */
export interface ConsoleDomain {
  id: string;
  labelKey: string;
  icon: IconName;
  capabilityAnyOf?: Capability[];
  sections: NavigationSection[];
}

export const consoleViews: ConsoleView[] = [
  {
    id: "appcenter",
    labelKey: "views.appcenter.label",
    descriptionKey: "views.appcenter.description",
    icon: "squares-four",
  },
  {
    id: "console",
    labelKey: "views.console.label",
    descriptionKey: "views.console.description",
    icon: "settings",
  },
];

// ── Sections（屏幕分组）── 单独命名以便同时供 navigationSections（向后兼容）
// 与 consoleDomains（功能域注册表）复用。
const workspaceSection: NavigationSection = {
  titleKey: "workspace",
  items: [
    {
      href: "/",
      labelKey: "overview.label",
      icon: "home",
      descriptionKey: "overview.description",
    },
    // 批 4b(owner 2026-09-04):待办与消息合并为一个入口;/todos 路由保留跳转。
    {
      href: "/inbox",
      labelKey: "inbox.label",
      icon: "bell",
      descriptionKey: "inbox.description",
    },
  ],
};

const accountTenantSection: NavigationSection = {
  titleKey: "accountTenant",
  items: [
    {
      href: "/profile",
      labelKey: "profile.label",
      icon: "user",
      descriptionKey: "profile.description",
    },
    // 批 5c:租户信息 / 组织信息合成一条(个人与组织同结构,不再按租户类型分)。
    // 系统设置也并入这一页,故「高级设置」里不再有它。
    {
      href: "/tenant",
      labelKey: "tenantInfo.label",
      icon: "buildings",
      descriptionKey: "tenantInfo.description",
    },
    // 批 9(owner 2026-09-06):「成员与权限」整组撤销。成员管理并到这里,租户侧
    // 最终只剩三个板块;邀请记录成为成员管理页里的一段,角色管理成为它的二级页
    // `/members/roles`(平台统一定义、租户不可自定义,只提供查看)。
    {
      href: "/members",
      labelKey: "members.label",
      icon: "users",
      descriptionKey: "members.description",
      capability: "tenant.member.read",
      tenantTypes: ["organization"],
    },
  ],
};

const subscriptionBillingSection: NavigationSection = {
  titleKey: "subscriptionBilling",
  items: [
    {
      href: "/subscription",
      labelKey: "subscription.label",
      icon: "chart-bar",
      descriptionKey: "subscription.description",
      capability: "tenant.billing.read",
    },
    {
      href: "/billing",
      labelKey: "billing.label",
      icon: "calendar",
      descriptionKey: "billing.description",
      capability: "tenant.billing.read",
    },
    {
      href: "/vouchers",
      labelKey: "vouchers.label",
      icon: "ticket",
      descriptionKey: "vouchers.description",
      capability: "tenant.billing.read",
    },
    {
      href: "/quotas",
      labelKey: "quotas.label",
      icon: "database",
      descriptionKey: "quotas.description",
      capability: "tenant.quota.read",
    },
    {
      href: "/usage",
      labelKey: "usage.label",
      icon: "chart-line",
      descriptionKey: "usage.description",
      capability: "tenant.quota.read",
    },
  ],
};

const settingsSecuritySection: NavigationSection = {
  titleKey: "settingsSecurity",
  items: [
    // 批 5c:「系统设置」并入「租户信息」(/tenant),/settings 路由保留跳转。
    {
      href: "/notifications",
      labelKey: "notifications.label",
      icon: "mail",
      descriptionKey: "notifications.description",
    },
    {
      href: "/audit-logs",
      labelKey: "auditLogs.label",
      icon: "clipboard",
      descriptionKey: "auditLogs.description",
      capability: "tenant.audit.read",
    },
    // 批 5a:「安全设置」并入「账号信息」(/profile),/security 路由保留跳转。
  ],
};

const platformSection: NavigationSection = {
  titleKey: "platform",
  items: [
    {
      href: "/atlas",
      labelKey: "atlas.label",
      icon: "database",
      descriptionKey: "atlas.description",
      capability: "tenant.model.read",
    },
  ],
};

/* 平台能力域的门:2026-09-04 起用租户侧目录码(tenant.model.read)。它暂不授予任何
 * 角色——/atlas 页面整改(批 7)前不对客户开放;此前挂的 platform.* 码在 console
 * 的能力派生里永远不会出现,等于一个永远关着、却没有锁的门。 */
const PLATFORM_CAPABILITIES: Capability[] = ["tenant.model.read"];

/**
 * 扁平导航分组（向后兼容）。不含平台域——平台能力仅经 consoleDomains 暴露。
 */
export const navigationSections: NavigationSection[] = [
  workspaceSection,
  accountTenantSection,
  subscriptionBillingSection,
  settingsSecuritySection,
];

/**
 * 功能域注册表（view→domain→section→item 的 domain 层）。
 */
export const consoleDomains: ConsoleDomain[] = [
  {
    id: "workspace",
    labelKey: "workspace",
    icon: "squares-four",
    sections: [workspaceSection],
  },
  {
    id: "org",
    labelKey: "org",
    icon: "building-library",
    sections: [accountTenantSection],
  },
  {
    id: "billing",
    labelKey: "billing",
    icon: "chart-bar",
    sections: [subscriptionBillingSection],
  },
  {
    id: "settings",
    labelKey: "settings",
    icon: "settings",
    sections: [settingsSecuritySection],
  },
  {
    id: "platform",
    labelKey: "platform",
    icon: "database",
    capabilityAnyOf: PLATFORM_CAPABILITIES,
    sections: [platformSection],
  },
];
