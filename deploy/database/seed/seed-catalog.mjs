/**
 * seed-catalog.mjs — ① SYSTEM CATALOG seed (idempotent, raw `pg`).
 *
 * Target-state 18-schema DDL (deploy/database/ddl/). Seeds platform-level catalog data
 * (NOT sample tenants):
 *   admin    — operator realm: operator_role(7 preset +rank) + operator_permission(3-seg catalog)
 *              + operator_role_permission (super_admin full-grant, self-checked) + operator_account
 *              (systemadmin/superadmin built-ins) + operator_credential + settings (MFA policy)
 *   access   — customer governance RBAC: roles(10 = 5 ×2 scope tenant/workspace) + permissions(9)
 *              + role_permissions mapping (owner/manager only; member/readonly/guest empty)
 *   loyalty  — level_policies + level_thresholds (5 levels, placeholder growth config)
 *   kyc      — verification_policies baseline (platform, per tenant_type)
 *   appoidc  — oidc_clients (4 platform portals + one credential per first-party product; seeded
 *              AFTER product.products so every product client resolves its product_id inline —
 *              chk_oidc_clients_kind_product rejects a product client without one)
 *              + signing_keys (env-injected, dev placeholder skipped)
 *   product  — product_categories + products + launch_checklist_items + plans/versions/prices/components
 *              (which products may be seeded at all: 40-product-registry.md §5 — code-referenced
 *              first-party products only; planned products are registered via the opera catalog)
 *   model    — model_providers + models + model_price_rules (active models for readiness)
 *   identity — oauth_providers inbound federation broker config (feishu/dingtalk/google)
 *
 * Run directly:  DATABASE_URL=... node seed-catalog.mjs
 */

import { runSeed, isMain, ID, SYS } from "./seed-lib.mjs";

// ── Governance permission catalog (access.permissions) ────────────────────────
// [code, category, description]. category ∈ billing/member/security/settings (open label).
// NOTE (org→tenant rename): the retired 'org' scope became 'tenant' (access.roles CHECK is
// tenant/workspace), so the old `org.*` permission codes were renamed to `tenant.*` to stay
// consistent with the scope. Role↔permission is now by uuid (role_id/permission_id).
// 2026-09-04 console 权限配置体系(批 0a):补 `.read` 读侧码与商业面细分码,让
// member / readonly / guest 三个角色在 console 里真正可区分(此前三者治理码皆空,
// console 把「能看哪页」全靠 BFF 里一张手写映射表推出来)。`.manage` 蕴含同资源的
// `.read`(守卫与前端门统一按 @vxture/core-utils `capabilitySatisfies` 判)。
// 代码侧镜像 = packages/core/utils/src/tenant-permissions.ts,两处由
// scripts/guardrails/check-tenant-permission-catalog.mjs 逐码比对。
const PERMISSIONS = [
  ["tenant.member.read", "member", "View tenant members"],
  ["tenant.member.manage", "member", "Manage tenant members"],
  ["tenant.role.assign", "security", "Assign tenant roles"],
  ["tenant.workspace.manage", "settings", "Manage workspaces in the tenant"],
  ["tenant.settings.manage", "settings", "Manage tenant settings"],
  ["tenant.delete", "security", "Delete the tenant"],
  ["tenant.billing.read", "billing", "View subscriptions, orders and bills"],
  ["tenant.billing.manage", "billing", "Manage tenant billing & subscriptions"],
  ["tenant.payment.manage", "billing", "Declare payments and buy add-on packs"],
  [
    "tenant.invoice.manage",
    "billing",
    "Request invoices and manage billing addresses",
  ],
  ["tenant.quota.read", "quota", "View quotas and usage"],
  ["tenant.audit.read", "audit", "View the tenant audit log"],
  ["tenant.model.read", "model", "View model access for the tenant"],
  ["workspace.member.manage", "member", "Manage workspace members"],
  ["workspace.role.assign", "security", "Assign workspace roles"],
  ["workspace.settings.manage", "settings", "Manage workspace settings"],
];

// ── Tenant console menu tree (access.permissions 的 menu 层) ─────────────────
// 与 admin 的 MENU_TREE 同一套做法(见下方「Operator menu tree」注释):层级判据就是
// console 侧栏自己的信息架构(portals/console/src/config/navigation.ts:section →
// item),菜单码 = `tenant.menu.` + 那里的键;操作码挂在它实际作用的那一页下。
// 没有操作码的页面是纯菜单叶子(总览 / 个人信息 / 收件箱…),任何成员可见。
// 与 admin 的一处刻意不同:console 前端按**操作码**(如 tenant.billing.read)门控
// 页面,不按菜单码——菜单行只承载层级(角色页的权限树、未来的策略页),不进
// role_permissions。
const TENANT_MENU_TREE = [
  {
    code: "tenant.menu.workspace",
    name: "工作空间",
    icon: "squares-four",
    children: [
      {
        code: "tenant.menu.overview",
        name: "数据总览",
        route: "/",
        icon: "home",
      },
      {
        code: "tenant.menu.todos",
        name: "待办事项",
        route: "/todos",
        icon: "calendar",
      },
    ],
  },
  {
    code: "tenant.menu.account_tenant",
    name: "账户与租户",
    icon: "building-library",
    children: [
      {
        code: "tenant.menu.profile",
        name: "个人信息",
        route: "/profile",
        icon: "user",
      },
      // 批 5c(2026-09-05):租户信息 / 组织信息 / 系统设置三页合并为 `/tenant`。
      // 码不删(角色授权引用它们,删码即失权),三个节点同指新页;整树清理归批 8。
      {
        code: "tenant.menu.personal_tenant",
        name: "租户信息",
        route: "/tenant",
        icon: "buildings",
      },
      {
        code: "tenant.menu.organization",
        name: "组织信息",
        route: "/tenant",
        icon: "building-library",
        perms: ["tenant.settings.manage"],
      },
    ],
  },
  {
    code: "tenant.menu.members_permissions",
    name: "成员与权限",
    icon: "users",
    children: [
      {
        code: "tenant.menu.members",
        name: "成员管理",
        route: "/members",
        icon: "users",
        perms: [
          "tenant.member.read",
          "tenant.member.manage",
          "tenant.role.assign",
        ],
      },
      {
        code: "tenant.menu.roles",
        name: "角色管理",
        route: "/roles",
        icon: "shield-check",
      },
      {
        code: "tenant.menu.invitations",
        name: "邀请记录",
        route: "/invitations",
        icon: "mail",
      },
    ],
  },
  {
    code: "tenant.menu.subscription_billing",
    name: "订阅与计费",
    icon: "chart-bar",
    children: [
      {
        code: "tenant.menu.subscription",
        name: "产品订阅",
        route: "/subscription",
        icon: "chart-bar",
        perms: [
          "tenant.billing.read",
          "tenant.billing.manage",
          "tenant.payment.manage",
        ],
      },
      {
        code: "tenant.menu.billing",
        name: "账单管理",
        route: "/billing",
        icon: "calendar",
        perms: ["tenant.invoice.manage"],
      },
      {
        code: "tenant.menu.vouchers",
        name: "我的卡券",
        route: "/vouchers",
        icon: "ticket",
      },
      {
        code: "tenant.menu.quotas",
        name: "配额管理",
        route: "/quotas",
        icon: "database",
        perms: ["tenant.quota.read"],
      },
      {
        code: "tenant.menu.usage",
        name: "用量分析",
        route: "/usage",
        icon: "chart-line",
      },
    ],
  },
  {
    code: "tenant.menu.advanced_settings",
    name: "高级设置",
    icon: "settings",
    children: [
      {
        // 批 5c:并入 `/tenant`(策略与危险操作成为该页的两张卡)
        code: "tenant.menu.settings",
        name: "系统设置",
        route: "/tenant",
        icon: "settings",
        perms: ["tenant.workspace.manage", "tenant.delete"],
      },
      {
        code: "tenant.menu.inbox",
        name: "站内消息",
        route: "/inbox",
        icon: "bell",
      },
      {
        code: "tenant.menu.notifications",
        name: "通知提醒",
        route: "/notifications",
        icon: "mail",
      },
      {
        code: "tenant.menu.audit_logs",
        name: "审计日志",
        route: "/audit-logs",
        icon: "clipboard",
        perms: ["tenant.audit.read"],
      },
      {
        code: "tenant.menu.security",
        name: "安全设置",
        route: "/security",
        icon: "shield-check",
      },
    ],
  },
  {
    code: "tenant.menu.platform",
    name: "平台能力",
    icon: "database",
    children: [
      {
        code: "tenant.menu.atlas",
        name: "模型接入",
        route: "/atlas",
        icon: "database",
        perms: ["tenant.model.read"],
      },
    ],
  },
];
// flattenMenuTree 是下方的函数声明(提升),与 admin 树共用同一套拍平/挂靠逻辑。
const TENANT_MENU_NODES = flattenMenuTree(TENANT_MENU_TREE);
/** 操作码 → 所属页面菜单码。树里没提到的码留在根上,seed 会报出来。 */
const TENANT_PERM_PARENT = (() => {
  const map = {};
  const walk = (nodes) => {
    for (const node of nodes) {
      for (const code of node.perms ?? []) {
        if (map[code]) {
          throw new Error(
            `tenant permission ${code} hangs under two pages: ${map[code]} / ${node.code}`,
          );
        }
        map[code] = node.code;
      }
      if (node.children) walk(node.children);
    }
  };
  walk(TENANT_MENU_TREE);
  return map;
})();

// ── Role catalog: two-level, scope tenant/workspace (access.roles) ─────────────
// [scope, code, name]. All is_system=true (predefined, is_system-guarded, not deletable).
// 5 built-in roles per scope (design data_identity_200 §6.4): owner/manager/member/readonly/guest.
// readonly = internal view-all-no-write; guest = external/limited (design-complete; usage is business-side).
const ROLES = [
  // [scope, code, name, description] — i18n keys derived: access.role.{scope}.{code} (+.desc)
  [
    "tenant",
    "owner",
    "Tenant Owner",
    "Full control of the tenant, including all workspaces and governance settings.",
  ],
  [
    "tenant",
    "manager",
    "Tenant Manager",
    "Manages tenant members, roles, workspaces and settings.",
  ],
  [
    "tenant",
    "member",
    "Tenant Member",
    "Regular tenant member; business access only, no governance permissions.",
  ],
  [
    "tenant",
    "readonly",
    "Tenant Viewer",
    "Read-only visibility across the tenant; no write operations.",
  ],
  [
    "tenant",
    "guest",
    "Tenant Guest",
    "External or limited collaborator with restricted tenant access.",
  ],
  [
    "workspace",
    "owner",
    "Workspace Owner",
    "Full control of the workspace and its governance settings.",
  ],
  [
    "workspace",
    "manager",
    "Workspace Manager",
    "Manages workspace members and settings.",
  ],
  [
    "workspace",
    "member",
    "Workspace Member",
    "Regular workspace member; business access only.",
  ],
  [
    "workspace",
    "readonly",
    "Workspace Viewer",
    "Read-only visibility within the workspace.",
  ],
  [
    "workspace",
    "guest",
    "Workspace Guest",
    "External or limited collaborator within the workspace.",
  ],
];

// ── Role → permission mapping. ────────────────────────────────────────────────
// Governance RBAC only gates governance actions ("治理 RBAC ≠ 业务授权", data_identity_200 §6).
// member/readonly/guest get NO governance perms by design — they differ at the business-auth
// layer (OUT) + by role identity, not here. Only owner/manager carry governance perms.
const TENANT_ALL = PERMISSIONS.filter((p) => p[0].startsWith("tenant.")).map(
  (p) => p[0],
);
const WS_ALL = PERMISSIONS.filter((p) => p[0].startsWith("workspace.")).map(
  (p) => p[0],
);
// 2026-09-04 起 member / readonly / guest 不再皆空:读侧码让三者在 console 里可区分
// (data_identity_200 §6.4 矩阵)。readonly = 内部全域只读(所有 .read);member =
// 用产品的人(看成员目录 + 配额用量);guest = 外部受限,只有自助页。
// `tenant.model.read` 暂不授予任何角色:/atlas 页面整改(批 7)前不对客户开放,
// 但守卫已按它把 URL 直达封死。
const TENANT_MODEL_READ = "tenant.model.read";
const ROLE_PERMS = {
  "tenant:owner": [
    ...TENANT_ALL.filter((c) => c !== TENANT_MODEL_READ),
    ...WS_ALL,
  ],
  "tenant:manager": [
    "tenant.member.read",
    "tenant.member.manage",
    "tenant.role.assign",
    "tenant.workspace.manage",
    "tenant.settings.manage",
    "tenant.billing.read",
    "tenant.quota.read",
    "tenant.audit.read",
  ],
  "tenant:member": ["tenant.member.read", "tenant.quota.read"],
  "tenant:readonly": [
    "tenant.member.read",
    "tenant.billing.read",
    "tenant.quota.read",
    "tenant.audit.read",
  ],
  "tenant:guest": [],
  "workspace:owner": [...WS_ALL],
  "workspace:manager": ["workspace.member.manage", "workspace.settings.manage"],
  "workspace:member": [],
  "workspace:readonly": [],
  "workspace:guest": [],
};

// ══ Operator realm RBAC (admin.operator_*) — design data_admin_200 §4 ══════════
// perm_code = three-segment {domain}:{resource}.{action}; .manage ⊇ .read (both granted
// when a role has manage). 危 = high-risk (step-up enforced app-side). perm_type='api'.
// [perm_code, perm_name].
/**
 * 需要 step-up（二次验证）的操作码 —— `product_250` M-2：「每个操作码标注是否要求
 * step-up」，且「**step-up 策略归 platform**（横向管理面，全 L1 一视同仁）」。
 *
 * 2026-08-13 落地。此前这个标注只存在于上面那行注释里的「危」字和各条 description
 * 末尾的 "(high-risk)"，**没有任何一处是机器可读的**，后果是：各 provider 只能在自己
 * 代码里硬编码高危清单——atlas 曾在 `StepUpRequiredGuard` 写死 9 个写操作，runos 一条
 * 没有。两边都托管第三方密钥材料，保护等级却不同，而这个差异不是任何人决策的结果。
 * （已闭环：2026-08-13 atlas 撤除该守卫，vxture-atlas#167；两边现在都不判，判据统一
 * 落在这张表上。）
 *
 * **消费方是 console/BFF，不是 provider。** console 读这张目录，命中即在**动作发生的
 * 那一刻**跑 step-up 仪式（IdP 签 300s 短时凭证，见 auth-bff `issueOperatorStepUp`），
 * 过了再放行。provider 无 UI、跑不了仪式，只能拒绝；且它能看到的 `amr` 是**会话级**
 *（"登录时用过 MFA"，可能是 8 小时前）而非**操作级**（"此刻本人在键盘前"），
 * 强度本就不是一回事。
 *
 * **粗粒度码刻意不标。** `model:provider.manage` / `capability:runos.manage` 这类码
 * 同时覆盖"改 provider 简介"（无害）和"轮换密钥"（凭证材料），整码标 true 会把无害
 * 编辑也卡上二次验证。拆分归 provider（M-2：词表内容归 provider，platform 不代拟）
 * ——已 issue 交办 atlas / runos 注册操作级词表，落地后这里再补标。
 */
const STEP_UP_REQUIRED = new Set([
  // 不可逆的钱相关动作
  "commerce:order.void",
  "commerce:order.restore",
  "commerce:billing.discount",
  "commerce:invoice.void",
  "commerce:payment.settle",
  "commerce:refund.execute",
  "promotion:campaign.manage",
  // 身份 / 凭证材料：security:signing_key.manage / security:oidc_client.manage 两个码
  // 2026-08-31 退役——admin 里没有任何路由检查它们，挂着它们的「密钥管理」菜单也
  // 撤了（签名密钥归 deploy 27-provision，OIDC 客户端归 opera 接入凭据）。
  "operator:account.manage",
  "operator:role.manage",
  // 数据主体权益 / 越权视角
  "user:pii.read",
  "support:impersonate",
  "tenant:lifecycle.suspend",
]);

