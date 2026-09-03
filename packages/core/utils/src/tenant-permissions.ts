/**
 * tenant-permissions.ts - 租户 console 权限目录(customer realm 治理 RBAC)的代码侧权威源
 *
 * @package @vxture/core-utils
 * @description
 *   `access.permissions` 是**控制台菜单树模式**的权限目录(data_identity_200 §6.2):
 *   L1 板块 → L2 页面(带 route_path)→ L3 操作码。库里那份由
 *   `deploy/database/seed/seed-catalog.mjs` 灌入;这里是同一份树在代码侧的镜像,
 *   供 console 前端(导航 / 页面门 / 动作门)与 console-bff(路由守卫)引用——
 *   **前端与 BFF 不得手写权限码字符串**(identity/060 §7)。两份定义由
 *   `scripts/guardrails/check-tenant-permission-catalog.mjs` 逐码比对,漂移即 CI 红。
 *
 *   码的语义分两层(identity/060 §4.2、admin 侧同约定):
 *     - `{scope}.{resource}.read`   看得见这一页 / 这一类数据;
 *     - `{scope}.{resource}.manage` 能改;**`.manage` 蕴含同资源的 `.read`**——
 *       持 manage 者不必再单独授 read,守卫与前端门都按 `capabilitySatisfies` 判。
 *   `role.assign` / `delete` 这类动词码不带 read/manage 后缀,只做精确匹配。
 *
 *   角色 → 码的矩阵**不在这里**:那是数据(access.role_permissions),由 seed 与迁移
 *   写库、由 GovernanceService 回查;代码侧只认"当前用户实际持有哪些码"。
 */

/** 租户级操作码全集(tenant scope)。顺序无语义。 */
export const TENANT_PERMISSION_CODES = [
  "tenant.member.read",
  "tenant.member.manage",
  "tenant.role.assign",
  "tenant.workspace.manage",
  "tenant.settings.manage",
  "tenant.delete",
  "tenant.billing.read",
  "tenant.billing.manage",
  "tenant.payment.manage",
  "tenant.invoice.manage",
  "tenant.quota.read",
  "tenant.audit.read",
  "tenant.model.read",
] as const;

/** 工作空间级操作码(workspace scope)。console 暂无对应页面,仅目录完整性。 */
export const WORKSPACE_PERMISSION_CODES = [
  "workspace.member.manage",
  "workspace.role.assign",
  "workspace.settings.manage",
] as const;

export type TenantPermissionCode = (typeof TENANT_PERMISSION_CODES)[number];
export type WorkspacePermissionCode =
  (typeof WORKSPACE_PERMISSION_CODES)[number];
export type GovernancePermissionCode =
  | TenantPermissionCode
  | WorkspacePermissionCode;

/** 目录分组标签(access.permissions.category,开放标签)。 */
export type TenantPermissionCategory =
  | "member"
  | "security"
  | "settings"
  | "billing"
  | "quota"
  | "audit"
  | "model";

export interface TenantPermissionDef {
  readonly code: GovernancePermissionCode;
  readonly category: TenantPermissionCategory;
  /** 所属页面节点(菜单码);null = 没有 console 页面承载,留在目录根上。 */
  readonly page: TenantMenuCode | null;
}

/** 五个系统预置治理角色(access.roles, scope=tenant)。 */
export const TENANT_ROLE_CODES = [
  "owner",
  "manager",
  "member",
  "readonly",
  "guest",
] as const;
export type TenantRoleCode = (typeof TENANT_ROLE_CODES)[number];

/**
 * 菜单树:板块(L1)→ 页面(L2)。码沿用 console 导航注册表
 * (`portals/console/src/config/navigation.ts`)的 section/item 键,加 `tenant.menu.` 前缀。
 * `perms` = 挂在该页面下的操作码;一个操作码只挂一个页面(它实际作用的那一页)。
 * 没有操作码的页面是纯菜单叶子(总览 / 个人信息 / 收件箱…),任何成员可见。
 */
