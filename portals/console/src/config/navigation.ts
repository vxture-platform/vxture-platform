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
    {
      href: "/todos",
      labelKey: "todos.label",
      icon: "calendar",
      descriptionKey: "todos.description",
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
    {
      href: "/personal-tenant",
      labelKey: "personalTenant.label",
      icon: "buildings",
      descriptionKey: "personalTenant.description",
      tenantTypes: ["personal"],
    },
    {
      href: "/organization",
      labelKey: "organization.label",
      icon: "building-library",
      descriptionKey: "organization.description",
      tenantTypes: ["organization"],
    },
  ],
};

const membersPermissionsSection: NavigationSection = {
  titleKey: "membersPermissions",
  items: [
    {
      href: "/members",
      labelKey: "members.label",
      icon: "users",
      descriptionKey: "members.description",
      capability: "tenant.user.manage",
      tenantTypes: ["organization"],
    },
    {
      href: "/roles",
      labelKey: "roles.label",
      icon: "shield-check",
      descriptionKey: "roles.description",
      capability: "tenant.role.manage",
      tenantTypes: ["organization"],
    },
    {
      href: "/invitations",
      labelKey: "invitations.label",
      icon: "mail",
      descriptionKey: "invitations.description",
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
      capability: "tenant.subscription.read",
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

const advancedSettingsSection: NavigationSection = {
  titleKey: "advancedSettings",
  items: [
    {
      href: "/settings",
      labelKey: "systemSettings.label",
      icon: "settings",
      descriptionKey: "systemSettings.description",
    },
    {
      href: "/notifications",
      labelKey: "notifications.label",
      icon: "mail",
      descriptionKey: "notifications.description",
    },
    {
      href: "/security",
      labelKey: "security.label",
      icon: "shield-check",
      descriptionKey: "security.description",
    },
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
      capability: "platform.model.manage",
    },
  ],
};

const PLATFORM_CAPABILITIES: Capability[] = [
  "platform.tenant.manage",
  "platform.product.manage",
  "platform.pricing.manage",
  "platform.model.manage",
];

/**
 * 扁平导航分组（向后兼容）。不含平台域——平台能力仅经 consoleDomains 暴露。
 */
export const navigationSections: NavigationSection[] = [
  workspaceSection,
  accountTenantSection,
  membersPermissionsSection,
  subscriptionBillingSection,
  advancedSettingsSection,
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
    sections: [accountTenantSection, membersPermissionsSection],
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
    sections: [advancedSettingsSection],
  },
  {
    id: "platform",
    labelKey: "platform",
    icon: "database",
    capabilityAnyOf: PLATFORM_CAPABILITIES,
    sections: [platformSection],
  },
];