const OPERATOR_PERMISSIONS = [
  ["tenant:profile.read", "View tenant profiles"],
  ["tenant:profile.manage", "Manage tenant profiles"],
  ["tenant:verification.review", "Review tenant verification"],
  ["tenant:quota.read", "View tenant quota"],
  ["tenant:quota.manage", "Adjust tenant quota"],
  ["tenant:lifecycle.suspend", "Suspend/close tenant (high-risk)"],
  ["tenant:risk.read", "View tenant risk records"],
  ["tenant:risk.manage", "Manage tenant risk records"],
  ["user:profile.read", "View users (masked)"],
  ["user:pii.read", "View plaintext PII (high-risk)"],
  [
    "user:account.manage",
    "Manage customer account (disable/enable/force-logout)",
  ],
  ["commerce:subscription.read", "View subscriptions"],
  ["commerce:subscription.manage", "Manage subscriptions"],
  ["commerce:order.read", "View orders"],
  [
    "commerce:order.void",
    "Void unpaid order",
    "Void / reject an unpaid offline order (high-risk)",
  ],
  [
    "commerce:order.restore",
    "Restore voided order",
    "Restore a voided/expired offline order back to pending (high-risk)",
  ],
  ["commerce:billing.read", "View bills"],
  ["commerce:billing.manage", "Manage bills"],
  ["commerce:billing.discount", "Discount / write off a bill (high-risk)"],
  ["commerce:invoice.read", "View invoices"],
  ["commerce:invoice.manage", "Manage invoices"],
  ["commerce:invoice.void", "Void an issued invoice (high-risk)"],
  ["commerce:payment.read", "View payments"],
  ["commerce:payment.manage", "Manage payments"],
  ["commerce:payment.settle", "Settle / confirm a payment (high-risk)"],
  ["commerce:refund.execute", "Execute refund (high-risk)"],
  ["promotion:campaign.read", "View voucher batches / redemptions"],
  [
    "promotion:campaign.manage",
    "Create voucher batches / assign vouchers (high-risk)",
  ],
  ["product:plan.read", "View plans"],
  ["product:plan.manage", "Manage plans"],
  ["product:price.read", "View pricing"],
  ["product:price.manage", "Manage pricing"],
  ["model:provider.read", "View model providers"],
  ["model:provider.manage", "Manage model providers"],
  ["model:model.read", "View models"],
  ["model:model.manage", "Manage models"],
  ["capability:runos.read", "View runos capabilities and endpoints"],
  [
    "capability:runos.manage",
    "Register / promote runos capabilities and endpoints",
  ],
  ["release:feature_flag.read", "View feature flags"],
  ["release:feature_flag.manage", "Manage feature flags"],
  ["release:maintenance.read", "View maintenance windows"],
  ["release:maintenance.manage", "Manage maintenance windows"],
  ["platform:setting.read", "View platform settings (sensitive masked)"],
  ["platform:setting.manage", "Manage platform settings (system config)"],
  ["platform:product.read", "View the product catalog"],
  ["platform:product.manage", "Register / edit products, manage OIDC clients"],
  ["content:announcement.read", "View announcements"],
  ["content:announcement.manage", "Manage announcements"],
  ["notification:log.read", "View notification delivery logs"],
  ["support:ticket.read", "View tickets"],
  ["support:ticket.manage", "Manage tickets"],
  ["support:impersonate", "Impersonate customer (high-risk)"],
  ["compliance:event.read", "View compliance events"],
  ["compliance:event.manage", "Manage compliance events"],
  ["operator:account.manage", "Manage operator accounts (high-risk)"],
  ["operator:role.manage", "Manage operator roles (high-risk)"],
  ["audit:read", "View audit logs"],
];

// Operator roles: [role_code, rank, name_en, i18n_key, description, sort, mfa_min_level].
// rank = tier for cross-operator gating (strictly-greater to manage); manage capability is
// carried by operator:account.manage (super_admin only), independent of rank. sys_config = meta
// role (rank 0, non-login). Values per data_admin_200 §4.1.
const OPERATOR_ROLES = [
  // sys_config rank=999 (2026-07-05 owner): highest tier so no rank-gate can ever manage
  // the meta anchor; the role itself carries ZERO permissions, so the high rank confers
  // no capability (re-derived from the old "rank=0 cosmetic" stance).
  [
    "sys_config",
    999,
    "System Config",
    "ops.role.sys_config",
    "Platform self-governance config meta-role, used as createdBy for system-init data.",
    0,
    "optional",
  ],
  [
    "super_admin",
    100,
    "Super Admin",
    "ops.role.super_admin",
    "Platform built-in super admin with all permissions.",
    1,
    "required",
  ],
  [
    "admin",
    80,
    "Admin",
    "ops.role.admin",
    "Platform admin: all business domains, excludes operator management and security keys.",
    2,
    "required",
  ],
  [
    "operation",
    60,
    "Operation",
    "ops.role.operation",
    "Tenant / plan / content / growth operations.",
    3,
    "required",
  ],
  [
    "finance",
    60,
    "Finance",
    "ops.role.finance",
    "Subscriptions / orders / refunds / invoices / revenue reports.",
    4,
    "required",
  ],
  [
    "tech_ops",
    50,
    "SRE",
    "ops.role.tech_ops",
    "Model supply / release / maintenance windows / system settings.",
    5,
    "required",
  ],
  [
    "support",
    30,
    "Support",
    "ops.role.support",
    "Tickets / masked tenant lookup / notifications.",
    6,
    "optional",
  ],
  [
    "auditor",
    10,
    "Auditor",
    "ops.role.auditor",
    "Read-only across all domains + audit logs, zero write.",
    7,
    "required",
  ],
];

// ══ Operator menu tree (admin.operator_permission 的 menu 层) ═════════════════
//
// 这张表此前只有 59 条 perm_type='api' 的操作码，全部 parent_id = NULL——于是
// 「权限策略」页拿不到任何层级：它按 `admin.workspace.tenant_ops` /
// `admin.workspace.platform` 两个根锚点分域（见 AdminPermissionsPage 的
// `resolvePermissionDomain`），两个码都不存在，59 条便全落进兜底分组
// 「基础系统权限」，L1/L2/L3 计数恒为 0，展开钮全灰。
//
// 层级判据不是新发明的，就是运营台侧栏自己的信息架构
// （`portals/admin/src/config/navigation.ts`：workspace → section → item）：
//
//   L0  域      运营业务域 / 平台自治域          ← 页面分域的锚点
//   L1  板块    租户账号、订阅交易、安全审计…    ← 侧栏分组
//   L2  页面    租户信息、交易订单…              ← 侧栏条目，带 route_path
//   L3  操作    tenant:profile.manage…           ← 既有的 api 码
//
// 叶子挂在**它实际作用的那个页面**下，而不是按 perm_code 的域前缀分——
// `tenant:risk.*` 前缀是 tenant，但风险记录页在平台自治域的「安全审计」板块下，
// 就挂那儿。前缀是命名空间，不是归属。
//
// 菜单码沿用 navigation.ts 里每个 section/item 已有的 `code`，加
// `admin.menu.` 前缀；域锚点用页面已经在找的那两个常量。没有对应操作码的页面
// 就是叶子菜单节点，不补造操作码。
const MENU_TREE = [
  {
    code: "admin.workspace.tenant_ops",
    name: "运营业务域",
    icon: "buildings",
    children: [
      {
        code: "admin.menu.operation_overview_group",
        name: "运营总览",
        children: [
          {
            code: "admin.menu.operation_overview",
            name: "运营总览",
            route: "/",
          },
          {
            code: "admin.menu.operation_todo",
            name: "待办任务",
            route: "/ops-todos",
          },
        ],
      },
      {
        code: "admin.menu.tenant_account",
        name: "租户账号",
        children: [
          {
            code: "admin.menu.tenant_profile",
            name: "租户信息",
            route: "/tenants",
            perms: [
              "tenant:profile.read",
              "tenant:profile.manage",
              "tenant:quota.read",
              "tenant:quota.manage",
              "tenant:lifecycle.suspend",
            ],
          },
          {
            code: "admin.menu.account_system",
            name: "账号体系",
            route: "/accounts",
            perms: [
              "user:profile.read",
              "user:pii.read",
              "user:account.manage",
            ],
          },
          {
            code: "admin.menu.identity_verification",
            name: "实名认证",
            route: "/verifications",
            perms: ["tenant:verification.review"],
          },
        ],
      },
      {
        code: "admin.menu.product_system",
        name: "产品体系",
        children: [
          {
            code: "admin.menu.product_capability",
            name: "产品能力",
            route: "/products",
            perms: ["platform:product.read", "platform:product.manage"],
          },
          {
            code: "admin.menu.solution_package",
            name: "解决方案",
            route: "/product-solutions",
          },
          {
            code: "admin.menu.service_plan",
            name: "服务套餐",
            route: "/service-plans",
            perms: [
              "product:plan.read",
              "product:plan.manage",
              "product:price.read",
              "product:price.manage",
            ],
          },
          {
            code: "admin.menu.plan_version",
            name: "套餐版本",
            route: "/plan-versions",
          },
          {
            code: "admin.menu.promotion_campaign",
            name: "营销优惠",
            route: "/promotions",
            perms: ["promotion:campaign.read", "promotion:campaign.manage"],
          },
        ],
      },
      {
        code: "admin.menu.subscription_transaction",
        name: "订阅交易",
        children: [
          {
            code: "admin.menu.subscription",
            name: "订阅管理",
            route: "/subscriptions",
            perms: [
              "commerce:subscription.read",
              "commerce:subscription.manage",
            ],
          },
          {
            code: "admin.menu.order_record",
            name: "交易订单",
            route: "/orders",
            perms: [
              "commerce:order.read",
              "commerce:order.void",
              "commerce:order.restore",
            ],
          },
          {
            code: "admin.menu.addon_order_record",
            name: "加油包订单",
            route: "/addon-orders",
          },
          {
            code: "admin.menu.usage_billing",
            name: "用量计费",
            route: "/usage-metering",
          },
          {
            code: "admin.menu.promotion_redeem",
            name: "优惠核销",
            route: "/promotion-redemptions",
          },
        ],
      },
      {
        code: "admin.menu.commercial_analysis",
        name: "商业分析",
        children: [
          {
            code: "admin.menu.commerce_overview",
            name: "商业总览",
            route: "/commerce-overview",
          },
        ],
      },
      {
        code: "admin.menu.model_skill",
        name: "模型技能",
        children: [
          {
            code: "admin.menu.model_access",
            name: "模型授权",
            route: "/model-grants",
          },
          {
            code: "admin.menu.skill_market",
            name: "技能市场",
            route: "/skills",
            perms: ["capability:runos.read", "capability:runos.manage"],
          },
        ],
      },
      {
        code: "admin.menu.finance_settlement",
        name: "财务结算",
        children: [
          {
            code: "admin.menu.billing_center",
            name: "账单中心",
            route: "/billing",
            perms: [
              "commerce:billing.read",
              "commerce:billing.manage",
              "commerce:billing.discount",
            ],
          },
          {
            code: "admin.menu.payment_record",
            name: "收款管理",
            route: "/payments",
            perms: [
              "commerce:payment.read",
              "commerce:payment.manage",
              "commerce:payment.settle",
              "commerce:refund.execute",
            ],
          },
          {
            code: "admin.menu.invoice_record",
            name: "发票管理",
            route: "/invoices",
            perms: [
              "commerce:invoice.read",
              "commerce:invoice.manage",
              "commerce:invoice.void",
            ],
          },
        ],
      },
      {
        code: "admin.menu.customer_service",
        name: "客户服务",
        children: [
          {
            code: "admin.menu.support_ticket",
            name: "工单中心",
            route: "/tickets",
            perms: [
              "support:ticket.read",
              "support:ticket.manage",
              "support:impersonate",
            ],
          },
          {
            code: "admin.menu.notification_message",
            name: "消息公告",
            route: "/announcements",
            perms: ["content:announcement.read", "content:announcement.manage"],
          },
        ],
      },
    ],
  },
  {
    code: "admin.workspace.platform",
    name: "平台自治域",
    icon: "shield-check",
    children: [
      // 「平台总览」这个 section 只有一个同名条目，不造冗余的分组层。
      {
        code: "admin.menu.platform_overview",
        name: "平台总览",
        route: "/platform",
      },
      {
        code: "admin.menu.identity_access",
        name: "身份权限",
        children: [
          {
            code: "admin.menu.platform_admin",
            name: "平台用户",
            route: "/platform-admins",
            perms: ["operator:account.manage"],
          },
          {
            code: "admin.menu.platform_role",
            name: "平台角色",
            route: "/admin-roles",
            perms: ["operator:role.manage"],
          },
          {
            code: "admin.menu.permission_policy",
            name: "权限策略",
            route: "/admin-permissions",
          },
        ],
      },
      {
        code: "admin.menu.platform_resource",
        name: "平台资源",
        children: [
          {
            code: "admin.menu.model_gateway",
            name: "模型平台",
            route: "/atlas",
            perms: [
              "model:provider.read",
              "model:provider.manage",
              "model:model.read",
              "model:model.manage",
            ],
          },
          // 密钥管理 / 审批中心 / 字典管理 / 通知渠道四个菜单节点 2026-08-31 退役
          // （owner 2026-08-30：上线前摘掉永远为空的菜单项，40-menu.md 1.2.0）。
          // 存量库的行由 migrations/2026-08-31-admin-retire-empty-menus.sql 删除，
          // 本 seed 只是不再写入。
        ],
      },
      {
        code: "admin.menu.security_audit",
        name: "安全审计",
        children: [
          {
            code: "admin.menu.audit_log",
            name: "审计日志",
            route: "/audit-logs",
            perms: ["audit:read"],
          },
          {
            code: "admin.menu.risk_record",
            name: "风险记录",
            route: "/risk-records",
            // 码前缀是 tenant:，但风险记录页在自治域的安全审计板块下。
            perms: ["tenant:risk.read", "tenant:risk.manage"],
          },
          {
            code: "admin.menu.compliance_event",
            name: "合规事件",
            route: "/compliance-events",
            perms: ["compliance:event.read", "compliance:event.manage"],
          },
        ],
      },
      {
        code: "admin.menu.system_setting",
        name: "系统配置",
        children: [
          {
            code: "admin.menu.system_setting_general",
            name: "系统设置",
            route: "/settings",
            perms: [
              "platform:setting.read",
              "platform:setting.manage",
              "release:maintenance.read",
              "release:maintenance.manage",
            ],
          },
          {
            code: "admin.menu.system_parameter",
            name: "参数配置",
            route: "/system-parameters",
          },
          {
            code: "admin.menu.feature_toggle",
            name: "开关控制",
            route: "/feature-toggles",
            perms: ["release:feature_flag.read", "release:feature_flag.manage"],
          },
        ],
      },
      {
        code: "admin.menu.notification_center",
        name: "通知中心",
        children: [
          {
            code: "admin.menu.notification_log",
            name: "发送记录",
            route: "/notification-logs",
            perms: ["notification:log.read"],
          },
        ],
      },
    ],
  },
];

/** 树拍平成 [{code, name, route, parent, sort, depth}]，sort 用同级序号。 */
function flattenMenuTree(nodes, parent = null, out = [], depth = 0) {
  nodes.forEach((node, i) => {
    out.push({
      code: node.code,
      name: node.name,
      route: node.route ?? null,
      icon: node.icon ?? null,
      parent,
      sort: (i + 1) * 10,
      depth,
    });
    if (node.children)
      flattenMenuTree(node.children, node.code, out, depth + 1);
  });
  return out;
}

const MENU_NODES = flattenMenuTree(MENU_TREE);

/** 操作码 → 它所属的菜单码。树里没提到的码留在根上，seed 会报出来。 */
const PERM_PARENT = (() => {
  const map = {};
  const walk = (nodes) => {
    for (const node of nodes) {
      for (const code of node.perms ?? []) map[code] = node.code;
      if (node.children) walk(node.children);
    }
  };
  walk(MENU_TREE);
  return map;
})();