export interface TenantMenuNode {
  readonly code: TenantMenuCode;
  /** 页面路由;板块节点无。 */
  readonly route?: string;
  readonly perms?: readonly TenantPermissionCode[];
  readonly children?: readonly TenantMenuNode[];
}

export const TENANT_MENU_CODES = [
  "tenant.menu.workspace",
  "tenant.menu.overview",
  "tenant.menu.todos",
  "tenant.menu.account_tenant",
  "tenant.menu.profile",
  "tenant.menu.personal_tenant",
  "tenant.menu.organization",
  "tenant.menu.members_permissions",
  "tenant.menu.members",
  "tenant.menu.roles",
  "tenant.menu.invitations",
  "tenant.menu.subscription_billing",
  "tenant.menu.subscription",
  "tenant.menu.billing",
  "tenant.menu.vouchers",
  "tenant.menu.quotas",
  "tenant.menu.usage",
  "tenant.menu.advanced_settings",
  "tenant.menu.settings",
  "tenant.menu.inbox",
  "tenant.menu.notifications",
  "tenant.menu.audit_logs",
  "tenant.menu.security",
  "tenant.menu.platform",
  "tenant.menu.atlas",
] as const;
export type TenantMenuCode = (typeof TENANT_MENU_CODES)[number];

export const TENANT_MENU_TREE: readonly TenantMenuNode[] = [
  {
    code: "tenant.menu.workspace",
    children: [
      { code: "tenant.menu.overview", route: "/" },
      { code: "tenant.menu.todos", route: "/todos" },
    ],
  },
  {
    code: "tenant.menu.account_tenant",
    children: [
      { code: "tenant.menu.profile", route: "/profile" },
      { code: "tenant.menu.personal_tenant", route: "/personal-tenant" },
      {
        code: "tenant.menu.organization",
        route: "/organization",
        perms: ["tenant.settings.manage"],
      },
    ],
  },
  {
    code: "tenant.menu.members_permissions",
    children: [
      {
        code: "tenant.menu.members",
        route: "/members",
        perms: [
          "tenant.member.read",
          "tenant.member.manage",
          "tenant.role.assign",
        ],
      },
      { code: "tenant.menu.roles", route: "/roles" },
      { code: "tenant.menu.invitations", route: "/invitations" },
    ],
  },
  {
    code: "tenant.menu.subscription_billing",
    children: [
      {
        code: "tenant.menu.subscription",
        route: "/subscription",
        perms: [
          "tenant.billing.read",
          "tenant.billing.manage",
          "tenant.payment.manage",
        ],
      },
      {
        code: "tenant.menu.billing",
        route: "/billing",
        perms: ["tenant.invoice.manage"],
      },
      { code: "tenant.menu.vouchers", route: "/vouchers" },
      {
        code: "tenant.menu.quotas",
        route: "/quotas",
        perms: ["tenant.quota.read"],
      },
      { code: "tenant.menu.usage", route: "/usage" },
    ],
  },
  {
    code: "tenant.menu.advanced_settings",
    children: [
      {
        code: "tenant.menu.settings",
        route: "/settings",
        perms: ["tenant.workspace.manage", "tenant.delete"],
      },
      { code: "tenant.menu.inbox", route: "/inbox" },
      { code: "tenant.menu.notifications", route: "/notifications" },
      {
        code: "tenant.menu.audit_logs",
        route: "/audit-logs",
        perms: ["tenant.audit.read"],
      },
      { code: "tenant.menu.security", route: "/security" },
    ],
  },
  {
    code: "tenant.menu.platform",
    children: [
      {
        code: "tenant.menu.atlas",
        route: "/atlas",
        perms: ["tenant.model.read"],
      },
    ],
  },
];

