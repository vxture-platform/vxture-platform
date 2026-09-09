import type { Capability } from "@/entities/console";
import type { IconName } from "@vxture/design-system";

export interface NavigationItem {
  /**
   * 应用内路由。**纯外链项没有它**（见 `docsSection`）——那种项在 console 里
   * 没有页面，点它直接去文档站。
   */
  href?: string;
  labelKey: string;
  icon: IconName;
  descriptionKey: string;
  capability?: Capability;
  tenantTypes?: Array<"personal" | "organization">;
  /**
   * 副名，渲染成主名下方的小字第二行（DS 的 `ShellNavItem.subLabel`）。
   *
   * console 用它标**供给来源**：`模型服务 / Atlas`、`技能工具 / Runos`。
   * 注意这是**来源标注，不是入口**——点进去仍是租户自己的只读清单，
   * 既不通往 opera（那是运维平面），也不通往产品本体。
   *
   * 与 opera 的用法同源但更弱一层：opera 后置产品代号是因为「opera 管理 Atlas，
   * 不属于 Atlas」；console 连管理都不做，只是被供给方。
   */
  subLabel?: string;
  /**
   * 文档站的区段名。**给了它就没有 href**：这一项整行就是去文档站的跳转
   * （`/{locale}/docs/{docsSection}`，新标签页）。
   *
   * owner 2026-09-09 的裁定：模型服务 / 技能工具不需要 console 提供页面——
   * 它们答的是「这些能力是什么、怎么用」，那是文档的事；console 是工作台，
   * 装的是你能操作的东西。先前那版给了页面又在行尾挂个外链图标，是把一件事
   * 拆成了两个去处。
   *
   * 这里存**区段名**而不是完整 URL：URL 要拼当前 locale，而导航配置是静态的、
   * 拿不到 locale。拼接在外壳里做。
   */
  docsSection?: string;
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
    // owner 2026-09-09「把工作空间做成真轴」:建 / 改 / 设默认 / 停用有了真入口。
    //
    // 只给组织租户:个人租户永远只有一个工作空间,给它一个「管理工作空间」的入口,
    // 点进去是一条不能停用、不能改默认的记录——那不是功能,是噪音。
    //
    // 门用 `tenant.member.read`(看得见自己在哪些工作空间里,不是管理动作);
    // 页内的建 / 改 / 停各自再按 `tenant.workspace.manage` 收。
    {
      href: "/workspaces",
      labelKey: "workspaces.label",
      icon: "stack",
      descriptionKey: "workspaces.description",
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
    // 批 5a:「安全设置」并入「我的账号」(/profile),/security 路由保留跳转。
  ],
};

/**
 * 模型与能力（owner 2026-09-08，原名「平台能力」）。
 *
 * **租户视角、只读**：回答「我这个工作空间现在能用哪些模型 / 技能，额度多少、
 * 用了多少」。不回答「谁能用」「怎么配」——那些是运维平面（opera）的事。
 * 代码上也是这个形状：console-bff 的 atlas.router 只有三个 @Get，一个写入都没有，
 * 且整个 controller 挂 `tenant.model.read`；取数经 S2S 换 token 代理到上游，
 * 上游的 `/tenancy/*` 已按本工作空间的有效授权过滤。
 *
 * 项上的 subLabel 标供给来源（Atlas / Runos），**不是入口**。
 */
const capabilitySection: NavigationSection = {
  titleKey: "capability",
  items: [
    {
      labelKey: "modelService.label",
      icon: "database",
      descriptionKey: "modelService.description",
      subLabel: "Atlas",
      docsSection: "models",
      capability: "tenant.model.read",
    },
    {
      labelKey: "skillTools.label",
      icon: "stack",
      descriptionKey: "skillTools.description",
      subLabel: "Runos",
      docsSection: "skills",
      capability: "tenant.model.read",
    },
  ],
};

/* 模型与能力域的门:2026-09-04 起用租户侧目录码(tenant.model.read)。它暂不授予任何
 * 角色——/atlas 页面整改(批 7)前不对客户开放;此前挂的 platform.* 码在 console
 * 的能力派生里永远不会出现,等于一个永远关着、却没有锁的门。 */
const PLATFORM_CAPABILITIES: Capability[] = ["tenant.model.read"];

/**
 * 扁平导航分组（向后兼容）。不含模型与能力域——它仅经 consoleDomains 暴露。
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
    id: "capability",
    labelKey: "capability",
    icon: "database",
    capabilityAnyOf: PLATFORM_CAPABILITIES,
    sections: [capabilitySection],
  },
];