// Operator role → perm_code mapping (design data_admin_200 §4.3). super_admin computed = ALL.
// 菜单节点也是 operator_permission 的行，同样要进授权面：§4.4 的全量授权不变式
// 数的是整张表，漏掉菜单层 seed 会直接抛（实测 59/113）。
const OP_ALL = [
  ...OPERATOR_PERMISSIONS.map((p) => p[0]),
  ...MENU_NODES.map((n) => n.code),
];
const OPERATOR_ROLE_PERMS = {
  sys_config: [],
  super_admin: [...OP_ALL], // §4.4 explicit full grant (no code bypass)
  admin: [
    "tenant:profile.read",
    "tenant:profile.manage",
    "tenant:verification.review",
    "tenant:quota.read",
    "tenant:quota.manage",
    "tenant:lifecycle.suspend",
    "tenant:risk.read",
    "tenant:risk.manage",
    "compliance:event.read",
    "compliance:event.manage",
    "user:profile.read",
    "user:pii.read",
    "user:account.manage",
    "commerce:subscription.read",
    "commerce:subscription.manage",
    "commerce:order.read",
    "commerce:order.void",
    "commerce:order.restore",
    "commerce:billing.read",
    "commerce:billing.manage",
    "commerce:billing.discount",
    "commerce:invoice.read",
    "commerce:invoice.manage",
    "commerce:invoice.void",
    "commerce:payment.read",
    "commerce:payment.manage",
    "commerce:payment.settle",
    "commerce:refund.execute",
    "promotion:campaign.read",
    "promotion:campaign.manage",
    "product:plan.read",
    "product:plan.manage",
    "product:price.read",
    "product:price.manage",
    "model:provider.read",
    "model:provider.manage",
    "model:model.read",
    "model:model.manage",
    "capability:runos.read",
    "capability:runos.manage",
    "release:feature_flag.read",
    "release:feature_flag.manage",
    "release:maintenance.read",
    "release:maintenance.manage",
    "platform:setting.read",
    "platform:product.read",
    "platform:product.manage",
    "content:announcement.read",
    "content:announcement.manage",
    "notification:log.read",
    "support:ticket.read",
    "support:ticket.manage",
    "support:impersonate",
    "audit:read",
  ],
  operation: [
    "tenant:profile.read",
    "tenant:profile.manage",
    "tenant:verification.review",
    "tenant:quota.read",
    "tenant:quota.manage",
    "tenant:risk.read",
    "tenant:risk.manage",
    "user:profile.read",
    "commerce:subscription.read",
    "commerce:order.read",
    "promotion:campaign.read",
    "product:plan.read",
    "product:plan.manage",
    "product:price.read",
    "product:price.manage",
    "model:provider.read",
    "model:model.read",
    "capability:runos.read",
    "platform:product.read",
    "release:feature_flag.read",
    "release:maintenance.read",
    "content:announcement.read",
    "content:announcement.manage",
    "support:ticket.read",
  ],
  finance: [
    "tenant:profile.read",
    "tenant:quota.read",
    "user:profile.read",
    "commerce:subscription.read",
    "commerce:subscription.manage",
    "commerce:order.read",
    "commerce:order.void",
    "commerce:order.restore",
    "commerce:billing.read",
    "commerce:billing.manage",
    "commerce:billing.discount",
    "commerce:invoice.read",
    "commerce:invoice.manage",
    "commerce:invoice.void",
    "commerce:payment.read",
    "commerce:payment.manage",
    "commerce:payment.settle",
    "commerce:refund.execute",
    "promotion:campaign.read",
    "promotion:campaign.manage",
    "product:plan.read",
    "product:price.read",
  ],
  tech_ops: [
    "tenant:profile.read",
    "tenant:quota.read",
    "model:provider.read",
    "model:provider.manage",
    "model:model.read",
    "model:model.manage",
    "capability:runos.read",
    "capability:runos.manage",
    "release:feature_flag.read",
    "release:feature_flag.manage",
    "release:maintenance.read",
    "release:maintenance.manage",
    "platform:setting.read",
    "platform:setting.manage",
    "platform:product.read",
    "platform:product.manage",
    "content:announcement.read",
    "notification:log.read",
  ],
  support: [
    "tenant:profile.read",
    "user:profile.read",
    "commerce:subscription.read",
    "commerce:order.read",
    "support:ticket.read",
    "support:ticket.manage",
    "notification:log.read",
  ],
  auditor: [
    "tenant:profile.read",
    "tenant:quota.read",
    "tenant:risk.read",
    "compliance:event.read",
    "user:profile.read",
    "commerce:subscription.read",
    "commerce:order.read",
    "commerce:billing.read",
    "commerce:invoice.read",
    "commerce:payment.read",
    "product:plan.read",
    "product:price.read",
    "model:provider.read",
    "model:model.read",
    "capability:runos.read",
    "platform:product.read",
    "release:feature_flag.read",
    "release:maintenance.read",
    "platform:setting.read",
    "content:announcement.read",
    "notification:log.read",
    "support:ticket.read",
    "audit:read",
  ],
};

/**
 * 非 super_admin 的角色按**它已有的操作码**闭包出菜单授权：一个角色能做
 * `commerce:order.void`，就该看得见「交易订单」这个页面，以及它上面的「订阅交易」
 * 板块和「运营业务域」。逐个角色手写菜单清单会立刻和操作码清单脱节——闭包是从
 * 同一份事实推出来的，改了操作码授权，菜单跟着动。
 *
 * 纯菜单叶子（没有对应操作码的页面，如「加油包订单」）不进任何非 super_admin
 * 角色：没有判据说谁该看见它。等这些页面有了自己的操作码再自然带出来。
 */
const MENU_PARENT_OF = Object.fromEntries(
  MENU_NODES.map((n) => [n.code, n.parent]),
);
function withMenuClosure(permCodes) {
  const out = new Set(permCodes);
  for (const code of permCodes) {
    let menu = PERM_PARENT[code];
    while (menu) {
      out.add(menu);
      menu = MENU_PARENT_OF[menu];
    }
  }
  return [...out];
}
for (const [role, codes] of Object.entries(OPERATOR_ROLE_PERMS)) {
  if (role === "super_admin" || !codes.length) continue;
  OPERATOR_ROLE_PERMS[role] = withMenuClosure(codes);
}