function walkMenu(
  nodes: readonly TenantMenuNode[],
  visit: (node: TenantMenuNode, parent: TenantMenuNode | null) => void,
  parent: TenantMenuNode | null = null,
): void {
  for (const node of nodes) {
    visit(node, parent);
    if (node.children) walkMenu(node.children, visit, node);
  }
}

/** 操作码 → 所属页面节点码(树里没提到的码为 null)。 */
export const TENANT_PERMISSION_PAGE: Readonly<
  Record<GovernancePermissionCode, TenantMenuCode | null>
> = (() => {
  const map = Object.fromEntries(
    [...TENANT_PERMISSION_CODES, ...WORKSPACE_PERMISSION_CODES].map((c) => [
      c,
      null,
    ]),
  ) as Record<GovernancePermissionCode, TenantMenuCode | null>;
  walkMenu(TENANT_MENU_TREE, (node) => {
    for (const code of node.perms ?? []) map[code] = node.code;
  });
  return map;
})();

const CATEGORY_OF: Readonly<
  Record<GovernancePermissionCode, TenantPermissionCategory>
> = {
  "tenant.member.read": "member",
  "tenant.member.manage": "member",
  "tenant.role.assign": "security",
  "tenant.workspace.manage": "settings",
  "tenant.settings.manage": "settings",
  "tenant.delete": "security",
  "tenant.billing.read": "billing",
  "tenant.billing.manage": "billing",
  "tenant.payment.manage": "billing",
  "tenant.invoice.manage": "billing",
  "tenant.quota.read": "quota",
  "tenant.audit.read": "audit",
  "tenant.model.read": "model",
  "workspace.member.manage": "member",
  "workspace.role.assign": "security",
  "workspace.settings.manage": "settings",
};

/** 全目录定义(码 / 分组 / 所属页面)。 */
export const TENANT_PERMISSION_DEFS: readonly TenantPermissionDef[] = [
  ...TENANT_PERMISSION_CODES,
  ...WORKSPACE_PERMISSION_CODES,
].map((code) => ({
  code,
  category: CATEGORY_OF[code],
  page: TENANT_PERMISSION_PAGE[code],
}));

/** 页面路由 → 页面节点码(前端按当前路由找它的菜单节点)。 */
export const TENANT_MENU_BY_ROUTE: Readonly<Record<string, TenantMenuCode>> =
  (() => {
    const map: Record<string, TenantMenuCode> = {};
    walkMenu(TENANT_MENU_TREE, (node) => {
      if (node.route) map[node.route] = node.code;
    });
    return map;
  })();

export function isTenantPermissionCode(
  value: string,
): value is TenantPermissionCode {
  return (TENANT_PERMISSION_CODES as readonly string[]).includes(value);
}

export function isGovernancePermissionCode(
  value: string,
): value is GovernancePermissionCode {
  return (
    isTenantPermissionCode(value) ||
    (WORKSPACE_PERMISSION_CODES as readonly string[]).includes(value)
  );
}

/**
 * 单码满足判定:精确相等,或 required 是 `.read` 而 held 是同资源的 `.manage`。
 * 不做别的蕴含(manage 不蕴含 assign,owner 身份不在这里表达)。
 */
export function capabilitySatisfies(held: string, required: string): boolean {
  if (held === required) return true;
  if (required.endsWith(".read")) {
    return held === `${required.slice(0, -".read".length)}.manage`;
  }
  return false;
}

/** 持有集是否满足单个要求;`required` 为空视为不限制。 */
export function hasCapability(
  held: readonly string[],
  required?: string | null,
): boolean {
  if (!required) return true;
  return held.some((h) => capabilitySatisfies(h, required));
}

/** 命中 `required` 中任一即通过;空列表视为不限制。 */
export function hasAnyCapability(
  held: readonly string[],
  required?: readonly string[] | null,
): boolean {
  if (!required || required.length === 0) return true;
  return required.some((r) => hasCapability(held, r));
}