export async function seedCatalog(client) {
  // ── 0. Live column-width patch (2026-07-30) ───────────────────────────────
  //   DDL baseline (80_admin.sql / 18_access.sql) now declares perm_name
  //   varchar(128); this repo's clean-baseline apply.sh only CREATEs on
  //   --reset (destructive, not viable against a live prod DB with real data),
  //   so a safe metadata-only ALTER COLUMN TYPE rides along in the seed path
  //   instead (idempotent, no-op once already widened). After this runs once
  //   against a given DB, also run `action=restamp-ddl-baseline` in db-init.yml
  //   (deploy/scripts/28c-restamp-ddl-baseline.sh) so 30-verify's [B0] DDL
  //   fingerprint check reflects reality instead of staying permanently red.
  await client.query(
    `alter table admin.operator_permission alter column perm_name type varchar(128)`,
  );
  await client.query(
    `alter table access.permissions alter column perm_name type varchar(128)`,
  );

  //   requires_step_up (2026-08-13, product_250 v0.4 §M-2 补注) — 同一条道理:
  //   80_admin.sql 已声明这一列，但 clean-baseline 的 apply.sh 只在 --reset 时
  //   CREATE，对有真实数据的活库不可行。所以补一条幂等 ALTER 走 seed 通道，
  //   否则下面 OPERATOR_PERMISSIONS 的 insert 会在活库上直接 42703 报错、整个
  //   seed 回滚（2026-08-13 本地实测就是这样炸的——先加 DDL 声明、没配 ALTER）。
  //   新建库从 ddl/80_admin.sql 拿到它，这里是 no-op。
  await client.query(
    `alter table admin.operator_permission add column if not exists requires_step_up boolean not null default false`,
  );

  // ── 1. operator realm: operator_role + operator_account + operator_credential ─
  //   Two built-in accounts:
  //   • systemadmin — account_type=system_builtin, status=disabled, NO credential:
  //     a meta anchor / created_by for system-init rows; never logs in.
  //   • superadmin  — account_type=system, status=active: the ONLY username+password
  //     login at bootstrap. Password defaults to Admin@2026 (force_password_change=true)
  //     in NON-production only — the default is public in this repo, so the 23/29
  //     seed runners fail closed unless OPERATOR_SUPERADMIN_PASSWORD_HASH is set
  //     (2026-07-21 gate).
  //   The seed container has no hashing libs, so the default is a precomputed Argon2id PHC.
  const DEFAULT_SUPERADMIN_HASH =
    "$argon2id$v=19$m=65536,t=3,p=1$Z2riL/tYwCUFpQK5jq/uVQ$l6hiSqwHPlc8IgK5DDBT9qPAveujOQak9lHVHUI+icE"; // Admin@2026
  const envHash = (
    process.env.OPERATOR_SUPERADMIN_PASSWORD_HASH || ""
  ).startsWith("$argon2")
    ? process.env.OPERATOR_SUPERADMIN_PASSWORD_HASH
    : null;
  const superadminHash = envHash ?? DEFAULT_SUPERADMIN_HASH;
  const forcePwChange = !envHash; // default password → must change after first login

  // 7 preset roles + rank (design data_admin_200 §4.1). Anchor rows sys_config/super_admin
  // keep pinned sentinel UUIDs (referenced by accounts); the rest use gen_random_uuid + role_code
  // natural key. High-privilege roles → MFA floor required (enforced once P2 lands).
  const OP_ROLE_PINNED = {
    sys_config: ID.roleSystem,
    super_admin: ID.roleSuperAdmin,
  };
  for (const [
    code,
    rank,
    roleName,
    nameKey,
    desc,
    sort,
    mfa,
  ] of OPERATOR_ROLES) {
    await client.query(
      `
      insert into admin.operator_role
        (id, role_code, status, role_name, role_name_key, description, description_key, is_system, sort, rank, mfa_min_level, is_workforce_visible)
      values (coalesce($1::uuid, gen_random_uuid()), $2, 'active', $3, $4, $5, $6, true, $7, $8, $9, $10)
      on conflict (role_code) do update set rank = excluded.rank, is_workforce_visible = excluded.is_workforce_visible
    `,
      [
        OP_ROLE_PINNED[code] ?? null,
        code,
        roleName,
        nameKey,
        desc,
        `${nameKey}.desc`,
        sort,
        rank,
        mfa,
        code !== "sys_config",
      ],
    );
  }

  const roleRes = await client.query(
    `select id, role_code from admin.operator_role`,
  );
  const opsRoleMap = Object.fromEntries(
    roleRes.rows.map((r) => [r.role_code, r.id]),
  );

  // systemadmin: meta anchor — disabled + no credential ⇒ cannot log in.
  // superadmin: active, created_by systemadmin; contact seeded for recovery/notifications.
  // superadmin contact is seed-trusted → email_verified/phone_verified = true so
  // out-of-band reset can target it from bootstrap (TD-017 §③).
  await client.query(
    `
    insert into admin.operator_account
      (id, role_id, username, display_name, status, account_type, email, email_verified, phone, phone_verified, created_by, remark, sort, is_workforce_visible, created_at, updated_at)
    values
      ($1, $3, 'systemadmin', 'systemadmin', 'disabled', 'system_builtin', null, false, null, false, null,
       'Platform meta account / created_by for system-init data. Disabled, no credential — never logs in.', 0, false, now(), now()),
      ($2, $4, 'superadmin',  'Super Admin', 'active',   'system',         $5::varchar,   $5 is not null,  $6::varchar,   $6 is not null,  $1,
       'Built-in super admin. Bootstrap username+password login; all platform permissions.', 1, true, now(), now())
    on conflict (username) do update set
      email = coalesce(excluded.email, admin.operator_account.email),
      phone = coalesce(excluded.phone, admin.operator_account.phone),
      is_workforce_visible = excluded.is_workforce_visible,
      updated_at = now()
  `,
    [
      ID.adminSystem,
      ID.adminSuperAdmin,
      opsRoleMap["sys_config"] ?? ID.roleSystem,
      opsRoleMap["super_admin"] ?? ID.roleSuperAdmin,
      // Contact env-projected by 23/29 (owner PII no longer hardcoded in the
      // repo, 2026-07-21). null → fresh seed leaves them unset and a re-seed
      // keeps the existing DB values via the coalesce in on-conflict.
      process.env.OPERATOR_SUPERADMIN_EMAIL || null,
      process.env.OPERATOR_SUPERADMIN_PHONE || null,
    ],
  );

  // Credential (Argon2id; 1-1). Only superadmin gets one (systemadmin never auths).
  // do-nothing on conflict so an idempotent re-seed never resets a changed password.
  await client.query(
    `
    insert into admin.operator_credential (operator_id, password_hash, force_password_change, created_at, updated_at)
    values ($1, $2, $3, now(), now())
    on conflict (operator_id) do nothing
  `,
    [ID.adminSuperAdmin, superadminHash, forcePwChange],
  );
  console.log(
    `✓  admin — 7 operator_role (+rank) + operator_account (systemadmin/superadmin) + credential (password=${envHash ? "env override" : "default Admin@2026"})`,
  );

  // ── operator_permission catalog (three-segment perm_code; perm_type=api) ─────
  // gen_random_uuid + perm_code natural key (no pinned UUIDs; mapping resolves by code).
  // created_by/updated_by = SYS (systemadmin meta; bare value, no FK).
  // Third tuple element is an optional longer description (up to varchar(255));
  // omitted → description mirrors the short display name, same as before.
  for (const [code, name, description] of OPERATOR_PERMISSIONS) {
    await client.query(
      `
      insert into admin.operator_permission
        (perm_code, perm_type, perm_name, perm_name_key, is_system, description, description_key, requires_step_up, created_by, updated_by, created_at, updated_at)
      values ($1, 'api', $2, $3, true, $6, $4, $7, $5, $5, now(), now())
      -- requires_step_up 是**平台持有的策略**，不是管理员自定义字段：重新 seed 必须
      -- 让它回到目录声明的值，否则改了 STEP_UP_REQUIRED 却对已有库无效（其余列保持
      -- do-nothing 语义，不覆盖运营改过的显示名/描述）。
      on conflict (perm_code) do update set
        requires_step_up = excluded.requires_step_up,
        updated_at = now()
    `,
      [
        code,
        name,
        `ops.perm.${code.replace(/:/g, ".")}`,
        `ops.perm.${code.replace(/:/g, ".")}.desc`,
        SYS,
        description ?? name,
        STEP_UP_REQUIRED.has(code),
      ],
    );
  }

  // ── operator_permission 的 menu 层 + 把 api 码挂到所属页面下 ─────────────
  //
  // 分两趟：先按 depth 升序插菜单行（父必须先于子存在，parent_id 是自引用外键），
  // 再一次性把操作码的 parent_id 更新到它所属的页面节点。
  //
  // `on conflict do update` 这里要更新 parent_id/route_path/sort：树形是**平台
  // 持有的结构**，跟 requires_step_up 同性质——改了 MENU_TREE 却对已有库无效的话，
  // 这段就白写了。perm_name 仍走 do-nothing 语义，不覆盖运营改过的显示名。
  for (const node of [...MENU_NODES].sort((a, b) => a.depth - b.depth)) {
    await client.query(
      `
      insert into admin.operator_permission
        (perm_code, perm_type, perm_name, perm_name_key, parent_id, route_path, icon,
         is_system, description, description_key, sort, created_by, updated_by, created_at, updated_at)
      values ($1, 'menu', $2, $3,
              (select id from admin.operator_permission where perm_code = $4),
              $5, $6, true, $2, $7, $8, $9, $9, now(), now())
      on conflict (perm_code) do update set
        parent_id  = excluded.parent_id,
        route_path = excluded.route_path,
        perm_type  = excluded.perm_type,
        sort       = excluded.sort,
        updated_at = now()
    `,
      [
        node.code,
        node.name,
        `ops.menu.${node.code.replace(/^admin\./, "")}`,
        node.parent,
        node.route,
        node.icon,
        `ops.menu.${node.code.replace(/^admin\./, "")}.desc`,
        node.sort,
        SYS,
      ],
    );
  }

  const menuIdRes = await client.query(
    `select id, perm_code from admin.operator_permission where perm_type = 'menu'`,
  );
  const menuIdMap = Object.fromEntries(
    menuIdRes.rows.map((r) => [r.perm_code, r.id]),
  );
  let reparented = 0;
  for (const [permCode, menuCode] of Object.entries(PERM_PARENT)) {
    const res = await client.query(
      `update admin.operator_permission set parent_id = $1, updated_at = now()
       where perm_code = $2 and perm_type = 'api'`,
      [menuIdMap[menuCode], permCode],
    );
    reparented += res.rowCount;
  }
  const orphans = OPERATOR_PERMISSIONS.map((p) => p[0]).filter(
    (code) => !PERM_PARENT[code],
  );
  console.log(
    `✓  admin — ${MENU_NODES.length} menu 节点 + ${reparented} 个操作码已挂到所属页面` +
      (orphans.length ? `（未归位：${orphans.join(", ")}）` : ""),
  );

  // ── operator_role_permission mapping (resolve role/perm ids by natural key) ──
  const opPermRes = await client.query(
    `select id, perm_code from admin.operator_permission`,
  );
  const opPermMap = Object.fromEntries(
    opPermRes.rows.map((r) => [r.perm_code, r.id]),
  );
  for (const [roleCode, roleId] of Object.entries(opsRoleMap)) {
    for (const code of OPERATOR_ROLE_PERMS[roleCode] ?? []) {
      const pid = opPermMap[code];
      if (!pid) continue;
      await client.query(
        `
        insert into admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
        values ($1, $2, true, $3, now()) on conflict (role_id, permission_id) do nothing
      `,
        [roleId, pid, SYS],
      );
    }
  }

  // ── super_admin explicit full-grant self-check (design data_admin_200 §4.4) ──
  // No hardcoded bypass in auth: super_admin must map to EVERY operator_permission or it
  // self-locks (capabilities=[] → 403). Fail the seed loudly if the invariant is violated.
  const saRoleId = opsRoleMap["super_admin"];
  const saGrantCnt = (
    await client.query(
      `select count(*)::int c from admin.operator_role_permission where role_id = $1`,
      [saRoleId],
    )
  ).rows[0].c;
  const permTotal = (
    await client.query(`select count(*)::int c from admin.operator_permission`)
  ).rows[0].c;
  if (saGrantCnt !== permTotal) {
    throw new Error(
      `super_admin full-grant invariant violated (data_admin_200 §4.4): mapped ${saGrantCnt}/${permTotal} permissions`,
    );
  }
  console.log(
    `✓  admin — ${OPERATOR_PERMISSIONS.length} operator_permission + role_permission mapping (super_admin full-grant ${saGrantCnt}/${permTotal})`,
  );

  // Platform default operator MFA policy (resolver floor). effective =
  // max(this, operator_role.mfa_min_level, operator_mfa.policy).
  await client.query(
    `
    insert into admin.settings (config_group, config_key, value_type, config_value, description, description_key, created_by, created_at, updated_at)
    values ('operator_security', 'operator.mfa.policy', 'string', 'optional',
            'Platform default operator MFA policy: disabled|optional|required.',
            'ops.setting.operator.mfa.policy.desc', $1, now(), now())
    on conflict (config_key) do nothing
  `,
    [SYS],
  );
  console.log("✓  admin — settings operator.mfa.policy=optional");

  // 退款策略（product_330 §5，owner 决策 3）：履约起 window_hours 内、首次购买、消耗性
  // 配额使用率 < max_usage_ratio 可申请全额退款。运营在治理台「平台参数」改值即生效。
  await client.query(
    `
    insert into admin.settings (config_group, config_key, value_type, config_value, description, description_key, created_by, created_at, updated_at)
    values
      ('commerce', 'refund.window_hours', 'int', '24',
       'Refund window in hours after fulfilment (first purchase of a product only).',
       'ops.setting.refund.window_hours.desc', $1, now(), now()),
      ('commerce', 'refund.max_usage_ratio', 'string', '0.10',
       'Max consumed share of consumable quota (0-1) for a refund to stay eligible.',
       'ops.setting.refund.max_usage_ratio.desc', $1, now(), now())
    on conflict (config_key) do nothing
  `,
    [SYS],
  );
  console.log(
    "✓  admin — settings refund.window_hours=24 / refund.max_usage_ratio=0.10",
  );

  // ── 2. access.permissions (governance catalog; unified fields, console-mode) ─
  // perm_name = human label; is_system=true, created_by=SYS. 操作码行 do-nothing
  // (不覆盖运营改过的显示名);parent_id / perm_type 在下面按菜单树统一回写。
  for (const [code, category, description] of PERMISSIONS) {
    await client.query(
      `
      insert into access.permissions (perm_code, perm_type, perm_name, perm_name_key, category, description, description_key, is_system, created_by, created_at, updated_at)
      values ($1, 'api', $2, $3, $4, $2, $5, true, $6, now(), now()) on conflict (perm_code) do nothing
    `,
      [
        code,
        description,
        `access.perm.${code}`,
        category,
        `access.perm.${code}.desc`,
        SYS,
      ],
    );
  }

  // ── access.permissions 的 menu 层 + 把操作码挂到所属页面下(与 admin 同一套做法)─
  // 先按 depth 升序插菜单行(parent_id 自引用,父必须先在),结构列 do-update:树形
  // 是平台持有的结构,改了 TENANT_MENU_TREE 必须对已有库生效;perm_name 保持
  // do-nothing 语义。再把操作码的 parent_id / perm_type 回写到所属页面。
  for (const node of [...TENANT_MENU_NODES].sort((a, b) => a.depth - b.depth)) {
    await client.query(
      `
      insert into access.permissions
        (perm_code, perm_type, perm_name, perm_name_key, parent_id, route_path, icon,
         is_system, description, description_key, sort, created_by, updated_by, created_at, updated_at)
      values ($1, 'menu', $2, $3,
              (select id from access.permissions where perm_code = $4),
              $5, $6, true, $2, $7, $8, $9, $9, now(), now())
      on conflict (perm_code) do update set
        parent_id  = excluded.parent_id,
        route_path = excluded.route_path,
        perm_type  = excluded.perm_type,
        icon       = excluded.icon,
        sort       = excluded.sort,
        updated_at = now()
    `,
      [
        node.code,
        node.name,
        `access.menu.${node.code.replace(/^tenant\.menu\./, "")}`,
        node.parent,
        node.route,
        node.icon,
        `access.menu.${node.code.replace(/^tenant\.menu\./, "")}.desc`,
        node.sort,
        SYS,
      ],
    );
  }
  let tenantReparented = 0;
  for (const [permCode, menuCode] of Object.entries(TENANT_PERM_PARENT)) {
    const res = await client.query(
      `update access.permissions
          set parent_id = (select id from access.permissions where perm_code = $1),
              perm_type = 'api',
              updated_at = now()
        where perm_code = $2`,
      [menuCode, permCode],
    );
    tenantReparented += res.rowCount;
  }
  // 树里没提到的操作码(workspace.* 暂无 console 页面)留在根上,但 perm_type 仍归 api。
  await client.query(
    `update access.permissions set perm_type = 'api', updated_at = now()
      where perm_type is null and perm_code not like 'tenant.menu.%'`,
  );
  const tenantOrphans = PERMISSIONS.map((p) => p[0]).filter(
    (code) => !TENANT_PERM_PARENT[code],
  );
  console.log(
    `✓  access — ${TENANT_MENU_NODES.length} menu 节点 + ${tenantReparented} 个操作码已挂到所属页面` +
      (tenantOrphans.length ? `(留在根上:${tenantOrphans.join(", ")})` : ""),
  );

  // ── 3. access.roles (two-level; scope tenant/workspace; is_system) ──────────
  for (const [scope, code, name, description] of ROLES) {
    const nameKey = `access.role.${scope}.${code}`;
    await client.query(
      `
      insert into access.roles
        (scope, role_code, role_name, role_name_key, description, description_key, is_system, created_by, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, true, $7, now(), now()) on conflict (scope, role_code) do nothing
    `,
      [scope, code, name, nameKey, description, `${nameKey}.desc`, SYS],
    );
  }

  // ── 4. access.role_permissions (mapping by uuid role_id/permission_id) ──────
  const permRes = await client.query(
    `select id, perm_code from access.permissions`,
  );
  const permMap = Object.fromEntries(
    permRes.rows.map((r) => [r.perm_code, r.id]),
  );
  const roleRows = await client.query(
    `select id, scope, role_code from access.roles`,
  );
  for (const r of roleRows.rows) {
    const codes = ROLE_PERMS[`${r.scope}:${r.role_code}`] ?? [];
    for (const code of codes) {
      const permId = permMap[code];
      if (!permId) continue;
      await client.query(
        `
        insert into access.role_permissions (role_id, permission_id, is_system, created_by)
        values ($1, $2, true, $3) on conflict (role_id, permission_id) do nothing
      `,
        [r.id, permId, SYS],
      );
    }
  }
  console.log(
    `✓  access — ${PERMISSIONS.length} permissions + ${ROLES.length} roles (owner/manager/member/readonly/guest ×2 scope) + role_permissions mapping`,
  );

  // ── 5. loyalty growth config: level_policies + level_thresholds (placeholder) ─
  // max_owned_org_tenant / min_points are placeholders pending business input;
  // thresholds must stay distinct (UNIQUE min_points) and monotonic.
  // level_name = platform-defined display catalog (placeholder set pending growth design);
  // i18n keys derived loyalty.level.{n} (+.desc).
  await client.query(`
    insert into loyalty.level_policies
      (level_no, max_owned_org_tenant, level_name, level_name_key, description, description_key) values
      (1, 1, 'Starter',  'loyalty.level.1', 'L1', 'loyalty.level.1.desc'),
      (2, 1, 'Bronze',   'loyalty.level.2', 'L2', 'loyalty.level.2.desc'),
      (3, 1, 'Silver',   'loyalty.level.3', 'L3', 'loyalty.level.3.desc'),
      (4, 1, 'Gold',     'loyalty.level.4', 'L4', 'loyalty.level.4.desc'),
      (5, 1, 'Platinum', 'loyalty.level.5', 'L5', 'loyalty.level.5.desc')
    on conflict (level_no) do nothing
  `);
  await client.query(`
    insert into loyalty.level_thresholds (level_no, min_points) values
      (1, 0), (2, 1), (3, 2), (4, 3), (5, 4)
    on conflict (level_no) do nothing
  `);
  console.log(
    "✓  loyalty — level_policies + level_thresholds (5 levels, placeholder)",
  );

  // ── 6. kyc.verification_policies baseline (platform rows, product_id NULL) ───
  // NOT EXISTS guard keeps this idempotent (also covered by the platform-baseline partial unique).
  for (const [ttype, rtype] of [
    ["personal", "individual"],
    ["organization", "enterprise"],
  ]) {
    await client.query(
      `
      insert into kyc.verification_policies (product_id, tenant_type, require_verification, required_type)
      select null, $1::varchar, true, $2::varchar
       where not exists (
         select 1 from kyc.verification_policies where product_id is null and tenant_type = $1::varchar)
    `,
      [ttype, rtype],
    );
  }
  console.log(
    "✓  kyc — verification_policies baseline (personal/organization)",
  );

  // ── 8. appoidc.signing_keys (RS256 JWKS public key; private key stays in secret mgr) ─
  // Only seed a key when a REAL public JWK is injected (SIGNING_KEY_PUBLIC_JWK).
  // Otherwise generate one with provision-signing-key.mjs. No fake placeholder — it
  // would pollute /oidc/jwks with an unusable key.
  const signJwkRaw = process.env.SIGNING_KEY_PUBLIC_JWK || null;
  if (signJwkRaw) {
    const signJwk = JSON.parse(signJwkRaw);
    const signKid = process.env.SIGNING_KEY_KID || signJwk.kid;
    await client.query(
      `
      insert into appoidc.signing_keys (kid, algorithm, public_jwk, status, activated_at, created_at)
      values ($1, 'RS256', $2, 'active', now(), now())
      on conflict (kid) do nothing
    `,
      [signKid, JSON.stringify(signJwk)],
    );
    console.log(
      `✓  appoidc.signing_keys — ${signKid} (status=active, from env)`,
    );
  } else {
    console.log(
      "•  appoidc.signing_keys — skipped (run provision-signing-key.mjs to generate a real RS256 key)",
    );
  }

  // ── 9. product: minimal valid catalog graph (placeholder) ───────────────────
  // New unified model: product_name(主)+product_nick(副) as two columns (no product_i18n table).
  await client.query(`
    insert into product.product_categories (id, parent_id, code, name, name_key, sort) values
      (1, null, 'agent', '智能体', 'product.category.agent', 10),
      (2, null, 'platform', '平台', 'product.category.platform', 20)
    on conflict (id) do nothing
  `);
  // M1 (product_300 §1): rename the placeholder product code data -> arda in
  // place (row UUID is the stable anchor, code is mutable; final name per
  // product_100 v1.0). Guarded so it no-ops once arda exists.
  await client.query(`
    update product.products
       set product_code = 'arda', product_nick = 'Arda',
           description_key = 'product.product.arda.desc', updated_at = now()
     where product_code = 'data'
       and not exists (select 1 from product.products where product_code = 'arda')
  `);
  // U-line (product_300 §2): rename the legacy product ruyin -> umbra in place
  // (UUID anchor kept, M1 pattern). The `product_type = 'agent'` guard pins the
  // legacy row — the NEW client-side ruyin inserted below is type=client, so a
  // re-run can never rename it.
  await client.query(`
    update product.products
       set product_code = 'umbra', product_type = 'general_platform',
           origin = 'third_party', origin_provider = 'ruyin.ai', category_id = null,
           product_name = 'umbra', product_nick = 'umbra',
           description = 'Boundary VPN product (ruyin.ai).',
           description_key = 'product.product.umbra.desc', updated_at = now()
     where product_code = 'ruyin' and product_type = 'agent'
       and not exists (select 1 from product.products where product_code = 'umbra')
  `);

  // runos identity correction (platform#205 follow-up + #216): the row was seeded
  // from the retired "multimodal assistant agent" framing — product_type='agent',
  // category=agent, an English product_name where every other platform product
  // carries the Chinese one, and no Chinese name at all. ADR-003 makes runos the
  // L1 commercial capability plane and the owner fixed its Chinese name as 鲁诺斯
  // (there is no earlier Chinese name to preserve — 露娜/露娜之语 were Luna-derived
  // and are purged, not renamed). Same guarded shape as the arda/umbra renames
  // above and it must run BEFORE the PRODUCTS loop, whose `on conflict do nothing`
  // would otherwise leave the stale row standing. The product_type='agent' guard
  // pins the old row, so a re-run after the fix is a no-op.
  await client.query(`
    update product.products
       set product_type = 'general_platform', category_id = 2,
           product_name = '鲁诺斯', product_nick = 'Runos',
           description = 'Commercial capability plane: the single gate for a business-scenario agent''s non-model capabilities.',
           updated_at = now()
     where product_code = 'runos' and product_type = 'agent'
  `);
  console.log(
    "✓  product.products — runos identity correction (guarded; no-op when done)",
  );

  // Which products a seed may create at all — 40-product-registry.md §5. A row
  // belongs here only when (A) platform code references the code literally
  // (token-exchange audience / opera module mount / app-scope claim), or (B) another
  // seeded row points at it by FK (plans, webhooks, metrics, OIDC client) — and a
  // product-level client below may exist only for a product that is in this list.
  // Everything else is registered by an operator in opera → 产品管理 → 产品目录.
  //   umbra  (A: app-scope claim; B: client/plan)       arda  (B: plans/webhook/metrics/client)
  //   runos  (A: opera /runos module, RUNOS_AUDIENCE)   karda (B: webhook/metrics/client)
  //   atlas  (A: opera /atlas module, ATLAS_AUDIENCE)   vxtpl (B: client/webhook; product_240 §7)
  // ruyin 不在此列(owner 2026-08-31)：它是平台级 first-party 桌面客户端(与 website/
  // console 同类，customer-realm 的 platform 级客户端)，不是目录产品——其 OIDC 客户端
  // 在下方以 kind:"platform" 声明，无需也不得建 product.products 行。存量库由迁移
  // 2026-08-31-ruyin-declassify.sql 把旧的 product 级客户端与产品行一并降级/软删。
  // `origin` is written explicitly (same shape the catalog page writes), not left to
  // the column default — a seeded row should be indistinguishable from a registered one.
  const PRODUCTS = [
    // desc = placeholder external copy; i18n key derived product.product.{code}.desc
    // ruyin 不在此(见上)——平台级桌面客户端，不建产品行。
    {
      // external 已回归为「来源」而非类型:umbra 是外部平台(供方 ruyin.ai)→
      // type=general_platform + origin=third_party + origin_provider(受管枚举 @vxture/core-utils)。
      code: "umbra",
      type: "general_platform",
      origin: "third_party",
      originProvider: "ruyin.ai",
      cat: null,
      name: "umbra",
      nick: "umbra",
      desc: "Boundary VPN product (ruyin.ai).",
    },
    {
      code: "runos",
      type: "general_platform",
      cat: 2,
      name: "鲁诺斯",
      nick: "Runos",
      desc: "Commercial capability plane: the single gate for a business-scenario agent's non-model capabilities.",
    },
    {
      code: "arda",
      type: "general_platform",
      cat: 2,
      name: "数据平台",
      nick: "Arda",
      desc: "Enterprise data platform.",
    },
    {
      code: "karda",
      type: "general_platform",
      cat: 2,
      name: "知识平台",
      nick: "Karda",
      desc: "Enterprise knowledge platform.",
    },
    {
      // vxtpl — 模板演示产品，owner 2026-08-13 裁定**完全产品化**（此前只有域名与
      // nginx，平台目录里完全不存在：PRODUCTS / B map / OIDC client 一样都没有，
      // 而 product_240 §7 批3 早就把"登记产品行/OIDC client/webhook secret"列为
      // 平台侧义务）。type='agent' + category=1（智能体）对齐 owner 的层归属裁定。
      // ⚠️ product_name 待 owner 确认：其余平台产品的中文主名均由 owner 亲自定
      // （runos 的 鲁诺斯 是先例），此处先按定位直译，不代表已拍板。
      code: "vxtpl",
      type: "general_agent",
      cat: 1,
      name: "模板智能体",
      nick: "Vxtpl",
      desc: "Repository template demo instance: a runnable reference product used to verify the three channels and plan tiers end to end.",
    },
    {
      // Atlas repo-split prep (see docs/30-design/platform/40-model-platform.md §13):
      // v1 DRAFT/unlocked/unpublished, same two-phase pattern as karda's A段 registration —
      // catalog row + OIDC client land now, plan tiers stay empty until Atlas's own repo
      // and product definition are ready. C2 resolves atlas as "unsubscribed" until published.
      code: "atlas",
      type: "general_platform",
      // category 2 = 平台（与 runos/arda/karda 同列）；此前误填 1（智能体）。
      // `on conflict do nothing` 意味着存量库不受影响，只有新库拿到正确分类。
      cat: 2,
      name: "模型平台",
      nick: "Atlas",
      desc: "Unified model access, routing, quota and metering platform.",
    },
  ];
  for (const p of PRODUCTS) {
    await client.query(
      `
      insert into product.products
        (id, product_code, product_type, category_id, product_name, product_nick, description, description_key, status, release_stage, origin, origin_provider, created_by, created_at, updated_at)
      values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'active', 'ga', $8, $9, $10, now(), now())
      on conflict (product_code) do nothing
    `,
      [
        p.code,
        p.type,
        p.cat,
        p.name,
        p.nick,
        p.desc,
        `product.product.${p.code}.desc`,
        p.origin ?? "self",
        p.originProvider ?? null,
        SYS,
      ],
    );
  }
  // release_version 初始化（product_330：订阅卡/推荐卡「最新版 vX.Y.Z」展示位。
  // 平台单实例恒最新——版本随产品更新由 admin 维护；seed 只在为空时给初值，
  // 重跑不覆盖 admin 后续改动）。
  const PRODUCT_VERSIONS = {
    arda: "1.4.0",
    runos: "1.2.0",
    karda: "0.9.0",
    vxtpl: "1.0.0",
    atlas: "0.1.0",
    umbra: "1.0.0",
  };
  for (const [code, ver] of Object.entries(PRODUCT_VERSIONS)) {
    await client.query(
      `update product.products
          set release_version = $2, released_at = now(), updated_at = now()
        where product_code = $1 and release_version is null`,
      [code, ver],
    );
  }
  console.log(
    "✓  product.products — release_version backfill (null-only; admin owns it afterwards)",
  );

  const prodRes = await client.query(
    `select id, product_code from product.products`,
  );
  const prodMap = Object.fromEntries(
    prodRes.rows.map((r) => [r.product_code, r.id]),
  );
  console.log(
    `✓  product — ${PRODUCTS.length} products + categories (placeholder)`,
  );

  // ── 7. appoidc.oidc_clients (platform portals + product credentials; secret hash via env) ─
  //
  // Runs AFTER block 9 (product.products) on purpose — 2026-08-30, product registry
  // single-entry model (docs/20-specs/000-platform/opera/40-product-registry.md §5):
  //   · every entry declares its ownership explicitly — `kind: "platform"` for the four
  //     platform portals (product_id stays NULL), or `product: "<product_code>"` for a
  //     product credential, resolved to product_id through prodMap at insert time;
  //   · a `product:` code that is not in PRODUCTS above throws before any row is written
  //     (the DB CHECK chk_oidc_clients_kind_product would reject it anyway — failing here
  //     names the entry instead of a constraint);
  //   · no client is seeded for a product that has no product row. The five planned
  //     products (ontos/raven/anlan/forge/xuanzhen) used to be seeded here as clients
  //     only; they are registered through the opera product catalog when their product
  //     definition exists, not pre-created by seed.
  //
  // Beta URL only registered when {APP}_BETA_BASE_URL env is set.
  function appUris(prod, betaEnv) {
    const uris = [`${prod}/auth/callback`];
    if (betaEnv) uris.push(`${betaEnv}/auth/callback`);
    return uris;
  }

  // Local fallbacks are the SAME numbers as the port registry (2026-08-10):
  // L0 faces 3000-3099 (docs/40-implementation/ai/10-port-allocation.md), L1
  // 31xx, L2 32xx, L3 40xx (docs/50-deployment/13-infra-allocation-registry.md
  // §3). They only apply when the env var is unset — production always sets it —
  // but a local seed writes them into oidc_clients.redirect_uris, so a wrong
  // fallback means a login that cannot come back. Layer-outside products get an
  // inert 39xx placeholder: no local service exists, and 39xx belongs to no block.
  const B = {
    website: process.env.WEBSITE_BASE_URL || "http://localhost:3000",
    console: process.env.CONSOLE_BASE_URL || "http://localhost:3020",
    admin: process.env.ADMIN_BASE_URL || "http://localhost:3030",
    // Capability Console (OSS-side operator shell, product_250 M-4). The prod
    // hostname is repo-external by policy (hardening: placeholder-only) and
    // arrives via OPERA_BASE_URL runtime env.
    opera: process.env.OPERA_BASE_URL || "http://localhost:3040",
    // Governance plane (operator shell, highest trust). Prod hostname is
    // repo-external by policy; arrives via ARCHE_BASE_URL runtime env.
    arche: process.env.ARCHE_BASE_URL || "http://localhost:3050",
    // ruyin = NEW client-side product surface (ruyin.vxture.com); the legacy
    // cross-domain RP at ruyin.ai is `umbra` (product_300 §2, U line).
    ruyin: process.env.RUYIN_BASE_URL || "http://localhost:3900",
    umbra: process.env.UMBRA_BASE_URL || "http://localhost:3901",
    atlas: process.env.ATLAS_BASE_URL || "http://localhost:3100",
    runos: process.env.RUNOS_BASE_URL || "http://localhost:3120",
    arda: process.env.ARDA_BASE_URL || "http://localhost:3230",
    karda: process.env.KARDA_BASE_URL || "http://localhost:3240",
    // vxtpl = 开发样本 / 测试智能体（原 vxture-template，名称已归一化）。owner
    // 2026-08-13 裁定它与 agent-template 是同一个业务、智能体级，归 L3 块首
    // 子块 4000-4009；它腾出的 L2 子块由 ontos 接手。
    vxtpl: process.env.VXTPL_BASE_URL || "http://localhost:4000",
  };
  const betaB = {
    ruyin: process.env.RUYIN_BETA_BASE_URL || null,
    runos: process.env.RUNOS_BETA_BASE_URL || null,
    atlas: process.env.ATLAS_BETA_BASE_URL || null,
    vxtpl: process.env.VXTPL_BETA_BASE_URL || null,
    arda: process.env.ARDA_BETA_BASE_URL || null,
    // deferred — no beta host assigned yet (TD-001 in vxture-karda)
    karda: process.env.KARDA_BETA_BASE_URL || null,
  };

  const accountsBase = process.env.ACCOUNTS_BASE_URL || "http://localhost:3080";
  const postLogout = `${accountsBase}/logout`;

  // U-line fail-fast (product_300 §2.4): RUYIN_BASE_URL changed meaning — it now
  // names the NEW ruyin surface (ruyin.vxture.com); ruyin.ai belongs to
  // UMBRA_BASE_URL. A stale ruyin.ai value here would register the new ruyin
  // client with umbra's callback — abort instead of seeding a misbinding.
  if (B.ruyin.includes("ruyin.ai")) {
    throw new Error(
      "RUYIN_BASE_URL points at ruyin.ai — that domain is umbra's (UMBRA_BASE_URL). " +
        "Migrate .env.auth-bff per product_300 §2.3 #4 before seeding.",
    );
  }

  const oidcClients = [
    {
      clientId: "website",
      kind: "platform",
      name: "Vxture Website",
      displayName: "Vxture Website",
      realm: "customer",
      redirectUris: [`${B.website}/auth/callback`],
      scopes: ["openid", "profile"],
      postLogoutUris: [`${B.website}/`, postLogout],
    },
    {
      clientId: "console",
      kind: "platform",
      name: "Vxture Console",
      displayName: "Vxture Console",
      realm: "customer",
      redirectUris: [`${B.console}/auth/callback`],
      scopes: ["openid", "profile", "console"],
    },
    {
      clientId: "admin",
      kind: "platform",
      name: "Vxture Admin",
      displayName: "Vxture Admin",
      realm: "workforce",
      redirectUris: [`${B.admin}/auth/callback`],
      scopes: ["openid", "profile", "admin"],
      // 登出回跳白名单。缺了它 end_session 仍会销毁会话，但**不回跳**——用户停在
      // 空页上，看起来像登出坏了。默认值只有 accounts/logout，回不到门户自己。
      postLogoutUris: [`${B.admin}/`, postLogout],
    },
    // Capability Console shell — second workforce RP (product_250 M-4). Same
    // operator claims surface as admin; its BFF additionally runs the
    // operator-OBO exchange (M-1) for mounted provider modules.
    {
      clientId: "opera",
      kind: "platform",
      name: "Vxture Capability Console",
      displayName: "Vxture Capability Console",
      realm: "workforce",
      redirectUris: [`${B.opera}/auth/callback`],
      scopes: ["openid", "profile", "admin"],
      postLogoutUris: [`${B.opera}/`, postLogout],
    },
    // arche — platform governance plane RP (workforce realm, operator surface).
    // Client secret is provisioned by scripts/27-provision-client-secrets.sh
    // (writes OIDC_CLIENT_SECRET to .env.arche-bff + the bcrypt hash to
    // .env.auth-bff as OIDC_CLIENT_SECRET_HASH_ARCHE).
    {
      clientId: "arche",
      kind: "platform",
      name: "Vxture Governance Console",
      displayName: "Vxture Governance Console",
      realm: "workforce",
      redirectUris: [`${B.arche}/auth/callback`],
      scopes: ["openid", "profile", "admin"],
      postLogoutUris: [`${B.arche}/`, postLogout],
    },
    // umbra — the cross-domain RP at ruyin.ai (ex-`ruyin`; renamed in place by the
    // U-line migration below, product_300 §2). No beta — single prod URI only.
    {
      clientId: "umbra",
      product: "umbra",
      name: "umbra",
      displayName: "umbra",
      realm: "customer",
      redirectUris: [`${B.umbra}/auth/callback`],
      scopes: [
        "openid",
        "profile",
        "email",
        "phone",
        "umbra",
        "umbra:subscription",
      ],
      postLogoutUris: [`${B.umbra}/`, postLogout],
    },
    // ruyin — 桌面原生应用（RFC 8252 public client）。零机密：token 端点凭 PKCE
    // 认证（authMethod='none'），回调是 loopback。原生应用端口由 OS 动态分配、不可
    // 预登记，故登记无端口规范值 http://127.0.0.1/oauth/callback，authorize 按
    // host+path 端口无关匹配（redirectUriAllowed）。No subscription scope：客户端
    // 产品不进权益引擎（product_100 §5）。
    // kind:"platform"(owner 2026-08-31)——ruyin 是平台级 first-party 桌面客户端，不是
    // 目录产品，与 website/console 同为 customer-realm 的 platform 级客户端。登录机制
    // (loopback+PKCE)不变；只是不再挂 product.products 行。
    {
      clientId: "ruyin",
      kind: "platform",
      name: "Ruyin",
      displayName: "如影 Ruyin",
      realm: "customer",
      authMethod: "none",
      redirectUris: ["http://127.0.0.1/oauth/callback"],
      postLogoutUris: [postLogout],
      scopes: ["openid", "profile", "email", "phone"],
    },
    // ruyin-beta — beta 渠道同源公共客户端（双客户端惯例，back-channel 单 URI 硬约束
    // 使一个 client 带不了两个渠道）。桌面 beta 构建用 RUYIN_OIDC_CLIENT_ID=ruyin-beta。
    {
      clientId: "ruyin-beta",
      kind: "platform",
      name: "Ruyin Beta",
      displayName: "如影 Ruyin（Beta）",
      realm: "customer",
      releaseChannel: "beta",
      authMethod: "none",
      redirectUris: ["http://127.0.0.1/oauth/callback"],
      postLogoutUris: [postLogout],
      scopes: ["openid", "profile", "email", "phone"],
    },
    {
      clientId: "runos",
      product: "runos",
      name: "Runos",
      displayName: "Runos",
      realm: "customer",
      redirectUris: appUris(B.runos, betaB.runos),
      scopes: ["openid", "profile", "email", "runos:subscription"],
    },
    {
      clientId: "atlas",
      product: "atlas",
      name: "Atlas",
      displayName: "Atlas",
      realm: "customer",
      redirectUris: appUris(B.atlas, betaB.atlas),
      // D12: product commercial scope retired, no {product}:subscription carried in
      // product tokens; aligned to karda's actual 4-scope registration (product_240 §6#20).
      scopes: ["openid", "profile", "email", "phone"],
    },
    // vxtpl — 模板演示产品（在产，vxtpl.vxture.com）。scope 取 D12 之后的四段式
    // （同 arda/karda/atlas）：token 不携带任何商业字段，权益一律走 C2。不给
    // `vxtpl:subscription`——那是 D12 之前的旧形态，新登记不再复制。
    {
      clientId: "vxtpl",
      product: "vxtpl",
      name: "Vxtpl",
      displayName: "Vxtpl",
      realm: "customer",
      redirectUris: appUris(B.vxtpl, betaB.vxtpl),
      scopes: ["openid", "profile", "email", "phone"],
      postLogoutUris: [`${B.vxtpl}/`, postLogout],
    },
    {
      clientId: "arda",
      product: "arda",
      name: "Arda",
      displayName: "Arda",
      realm: "customer",
      redirectUris: [`${B.arda}/auth/callback`],
      // D12 (arda reply-06 §3): the `arda:subscription` scope is retired —
      // tokens carry zero commercial fields; entitlements are C2-only.
      scopes: ["openid", "profile", "email", "phone"],
      postLogoutUris: [`${B.arda}/`, postLogout],
    },
    // arda-beta — only registered when ARDA_BETA_BASE_URL is set; release_channel=beta.
    ...(betaB.arda
      ? [
          {
            clientId: "arda-beta",
            product: "arda",
            name: "Arda Beta",
            displayName: "Arda (Beta)",
            realm: "customer",
            releaseChannel: "beta",
            redirectUris: [`${betaB.arda}/auth/callback`],
            // D12: `arda:subscription` retired (see the stable client above).
            scopes: ["openid", "profile", "email", "phone"],
            postLogoutUris: [`${betaB.arda}/`, postLogout],
          },
        ]
      : []),
    // karda — registration request A段 (docs/80-liaison/20-2607222338-karda-
    // platform-registration-a.md §3.2). No `karda:subscription` scope — D12
    // products are C2-only.
    {
      clientId: "karda",
      product: "karda",
      name: "Karda",
      displayName: "Karda",
      realm: "customer",
      redirectUris: [`${B.karda}/auth/callback`],
      scopes: ["openid", "profile", "email", "phone"],
      postLogoutUris: [`${B.karda}/`, postLogout],
    },
    // karda-beta — deferred (TD-001); only registers once KARDA_BETA_BASE_URL is set.
    ...(betaB.karda
      ? [
          {
            clientId: "karda-beta",
            product: "karda",
            name: "Karda Beta",
            displayName: "Karda (Beta)",
            realm: "customer",
            releaseChannel: "beta",
            redirectUris: [`${betaB.karda}/auth/callback`],
            scopes: ["openid", "profile", "email", "phone"],
            postLogoutUris: [`${betaB.karda}/`, postLogout],
          },
        ]
      : []),
  ];
  // U-line (product_300 §2): migrate the legacy cross-domain RP row ruyin → umbra
  // BEFORE the upsert loop, so the fresh `ruyin` entry above can never inherit the
  // legacy row (nor its secret hash). The legacy row is identified by its ruyin.ai
  // redirect; both statements no-op once migrated (and on a fresh database).
  // oidc_consents.client_id FK has no ON UPDATE CASCADE — drop legacy consents
  // first (users re-consent under umbra), then rename the parent in place so the
  // secret hash rides along with the row.
  await client.query(`
    delete from appoidc.oidc_consents oc
     using appoidc.oidc_clients c
     where oc.client_id = 'ruyin' and c.client_id = 'ruyin'
       and exists (select 1 from unnest(c.redirect_uris) u where u like 'https://ruyin.ai/%')
  `);
  await client.query(`
    update appoidc.oidc_clients
       set client_id = 'umbra', updated_at = now()
     where client_id = 'ruyin'
       and exists (select 1 from unnest(redirect_uris) u where u like 'https://ruyin.ai/%')
       and not exists (select 1 from appoidc.oidc_clients c2 where c2.client_id = 'umbra')
  `);
  console.log(
    "✓  appoidc.oidc_clients — U-line legacy ruyin → umbra (guarded; no-op when done)",
  );

  // Ownership is declared per entry and checked before any write: exactly one of
  // `kind: "platform"` / `product: "<code>"`, and the code must resolve through
  // prodMap (built from product.products right after block 9). The T1 backfill
  // that used to patch product_id afterwards by client_id suffix matching is gone —
  // product_id is written with the row, and `on conflict` re-asserts it on re-runs.
  for (const c of oidcClients) {
    const isPlatform = c.kind === "platform";
    if (isPlatform === Boolean(c.product)) {
      throw new Error(
        `seed-catalog: oidc client "${c.clientId}" must declare exactly one of kind:"platform" or product:"<code>"`,
      );
    }
    const productId = isPlatform ? null : prodMap[c.product];
    if (!isPlatform && !productId) {
      throw new Error(
        `seed-catalog: oidc client "${c.clientId}" declares product "${c.product}" which has no product.products row — add it to PRODUCTS (40-product-registry §5) or drop the client`,
      );
    }
    const envKey = c.clientId.toUpperCase().replace(/-/g, "_");
    const postLogoutUris = c.postLogoutUris || [postLogout];
    const releaseChannel = c.releaseChannel || "stable";
    // token 端点认证方式：public（none）= RFC 8252 原生应用，零机密。默认机密。
    const authMethod = c.authMethod === "none" ? "none" : "client_secret_basic";
    // 公共客户端没有 secret——这是协议属性，不是"没配"。env 里若还留着一份 hash
    // （U-line 之前 ruyin 曾是机密 web RP），这里不拿：拿了会撞
    // chk_oidc_clients_public_pkce，而且拿了也没有任何东西会用它。
    const envSecretHash =
      process.env[`OIDC_CLIENT_SECRET_HASH_${envKey}`] || null;
    if (authMethod === "none" && envSecretHash) {
      console.warn(
        `⚠  appoidc.oidc_clients — ${c.clientId} is a public client; ignoring OIDC_CLIENT_SECRET_HASH_${envKey} (public clients carry no secret)`,
      );
    }
    const secretHash = authMethod === "none" ? null : envSecretHash;
    // 公共客户端无服务端、无 back-channel（回调是 loopback，不是 /auth/callback）；
    // 机密 web RP 才由回调基址推出 back-channel 端点。
    const backChannelUri =
      authMethod === "none"
        ? null
        : `${c.redirectUris[0].replace("/auth/callback", "")}/auth/backchannel-logout`;
    await client.query(
      `
      insert into appoidc.oidc_clients
        (client_id, name, display_name, logo_url, realm, product_id, client_kind, release_channel,
         client_secret_hash, redirect_uris, post_logout_redirect_uris, back_channel_logout_uri,
         allowed_scopes, token_endpoint_auth_method, status, created_at, updated_at)
      values ($1, $2, $3, null, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active', now(), now())
      on conflict (client_id) do update set
        name = excluded.name,
        display_name = excluded.display_name,
        logo_url = excluded.logo_url,
        realm = excluded.realm,
        product_id = excluded.product_id,
        client_kind = excluded.client_kind,
        release_channel = excluded.release_channel,
        -- 机密客户端：seed 不带 hash 时保留库里那份（27-provision 写的真密钥不能被
        -- 重跑的 seed 抹掉）。公共客户端：hash 必须为 NULL、PKCE 必须强制——一行从
        -- 机密改成公共（2026-08-30 ruyin 由 web RP 转原生应用）时，旧 hash 若留着会撞
        -- chk_oidc_clients_public_pkce；生产 seed 曾因此整体回滚。判据写在 SQL 里而不是
        -- 靠调用方"记得传 null"，是让重跑在任何起点都能收敛到同一行。
        client_secret_hash = case
          when excluded.token_endpoint_auth_method = 'none' then null
          else coalesce(excluded.client_secret_hash, appoidc.oidc_clients.client_secret_hash)
        end,
        pkce_required = case
          when excluded.token_endpoint_auth_method = 'none' then true
          else appoidc.oidc_clients.pkce_required
        end,
        redirect_uris = excluded.redirect_uris,
        post_logout_redirect_uris = excluded.post_logout_redirect_uris,
        back_channel_logout_uri = excluded.back_channel_logout_uri,
        allowed_scopes = excluded.allowed_scopes,
        token_endpoint_auth_method = excluded.token_endpoint_auth_method,
        updated_at = now()
    `,
      [
        c.clientId,
        c.name,
        c.displayName,
        c.realm,
        productId,
        isPlatform ? "platform" : "product",
        releaseChannel,
        secretHash,
        c.redirectUris,
        postLogoutUris,
        backChannelUri,
        c.scopes,
        authMethod,
      ],
    );
    console.log(
      `✓  appoidc.oidc_clients — ${c.clientId} (${isPlatform ? "platform" : `product=${c.product}`}, realm=${c.realm}, auth=${authMethod}, secret=${secretHash ? "set" : "unset"})`,
    );
  }

  // product_webhooks — platform→product provisioning push config (product_310
  // P2.3). webhook_url follows the business-app contract path (rp-integration
  // §4: POST /provisioning/webhook); webhook_secret_ref is an env-var name on
  // the dispatcher host (admin-bff), resolved by the default secret resolver.
  // ARDA_WEBHOOK_BASE_URL (product_230 §3.1 / D11): tailnet delivery target,
  // decoupled from ARDA_BASE_URL because the latter also seeds the OIDC
  // redirect_uris (must stay public). Unset → falls back to the public base.
  const ardaWebhookBase = process.env.ARDA_WEBHOOK_BASE_URL || B.arda;
  await client.query(
    `
    insert into product.product_webhooks (product_id, home_url, webhook_url, webhook_secret_ref, created_at, updated_at)
    select id, $1, $2, $3, now(), now() from product.products where product_code = 'arda'
    on conflict (product_id) do update set
      home_url = excluded.home_url,
      webhook_url = excluded.webhook_url,
      webhook_secret_ref = excluded.webhook_secret_ref,
      updated_at = now()
  `,
    [
      B.arda,
      `${ardaWebhookBase}/provisioning/webhook`,
      "ARDA_PROVISION_WEBHOOK_SECRET",
    ],
  );
  console.log("✓  product — product_webhooks (arda provisioning endpoint)");

  // karda — registration request B段 (docs/80-liaison/40-2607230909-karda-
  // platform-registration-b.md §3.2): tailnet delivery target explicitly given
  // (http://vx-worker-02:3240, migrated from :3233 on 2026-07-24 port-plan
  // revision), not derived from B.karda (which stays public
  // for the OIDC redirect_uris). Only seeded once karda's product row exists.
  if (prodMap["karda"]) {
    const kardaWebhookBase = process.env.KARDA_WEBHOOK_BASE_URL || B.karda;
    await client.query(
      `
      insert into product.product_webhooks (product_id, home_url, webhook_url, webhook_secret_ref, created_at, updated_at)
      select id, $1, $2, $3, now(), now() from product.products where product_code = 'karda'
      on conflict (product_id) do update set
        home_url = excluded.home_url,
        webhook_url = excluded.webhook_url,
        webhook_secret_ref = excluded.webhook_secret_ref,
        updated_at = now()
    `,
      [
        B.karda,
        `${kardaWebhookBase}/provisioning/webhook`,
        "KARDA_PROVISION_WEBHOOK_SECRET",
      ],
    );
    console.log("✓  product — product_webhooks (karda provisioning endpoint)");

    // karda — metering registry keys (docs/80-liaison/120-2607261820-karda-
    // platform-registration-c.md §2): registered in product_metrics ahead of
    // plan quota_pools wiring — the key existing here is what unblocks
    // POST /usage/consume from rejecting karda's reports, independent of
    // whether the karda-* plans are published yet. karda.ingest is the only
    // one actually producing usage today; search/ask are declared ahead of
    // their own activation (recall / A4 wiring on karda's side).
    const KARDA_METRICS = [
      // [metric_key, merge_strategy, consume_mode, unit, reset_period]
      ["karda.ingest", "pool", "divisible", "docs", "month"],
      ["karda.search", "pool", "divisible", "calls", "month"],
      ["karda.ask", "pool", "divisible", "calls", "month"],
    ];
    for (const [key, strategy, mode, unit, reset] of KARDA_METRICS) {
      await client.query(
        `
        insert into product.product_metrics
          (id, product_id, metric_key, merge_strategy, consume_mode, metric_unit, reset_period, created_at)
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
        on conflict (product_id, metric_key) do update set
          merge_strategy = excluded.merge_strategy,
          consume_mode   = excluded.consume_mode,
          metric_unit    = excluded.metric_unit,
          reset_period   = excluded.reset_period
      `,
        [prodMap["karda"], key, strategy, mode, unit, reset],
      );
    }
    console.log(
      "✓  product — product_metrics (karda.ingest / karda.search / karda.ask)",
    );
  }

  // vxtpl — C3 provisioning endpoint (owner 2026-08-13 完全产品化)。与 karda 同形状:
  // VXTPL_WEBHOOK_BASE_URL 是 tailnet 投递目标，与 VXTPL_BASE_URL 解耦——后者还要喂
  // OIDC redirect_uris，必须保持公网可达。未设时回退公网 base。
  // ⚠️ webhook_secret_ref 指向的 VXTPL_PROVISION_WEBHOOK_SECRET 需 owner 生成并
  // 带外转运到 vxtpl 主机（同 karda 先例，见 40-2607230130 §2）——本 seed 只登记
  // 引用名，不生成密钥；密钥缺失时投递会在 dispatcher 侧失败，不是这里报错。
  {
    const vxtplWebhookBase = process.env.VXTPL_WEBHOOK_BASE_URL || B.vxtpl;
    await client.query(
      `
      insert into product.product_webhooks (product_id, home_url, webhook_url, webhook_secret_ref, created_at, updated_at)
      select id, $1, $2, $3, now(), now() from product.products where product_code = 'vxtpl'
      on conflict (product_id) do update set
        home_url = excluded.home_url,
        webhook_url = excluded.webhook_url,
        webhook_secret_ref = excluded.webhook_secret_ref,
        updated_at = now()
    `,
      [
        B.vxtpl,
        `${vxtplWebhookBase}/provisioning/webhook`,
        "VXTPL_PROVISION_WEBHOOK_SECRET",
      ],
    );
    console.log("✓  product — product_webhooks (vxtpl provisioning endpoint)");
  }

  // launch checklist catalog
  await client.query(`
    insert into product.launch_checklist_items
      (item_code, item_name, item_name_key, description, description_key, is_required, sort) values
      ('verification_policy', '认证策略已配置', 'product.checklist.verification_policy',
       'A verification policy is configured for the product.', 'product.checklist.verification_policy.desc', true, 10),
      ('pricing_set', '定价已配置', 'product.checklist.pricing_set',
       'Pricing is configured for the product.', 'product.checklist.pricing_set.desc', true, 20)
    on conflict (item_code) do nothing
  `);

  // product_200 §7 新产品接入 checklist（六步，technical onboarding；2026-08-12
  // 产品发布管理阶段三引入）——复用同一张字典表，不另开一套：一个产品"能不能
  // 上线"本来就是技术接入 + 商业配置合起来的一张单子，opera 只消费/勾选这六
  // 项，商业那两项（verification_policy/pricing_set）继续留给 admin。
  await client.query(`
    insert into product.launch_checklist_items
      (item_code, item_name, item_name_key, description, description_key, is_required, sort) values
      ('catalog_registered', '目录已登记', 'product.checklist.catalog_registered',
       'Product code/layer/type registered in product.products; checklist + plan structure scaffolded.', 'product.checklist.catalog_registered.desc', true, 30),
      ('c1_identity', 'C1 身份接入', 'product.checklist.c1_identity',
       'OIDC client registered; RP implementation (login/callback/session) completed.', 'product.checklist.c1_identity.desc', true, 40),
      ('c3_metering', 'C3 计量上报', 'product.checklist.c3_metering',
       'Webhook endpoint + provisioning consumption + local_usage buffer + consume job wired.', 'product.checklist.c3_metering.desc', true, 50),
      ('c2_entitlement', 'C2 权益接入', 'product.checklist.c2_entitlement',
       'Entitlement fetch/cache invalidation wired; gating renders correctly.', 'product.checklist.c2_entitlement.desc', true, 60),
      ('data_plane', '数据面就绪', 'product.checklist.data_plane',
       'Agent-db provisioned per product_240 §2.4 template (vx_provision/local_authz/local_usage schemas).', 'product.checklist.data_plane.desc', true, 70),
      ('acceptance', '端到端验收', 'product.checklist.acceptance',
       'Full e2e verified: login → provision → gate → consume → invalidate; launch checklist reviewed.', 'product.checklist.acceptance.desc', true, 80)
    on conflict (item_code) do nothing
  `);

  // Ensure plan_versions.status exists before the catalog seed touches it. The
  // clean-baseline ddl/ apply is create-once (won't ALTER an existing table), and
  // prisma migrations are retired — so this idempotent additive column keeps the
  // `seed` action self-sufficient on a LIVE DB too (fresh builds get it from
  // ddl/40_product.sql; here it's a no-op). Backfill: the version a plan points
  // at (current_version_id) is its live/published one. (product_320)
  await client.query(
    `alter table product.plan_versions add column if not exists status varchar(32) not null default 'draft'`,
  );
  await client.query(`
    update product.plan_versions pv set status = 'published'
      from product.plans p
     where p.current_version_id = pv.id and pv.status <> 'published'
  `);
  await client.query(`
    do $$ begin
      if not exists (select 1 from pg_constraint where conname = 'chk_plan_versions_status') then
        alter table product.plan_versions
          add constraint chk_plan_versions_status check (status in ('draft','published'));
      end if;
    end $$;
  `);

  // Live-DB increments for the two structural changes #186 (2026-08-07) declared in ddl/ but
  // that never reached a database built before it — exactly the create-once gap the
  // plan_versions.status block above exists for, missed on that PR. Confirmed absent on
  // worker-01 on 2026-08-10, which is why [B0] of the baseline audit had gone red: the audit
  // was right, and restamping the fingerprint would have buried a real finding.
  //
  // redemption_no is not merely latent — admin-bff's PROMOTION_REDEMPTIONS_SQL already selects
  // rd.redemption_no, so the redemption ledger errors on any live database missing the column.
  await client.query(
    `alter table promotion.voucher_redemptions add column if not exists redemption_no varchar(64)`,
  );
  // NOT NULL only once nothing violates it. Production has zero rows, so this promotes on the
  // first run; a database with legacy rows keeps the column nullable rather than failing the
  // whole seed, and promotes itself once those rows are given codes.
  await client.query(`
    do $$ begin
      if not exists (select 1 from promotion.voucher_redemptions where redemption_no is null) then
        alter table promotion.voucher_redemptions alter column redemption_no set not null;
      end if;
    end $$;
  `);
  await client.query(`
    do $$ begin
      if not exists (select 1 from pg_constraint where conname = 'uq_voucher_redemptions_redemption_no') then
        alter table promotion.voucher_redemptions
          add constraint uq_voucher_redemptions_redemption_no unique (redemption_no);
      end if;
    end $$;
  `);
  // 'expiring' joined chk_subscriptions_status in ddl/50_metering.sql on the same PR. No code
  // writes it yet, so this is latent rather than broken — but a constraint that silently
  // rejects a value the DDL says is legal is the kind of drift that surfaces at the worst time.
  await client.query(`
    do $$ begin
      if exists (
        select 1 from pg_constraint
         where conname = 'chk_subscriptions_status'
           and pg_get_constraintdef(oid) not like '%expiring%'
      ) then
        alter table metering.subscriptions drop constraint chk_subscriptions_status;
        alter table metering.subscriptions add constraint chk_subscriptions_status
          check (status in ('active','expiring','trialing','overdue','suspended','expired','cancelled'));
      end if;
    end $$;
  `);

  // product_321 PR2 — live-DB self-sufficiency (ddl/ apply is create-once):
  // ① pay_source CHECK gains 'voucher' (the settlement leg, P7). Drop+add is
  //    safe: the constraint only widens, existing rows all satisfy it.
  await client.query(`
    do $$ begin
      alter table billing.payments drop constraint if exists chk_payments_pay_source;
      alter table billing.payments
        add constraint chk_payments_pay_source
        check (pay_source in ('online','offline','voucher'));
    end $$;
  `);
  // ② TD-020 service-role schema whitelists (97_service_roles is apply-once;
  //    live roles need the same widening — no-op when the roles don't exist
  //    yet). console-bff +promotion+provisioning, platform-api +billing
  //    +promotion, admin-bff +provisioning (320-era gap, product_321 §3).
  await client.query(`
    do $$
    declare
      spec record;
    begin
      for spec in
        select * from (values
          ('svc_console_bff',  array['promotion','provisioning']),
          ('svc_platform_api', array['billing','promotion']),
          ('svc_admin_bff',    array['provisioning'])
        ) as t(role_name, schemas)
      loop
        if exists (select from pg_roles where rolname = spec.role_name) then
          execute format('grant usage on schema %s to %I',
            array_to_string(spec.schemas, ', '), spec.role_name);
          execute format('grant select, insert, update, delete on all tables in schema %s to %I',
            array_to_string(spec.schemas, ', '), spec.role_name);
          execute format('grant usage, select on all sequences in schema %s to %I',
            array_to_string(spec.schemas, ', '), spec.role_name);
          execute format('alter default privileges in schema %s grant select, insert, update, delete on tables to %I',
            array_to_string(spec.schemas, ', '), spec.role_name);
          execute format('alter default privileges in schema %s grant usage, select on sequences to %I',
            array_to_string(spec.schemas, ', '), spec.role_name);
        end if;
      end loop;
    end $$;
  `);
  console.log(
    "✓  product_321 — payments.pay_source +'voucher', svc role whitelists widened",
  );

  // one representative free plan → draft version → bundled_free component + month price.
  // Version stays unlocked (is_locked=false) — no subscription references it yet; the
  // plan_component / plan_price lock guard (§7 triggers) only bites once is_locked=true.
  // Idempotent: only build a NEWLY created version (RETURNING id empty on conflict re-seed).
  // Tier vocabulary migration (owner 2026-07-07): the commercial ladder is
  // free/starter/pro/business/enterprise; 'standard' is renamed -- existing
  // free-entry components become 'free' ('bundled' is reserved for backing
  // components inside future agent plans). Guarded + skips locked versions.
  await client.query(`
    update product.plan_components pc
       set tier = 'free'
      from product.plan_versions pv
     where pv.id = pc.plan_version_id and pv.is_locked = false
       and pc.tier = 'standard'
  `);

  // U-line (product_300 §2): rename plan ruyin-free -> umbra-free in place
  // (subscription references are id-based; guarded like the product rename).
  await client.query(`
    update product.plans
       set plan_code = 'umbra-free', plan_name = 'Umbra Free',
           plan_name_key = 'product.plan.umbra-free',
           description = 'Free tier for umbra.',
           description_key = 'product.plan.umbra-free.desc', updated_at = now()
     where plan_code = 'ruyin-free'
       and not exists (select 1 from product.plans where plan_code = 'umbra-free')
  `);
  await client.query(
    `
    insert into product.plans
      (id, plan_code, plan_name, plan_name_key, description, description_key, is_public, status, created_by, created_at, updated_at)
    values (gen_random_uuid(), 'umbra-free', 'Umbra Free', 'product.plan.umbra-free',
            'Free tier for umbra.', 'product.plan.umbra-free.desc', true, 'active', $1, now(), now())
    on conflict (plan_code) do nothing
  `,
    [SYS],
  );
  const planRes = await client.query(
    `select id from product.plans where plan_code = 'umbra-free' limit 1`,
  );
  const planId = planRes.rows[0]?.id;
  const umbraId = prodMap["umbra"];
  if (planId && umbraId) {
    const pvIns = await client.query(
      `
      insert into product.plan_versions (id, plan_id, version_no, status, is_locked, created_by, created_at)
      values (gen_random_uuid(), $1, 1, 'published', false, $2, now())
      on conflict (plan_id, version_no) do nothing
      returning id
    `,
      [planId, SYS],
    );
    if (pvIns.rows.length > 0) {
      const pvId = pvIns.rows[0].id;
      await client.query(
        `
        insert into product.plan_components
          (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
        values (gen_random_uuid(), $1, $2, 'free', 'primary', 100, '{}', '{}'::jsonb, 0, now())
      `,
        [pvId, umbraId],
      );
      await client.query(
        `
        insert into product.plan_prices (id, plan_version_id, cycle_unit, cycle_count, price, currency, created_at)
        values (gen_random_uuid(), $1, 'month', 1, 0, 'CNY', now())
        on conflict (plan_version_id, cycle_unit, cycle_count, currency) do nothing
      `,
        [pvId],
      );
      await client.query(
        `update product.plans set current_version_id = $2 where id = $1 and current_version_id is null`,
        [planId, pvId],
      );
    }
  }

  // ── L0 platform resource catalog (D7, product_220 §4.1) ──────────────────
  // Single definition point for cross-product shared metrics; product plan
  // components only CONTRIBUTE amounts (quota jsonb keys). reserved rows are
  // key-name placeholders (no pools until a metering entrant exists).
  const PLATFORM_METRICS = [
    // [metric_key, kind, consume_mode, unit, reset_period, status]
    ["storage.bytes", "gauge", null, "bytes", "none", "active"],
    ["ai.credit", "counter", "atomic", "credits", "month", "active"],
    ["compute.gpu", null, null, null, "none", "reserved"],
    ["compute.cpu", null, null, null, "none", "reserved"],
    ["egress.bytes", null, null, null, "none", "reserved"],
    ["ingress.bytes", null, null, null, "none", "reserved"],
  ];
  for (const [key, kind, mode, unit, reset, status] of PLATFORM_METRICS) {
    await client.query(
      `
      insert into product.platform_metrics (metric_key, kind, consume_mode, metric_unit, reset_period, status, created_at)
      values ($1, $2, $3, $4, $5, $6, now())
      on conflict (metric_key) do update set
        kind = excluded.kind, consume_mode = excluded.consume_mode,
        metric_unit = excluded.metric_unit, reset_period = excluded.reset_period,
        status = excluded.status
    `,
      [key, kind, mode, unit, reset, status],
    );
  }
  console.log(
    "✓  product — platform_metrics (L0 resource catalog: 2 active + 4 reserved)",
  );

  // ── addon packs (加油包/扩展包目录,owner 2026-08-20 用量配额线) ──────────
  // 初步预置定价(参考市场,owner 授权;运营侧接管后在 admin 调整——upsert 仅
  // 回写目录字段,已售单持快照不受影响)。有效期一律 365 天;存储包为 WS 级
  // gauge 额度叠加,credits 包为 counter 池(priority 200,订阅池后烧)。
  const MIB = 1024 * 1024;
  const ADDON_PACKS = [
    // [pack_code, pack_name, metric_key, amount, validity_days, price, sort]
    [
      "addon-storage-500m",
      "存储扩展包 500MB",
      "storage.bytes",
      500 * MIB,
      365,
      "9.90",
      10,
    ],
    [
      "addon-storage-1g",
      "存储扩展包 1GB",
      "storage.bytes",
      1024 * MIB,
      365,
      "16.90",
      20,
    ],
    [
      "addon-storage-5g",
      "存储扩展包 5GB",
      "storage.bytes",
      5 * 1024 * MIB,
      365,
      "69.00",
      30,
    ],
    [
      "addon-credits-100",
      "AI 加油包 100 Credits",
      "ai.credit",
      100,
      365,
      "19.90",
      40,
    ],
    [
      "addon-credits-500",
      "AI 加油包 500 Credits",
      "ai.credit",
      500,
      365,
      "89.00",
      50,
    ],
    [
      "addon-credits-2000",
      "AI 加油包 2000 Credits",
      "ai.credit",
      2000,
      365,
      "299.00",
      60,
    ],
  ];
  for (const [
    code,
    name,
    metric,
    amount,
    validity,
    price,
    sort,
  ] of ADDON_PACKS) {
    await client.query(
      `
      insert into product.addon_packs (pack_code, pack_name, metric_key, amount, validity_days, price, currency, status, sort, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, 'CNY', 'active', $7, now(), now())
      on conflict (pack_code) do update set
        pack_name = excluded.pack_name, metric_key = excluded.metric_key,
        amount = excluded.amount, validity_days = excluded.validity_days,
        price = excluded.price, sort = excluded.sort, updated_at = now()
    `,
      [code, name, metric, amount, validity, price, sort],
    );
  }
  console.log("✓  product — addon_packs (3 storage + 3 credits, ¥ preset)");

  // ── arda catalog (arda-biz-260 §3 + reply-01 §6; product_310 P2.5 precondition) ──
  // Five commercial tiers + the beta public-test plan (definition.md §5.1).
  // product_metrics: 5 max-caps + 3 tiered caps (non-numeric, best-plan-wins)
  // + 4 pools (counters monthly per R5; storage.bytes = interim pool until the
  // D5 gauge lands -- arda does not report it, display-only).
  // v1 prices are 0 placeholders (superseded by the pricing-v2 block below,
  // product_320 §1.2; price never feeds C2/C3).
  // Versions are LOCKED once filled (C2 only resolves locked versions); content
  // changes after lock require a new version -- rerun is a no-op on locked v1.
  const ardaId2 = prodMap["arda"];
  if (ardaId2) {
    const ARDA_METRICS = [
      // [metric_key, merge_strategy, consume_mode, unit, reset_period]
      ["member.max", "max", null, "seats", "none"],
      ["dataset.max", "max", null, "count", "none"],
      ["datasource.max", "max", null, "count", "none"],
      ["service_endpoint.max", "max", null, "count", "none"],
      ["retention.days", "max", null, "days", "none"],
      ["varda.enabled", "tiered", null, "flag", "none"],
      ["varda.readonly", "tiered", null, "flag", "none"],
      ["sync.frequency", "tiered", null, "level", "none"],
      ["service.api.call", "pool", "divisible", "calls", "month"],
      ["quality.check.run", "pool", "divisible", "runs", "month"],
      // storage.bytes + ai.credit are L0 platform metrics (D7) — contributed
      // via plan quota keys below, never declared here (95 shadow guard).
    ];
    for (const [key, strategy, mode, unit, reset] of ARDA_METRICS) {
      await client.query(
        `
        insert into product.product_metrics
          (id, product_id, metric_key, merge_strategy, consume_mode, metric_unit, reset_period, created_at)
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
        on conflict (product_id, metric_key) do update set
          merge_strategy = excluded.merge_strategy,
          consume_mode   = excluded.consume_mode,
          metric_unit    = excluded.metric_unit,
          reset_period   = excluded.reset_period
      `,
        [ardaId2, key, strategy, mode, unit, reset],
      );
    }

    const GIB = 1024 * 1024 * 1024;
    // [plan_code, plan_name, tier, is_public, features, quota]
    const ARDA_PLANS = [
      [
        "arda-free",
        "Arda Free",
        "free",
        true,
        ["governance.quality"],
        {
          "member.max": 1,
          "dataset.max": 50,
          "datasource.max": 2,
          "service_endpoint.max": 0,
          "retention.days": 30,
          "varda.enabled": false,
          "varda.readonly": true,
          "sync.frequency": "manual",
          "storage.bytes": 1 * GIB,
          "service.api.call": 1000,
          "quality.check.run": 100,
          "ai.credit": 0,
        },
      ],
      [
        "arda-starter",
        "Arda Starter",
        "starter",
        true,
        ["governance.quality", "governance.standards", "governance.lineage"],
        {
          "member.max": 1,
          "dataset.max": 500,
          "datasource.max": 5,
          "service_endpoint.max": 1,
          "retention.days": 90,
          "varda.enabled": true,
          "varda.readonly": true,
          "sync.frequency": "daily",
          "storage.bytes": 10 * GIB,
          "service.api.call": 20000,
          "quality.check.run": 1000,
          "ai.credit": 50,
        },
      ],
      [
        "arda-pro",
        "Arda Pro",
        "pro",
        true,
        [
          "governance.quality",
          "governance.standards",
          "governance.lineage",
          "governance.security",
          "governance.policies",
        ],
        {
          "member.max": 1,
          "dataset.max": 5000,
          "datasource.max": 20,
          "service_endpoint.max": 10,
          "retention.days": 365,
          "varda.enabled": true,
          "varda.readonly": true,
          "sync.frequency": "hourly",
          "storage.bytes": 100 * GIB,
          "service.api.call": 200000,
          "quality.check.run": 10000,
          "ai.credit": 500,
        },
      ],
      // business seats preset = 5 (owner 2026-08-20: seats are fixed by the plan
      // release — aligned with the published pricing page; member.max / varda.credit
      // scale with purchased seats at ops time).
      [
        "arda-business",
        "Arda Business",
        "business",
        true,
        [
          "governance.quality",
          "governance.standards",
          "governance.lineage",
          "governance.security",
          "governance.policies",
          "governance.mdm",
        ],
        {
          "member.max": 5,
          "dataset.max": -1,
          "datasource.max": 100,
          "service_endpoint.max": -1,
          "retention.days": -1,
          "varda.enabled": true,
          "varda.readonly": false,
          "sync.frequency": "realtime",
          "storage.bytes": 1024 * GIB,
          "service.api.call": 2000000,
          "quality.check.run": 100000,
          "ai.credit": 50000,
        },
      ],
      // enterprise = negotiated; caps use the -1 unlimited sentinel, pools are
      // generous presets (real values set per contract at ops time).
      [
        "arda-enterprise",
        "Arda Enterprise",
        "enterprise",
        true,
        [
          "governance.quality",
          "governance.standards",
          "governance.lineage",
          "governance.security",
          "governance.policies",
          "governance.mdm",
          "governance.custom",
        ],
        {
          "member.max": -1,
          "dataset.max": -1,
          "datasource.max": -1,
          "service_endpoint.max": -1,
          "retention.days": -1,
          "varda.enabled": true,
          "varda.readonly": false,
          "sync.frequency": "realtime",
          "storage.bytes": 10240 * GIB,
          "service.api.call": 20000000,
          "quality.check.run": 1000000,
          "ai.credit": 500000,
        },
      ],
      // beta public-test plan (definition.md §5.1): pro-shaped capabilities with
      // tiny pools; not publicly purchasable (operator_grant trial carrier).
      [
        "arda-beta-trial",
        "Arda Beta Trial",
        "pro",
        false,
        [
          "governance.quality",
          "governance.standards",
          "governance.lineage",
          "governance.security",
          "governance.policies",
        ],
        {
          "member.max": 1,
          "dataset.max": 5000,
          "datasource.max": 20,
          "service_endpoint.max": 10,
          "retention.days": 365,
          "varda.enabled": true,
          "varda.readonly": true,
          "sync.frequency": "hourly",
          "storage.bytes": 1 * GIB,
          "service.api.call": 1000,
          "quality.check.run": 100,
          "ai.credit": 100,
        },
      ],
    ];
    for (const [code, name, tier, isPublic, features, quota] of ARDA_PLANS) {
      await client.query(
        `
        insert into product.plans
          (id, plan_code, plan_name, plan_name_key, description, description_key, is_public, status, created_by, created_at, updated_at)
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'active', $7, now(), now())
        on conflict (plan_code) do nothing
      `,
        [
          code,
          name,
          "product.plan." + code,
          name + " tier for Arda.",
          "product.plan." + code + ".desc",
          isPublic,
          SYS,
        ],
      );
      const planRow = await client.query(
        `select id from product.plans where plan_code = $1 limit 1`,
        [code],
      );
      const pId = planRow.rows[0]?.id;
      if (!pId) continue;
      await client.query(
        `
        insert into product.plan_versions (id, plan_id, version_no, status, is_locked, created_by, created_at)
        values (gen_random_uuid(), $1, 1, 'published', false, $2, now())
        on conflict (plan_id, version_no) do nothing
      `,
        [pId, SYS],
      );
      const pvRow = await client.query(
        `select id, is_locked from product.plan_versions where plan_id = $1 and version_no = 1`,
        [pId],
      );
      const pv = pvRow.rows[0];
      if (!pv) continue;
      if (!pv.is_locked) {
        // unlocked v1: (re)write the component deterministically, then lock.
        await client.query(
          `delete from product.plan_components where plan_version_id = $1`,
          [pv.id],
        );
        await client.query(
          `
          insert into product.plan_components
            (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
          values (gen_random_uuid(), $1, $2, $3, 'primary', 100, $4, $5::jsonb, 0, now())
          on conflict (plan_version_id, product_id, tier) do update set
            component_role = excluded.component_role, priority = excluded.priority,
            features = excluded.features, quota = excluded.quota
        `,
          [pv.id, ardaId2, tier, features, JSON.stringify(quota)],
        );
        await client.query(
          `
          insert into product.plan_prices (id, plan_version_id, cycle_unit, cycle_count, price, currency, created_at)
          values (gen_random_uuid(), $1, 'month', 1, 0, 'CNY', now())
          on conflict (plan_version_id, cycle_unit, cycle_count, currency) do nothing
        `,
          [pv.id],
        );
        await client.query(
          `update product.plan_versions set is_locked = true where id = $1`,
          [pv.id],
        );
      }
      await client.query(
        `update product.plans set current_version_id = $2 where id = $1 and current_version_id is null`,
        [pId, pv.id],
      );
    }

    // ── arda pricing v2 (product_320) — PLACEHOLDER draft ───────────────────
    // Owner directive (2026-07-15): seed v2 as an UNPUBLISHED, UNLOCKED draft
    // with every quota param and every price = 1; the real prices/quotas are
    // set and the version is PUBLISHED from the admin backend. Per paid plan:
    // copy v1's component shape but force every quota value to 1, add month &
    // year price rows = 1, keep v2 UNLOCKED (locking would make §7 triggers
    // reject admin edits) and do NOT repoint current_version_id (admin
    // publishes). enterprise keeps NO price rows (contact-sales). Non-
    // clobbering: only a NEWLY inserted v2 is written, so a re-run never
    // overwrites values the admin has already edited/published.
    const ARDA_V2_PLANS = [
      "arda-starter",
      "arda-pro",
      "arda-business",
      "arda-enterprise",
    ];
    const ARDA_V2_PRICED = new Set([
      "arda-starter",
      "arda-pro",
      "arda-business",
    ]);
    for (const code of ARDA_V2_PLANS) {
      const planRow = await client.query(
        `select id from product.plans where plan_code = $1 limit 1`,
        [code],
      );
      const pId = planRow.rows[0]?.id;
      if (!pId) continue;
      const v1Row = await client.query(
        `select id from product.plan_versions where plan_id = $1 and version_no = 1`,
        [pId],
      );
      const v1Id = v1Row.rows[0]?.id;
      if (!v1Id) continue;
      const v2Ins = await client.query(
        `
        insert into product.plan_versions (id, plan_id, version_no, is_locked, created_by, created_at)
        values (gen_random_uuid(), $1, 2, false, $2, now())
        on conflict (plan_id, version_no) do nothing
        returning id
      `,
        [pId, SYS],
      );
      // only a freshly inserted draft — never clobber an existing v2 that the
      // admin may already have edited or published.
      if (v2Ins.rows.length === 0) continue;
      const v2Id = v2Ins.rows[0].id;
      // copy v1's component shape, but force every quota value to 1.
      await client.query(
        `
        insert into product.plan_components
          (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
        select gen_random_uuid(), $2, product_id, tier, component_role, priority, features,
               coalesce((select jsonb_object_agg(key, 1) from jsonb_each(quota)), '{}'::jsonb),
               sort_order, now()
        from product.plan_components
        where plan_version_id = $1
      `,
        [v1Id, v2Id],
      );
      // placeholder month & year price = 1 (self-serve plans only; enterprise
      // stays price-less = contact-sales).
      if (ARDA_V2_PRICED.has(code)) {
        for (const cycleUnit of ["month", "year"]) {
          await client.query(
            `
            insert into product.plan_prices (id, plan_version_id, cycle_unit, cycle_count, price, currency, created_at)
            values (gen_random_uuid(), $1, $2, 1, 1, 'CNY', now())
            on conflict (plan_version_id, cycle_unit, cycle_count, currency) do nothing
          `,
            [v2Id, cycleUnit],
          );
        }
      }
      // v2 stays UNLOCKED and current_version_id is NOT repointed — the admin
      // backend sets the real values and publishes the version.
    }
  }

  // ── karda catalog — SKELETON ONLY (registration request A段 §3.1,
  // docs/80-liaison/20-2607222338-karda-platform-registration-a.md) ──────────
  // karda's own product-definition doc (docs/20-specs/10-product-definition.md
  // in vxture-karda) is still in draft; there is no metrics/entitlement mapping
  // to seed yet. This only creates the 5 tier plan rows + a DRAFT, UNLOCKED,
  // UNPUBLISHED v1 (empty features/quota, no price) so the admin backend has
  // something to open and fill in once karda supplies the real mapping.
  // plans.current_version_id is intentionally left unset — C2 resolves nothing
  // for karda until a real version is published.
  const kardaId = prodMap["karda"];
  if (kardaId) {
    // [plan_code, plan_name, tier, is_public]
    const KARDA_PLANS = [
      ["karda-free", "Karda Free", "free", true],
      ["karda-starter", "Karda Starter", "starter", true],
      ["karda-pro", "Karda Pro", "pro", true],
      ["karda-business", "Karda Business", "business", true],
      ["karda-enterprise", "Karda Enterprise", "enterprise", true],
    ];
    for (const [code, name, tier, isPublic] of KARDA_PLANS) {
      await client.query(
        `
        insert into product.plans
          (id, plan_code, plan_name, plan_name_key, description, description_key, is_public, status, created_by, created_at, updated_at)
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'active', $7, now(), now())
        on conflict (plan_code) do nothing
      `,
        [
          code,
          name,
          "product.plan." + code,
          name + " tier for Karda.",
          "product.plan." + code + ".desc",
          isPublic,
          SYS,
        ],
      );
      const planRow = await client.query(
        `select id from product.plans where plan_code = $1 limit 1`,
        [code],
      );
      const pId = planRow.rows[0]?.id;
      if (!pId) continue;
      // draft v1: unlocked, unpublished, empty component — never overwritten
      // once inserted (admin owns everything past this point).
      const v1Ins = await client.query(
        `
        insert into product.plan_versions (id, plan_id, version_no, status, is_locked, created_by, created_at)
        values (gen_random_uuid(), $1, 1, 'draft', false, $2, now())
        on conflict (plan_id, version_no) do nothing
        returning id
      `,
        [pId, SYS],
      );
      if (v1Ins.rows.length === 0) continue;
      const v1Id = v1Ins.rows[0].id;
      await client.query(
        `
        insert into product.plan_components
          (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
        values (gen_random_uuid(), $1, $2, $3, 'primary', 100, ARRAY[]::text[], '{}'::jsonb, 0, now())
        on conflict (plan_version_id, product_id, tier) do nothing
      `,
        [v1Id, kardaId, tier],
      );
    }
    console.log(
      "✓  product — karda catalog skeleton (5 plans; v1 DRAFT/unlocked/unpublished, empty features+quota — admin fills in once karda's product definition lands)",
    );
  }

  // ── atlas catalog — SKELETON ONLY (Atlas repo-split prep, same A段 pattern as
  // karda above: docs/30-design/platform/40-model-platform.md §13 / product_240 §5) ──
  // Atlas's own product definition (plan tiers, quota semantics for the four
  // call types embedding/parse/rerank/generation) is not decided yet — this only
  // creates the 5 tier plan rows + a DRAFT, UNLOCKED, UNPUBLISHED v1 (empty
  // features/quota, no price) so the admin backend has something to open once
  // the Atlas repo lands its own product definition. plans.current_version_id
  // is intentionally left unset — C2 resolves nothing for atlas until a real
  // version is published.
  const atlasId = prodMap["atlas"];
  if (atlasId) {
    // [plan_code, plan_name, tier, is_public]
    const ATLAS_PLANS = [
      ["atlas-free", "Atlas Free", "free", true],
      ["atlas-starter", "Atlas Starter", "starter", true],
      ["atlas-pro", "Atlas Pro", "pro", true],
      ["atlas-business", "Atlas Business", "business", true],
      ["atlas-enterprise", "Atlas Enterprise", "enterprise", true],
    ];
    for (const [code, name, tier, isPublic] of ATLAS_PLANS) {
      await client.query(
        `
        insert into product.plans
          (id, plan_code, plan_name, plan_name_key, description, description_key, is_public, status, created_by, created_at, updated_at)
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'active', $7, now(), now())
        on conflict (plan_code) do nothing
      `,
        [
          code,
          name,
          "product.plan." + code,
          name + " tier for Atlas.",
          "product.plan." + code + ".desc",
          isPublic,
          SYS,
        ],
      );
      const planRow = await client.query(
        `select id from product.plans where plan_code = $1 limit 1`,
        [code],
      );
      const pId = planRow.rows[0]?.id;
      if (!pId) continue;
      // draft v1: unlocked, unpublished, empty component — never overwritten
      // once inserted (admin owns everything past this point).
      const v1Ins = await client.query(
        `
        insert into product.plan_versions (id, plan_id, version_no, status, is_locked, created_by, created_at)
        values (gen_random_uuid(), $1, 1, 'draft', false, $2, now())
        on conflict (plan_id, version_no) do nothing
        returning id
      `,
        [pId, SYS],
      );
      if (v1Ins.rows.length === 0) continue;
      const v1Id = v1Ins.rows[0].id;
      await client.query(
        `
        insert into product.plan_components
          (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
        values (gen_random_uuid(), $1, $2, $3, 'primary', 100, ARRAY[]::text[], '{}'::jsonb, 0, now())
        on conflict (plan_version_id, product_id, tier) do nothing
      `,
        [v1Id, atlasId, tier],
      );
    }
    console.log(
      "✓  product — atlas catalog skeleton (5 plans; v1 DRAFT/unlocked/unpublished, empty features+quota — admin fills in once Atlas repo-split lands a product definition)",
    );
  }

  // ── vxtpl catalog — SKELETON ONLY (first-batch onboarding, owner decision
  // 2026-08-30: vxtpl is the template agent that walks the whole onboarding line;
  // product_100_matrix.md v1.3 §7) ──────────────────────────────────────────
  // One free plan, priced 0 CNY/month, with a DRAFT, UNLOCKED, UNPUBLISHED v1 and
  // an empty primary component. Left as draft on purpose: bundled atlas/runos
  // components are attached in admin (80-plan-bundled-components.md) and the
  // version is published there — that IS the path later agents copy. Never
  // overwritten once inserted; plans.current_version_id stays unset until admin
  // publishes.
  const vxtplId = prodMap["vxtpl"];
  if (vxtplId) {
    await client.query(
      `
      insert into product.plans
        (id, plan_code, plan_name, plan_name_key, description, description_key, is_public, status, created_by, created_at, updated_at)
      values (gen_random_uuid(), $1, $2, $3, $4, $5, true, 'active', $6, now(), now())
      on conflict (plan_code) do nothing
    `,
      [
        "vxtpl-free",
        "Vxtpl Free",
        "product.plan.vxtpl-free",
        "Free tier for the template agent.",
        "product.plan.vxtpl-free.desc",
        SYS,
      ],
    );
    const vxtplPlan = await client.query(
      `select id from product.plans where plan_code = $1 limit 1`,
      ["vxtpl-free"],
    );
    const vxtplPlanId = vxtplPlan.rows[0]?.id;
    if (vxtplPlanId) {
      const v1Ins = await client.query(
        `
        insert into product.plan_versions (id, plan_id, version_no, status, is_locked, created_by, created_at)
        values (gen_random_uuid(), $1, 1, 'draft', false, $2, now())
        on conflict (plan_id, version_no) do nothing
        returning id
      `,
        [vxtplPlanId, SYS],
      );
      if (v1Ins.rows.length > 0) {
        const v1Id = v1Ins.rows[0].id;
        await client.query(
          `
          insert into product.plan_components
            (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
          values (gen_random_uuid(), $1, $2, 'free', 'primary', 100, ARRAY[]::text[], '{}'::jsonb, 0, now())
          on conflict (plan_version_id, product_id, tier) do nothing
        `,
          [v1Id, vxtplId],
        );
        await client.query(
          `
          insert into product.plan_prices (id, plan_version_id, cycle_unit, cycle_count, price, currency, created_at)
          values (gen_random_uuid(), $1, 'month', 1, 0, 'CNY', now())
          on conflict (plan_version_id, cycle_unit, cycle_count, currency) do nothing
        `,
          [v1Id],
        );
      }
    }
    console.log(
      "✓  product — vxtpl catalog skeleton (vxtpl-free; v1 DRAFT/unlocked/unpublished, 0 CNY/month — admin attaches bundled atlas/runos and publishes)",
    );
  }

  console.log(
    "✓  product — checklist + umbra-free + arda catalog (6 plans; v1 current/locked, v2 seeded as UNPUBLISHED placeholder draft on starter/pro/business/enterprise — all quota params & prices = 1, admin sets real values + publishes; 10 product metrics + 2 L0 contributions)",
  );

  // ── 11. identity.oauth_providers — inbound federation broker config ─────────
  const ssoProviders = [
    {
      id: ID.oauthFeishu,
      code: "feishu",
      name: "Feishu",
      sort: 1,
      scope:
        "contact:user.base:readonly contact:user.email:readonly contact:user.phone:readonly contact:user.id:readonly",
      authUrl: "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
      tokenUrl: "https://accounts.feishu.cn/oauth/v3/token",
      accountInfoUrl: "https://open.feishu.cn/open-apis/authen/v1/user_info",
      clientId: process.env.FEISHU_APP_ID || null,
      clientSecret: process.env.FEISHU_APP_SECRET || null,
      redirectUri: process.env.FEISHU_REDIRECT_URI || null,
    },
    {
      id: ID.oauthDingtalk,
      code: "dingtalk",
      name: "DingTalk",
      sort: 2,
      scope: "openid",
      authUrl: "https://login.dingtalk.com/oauth2/auth",
      tokenUrl: "https://api.dingtalk.com/v1.0/oauth2/userAccessToken",
      accountInfoUrl: "https://api.dingtalk.com/v1.0/contact/users/me",
      clientId: process.env.DINGTALK_APP_KEY || null,
      clientSecret: process.env.DINGTALK_APP_SECRET || null,
      redirectUri: process.env.DINGTALK_REDIRECT_URI || null,
    },
    {
      id: ID.oauthGoogle,
      code: "google",
      name: "Google",
      sort: 3,
      scope: "openid email profile",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      accountInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      clientId: process.env.GOOGLE_CLIENT_ID || null,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
      redirectUri: process.env.GOOGLE_REDIRECT_URI || null,
    },
  ];
  for (const p of ssoProviders) {
    // Compliance: Google federation is disabled platform-wide, regardless of creds.
    // feishu/dingtalk keep cred-derived enablement.
    const enabled =
      p.code === "google" ? false : Boolean(p.clientId && p.clientSecret);
    await client.query(
      `
      insert into identity.oauth_providers
        (id, code, name, name_key, scope, auth_url, token_url, account_info_url,
         client_id, client_secret, redirect_uri, is_enabled, sort, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), now())
      on conflict (code) do update set
        name = excluded.name, name_key = excluded.name_key, scope = excluded.scope,
        auth_url = excluded.auth_url, token_url = excluded.token_url,
        account_info_url = excluded.account_info_url,
        client_id = coalesce(excluded.client_id, identity.oauth_providers.client_id),
        client_secret = coalesce(excluded.client_secret, identity.oauth_providers.client_secret),
        redirect_uri = coalesce(excluded.redirect_uri, identity.oauth_providers.redirect_uri),
        is_enabled = excluded.is_enabled, updated_at = now()
    `,
      [
        p.id,
        p.code,
        p.name,
        `identity.provider.${p.code}`,
        p.scope,
        p.authUrl,
        p.tokenUrl,
        p.accountInfoUrl,
        p.clientId,
        p.clientSecret,
        p.redirectUri,
        enabled,
        p.sort,
      ],
    );
    console.log(
      `✓  identity.oauth_providers — ${p.code} (is_enabled=${enabled})`,
    );
  }
}

if (isMain(import.meta.url)) {
  runSeed("catalog", seedCatalog);
}
