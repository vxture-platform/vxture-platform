import type { IconName } from "@vxture/design-system";

// 三平面拆分 cutover（2026-09-02）：治理面（身份权限/安全审计/系统配置/通知基座）
// 整体迁往 arche 治理平面，admin 只保留「运营平台」这一个工作域。原
// `platform-autonomy` 自治域已撤，其中 /atlas（模型平台）作为商业/平台资源留在
// 运营域，/settings（操作员自助账户设置）保留为 Header 齿轮入口。
//
// ── 2026-09-18 重排（owner 逐条给定）────────────────────────────────────────
// 分组顺序、组名、条目名、分割线位置全部按 owner 的清单落，三条硬约束：
//
// 1. **`code` 一个都不动。** 它进 `admin.operator_permission.perm_code`（唯一约束），
//    是权限树的键。改名只改 `label`——把 code 跟着改等于让现有角色当场失权，而且
//    seed 与 DB 里的旧码还在，对不上。文件里本就有前车之鉴：`planVersions` 曾与
//    `servicePlans` 撞码（复制粘贴漏改），撞码连权限树都建不起来。
//
// 2. **图标在本门户内唯一。** 重排前 admin 有三组重复：`check`（优惠核销 / 收款
//    管理）、`table`（待办任务 / 交易订单 / 发票管理）、`star`（服务套餐 / 套餐发布
//    / 订阅管理）——都是随手取的，没有同类语义支撑，全部换掉。
//    注意这条**只适用于 admin**：opera 的 `list-checks` ×2 与 `gauge` ×2 是**有意**
//    共用（同一类对象在两个管理域里的实例，见 opera navigation.ts 文件头规则三），
//    那边不动。
//
// 3. **中英主副**（`subLabel`）：中文主名给人读，英文原词给人对上游审计事件与 API。
//    形态与 opera 一致，DS 的 `ShellNavItem.subLabel` 原生支持，收起态两行都不渲染。
export type AdminWorkspaceId = "tenant-ops";

export interface AdminNavigationItem {
  id: string;
  code?: string;
  i18nKey?: string;
  status?: "active" | "planned";
  href: string;
  label: string;
  /** 英文原词，渲染成主名下方的小字第二行（DS `ShellNavItem.subLabel`）。 */
  subLabel?: string;
  description: string;
  icon: IconName;
  disabled?: boolean;
}

export interface AdminNavigationSection {
  id: string;
  code?: string;
  i18nKey?: string;
  status?: "active" | "planned";
  title: string;
  /** 本组之前画一条分隔线（DS `ShellNavSection.dividerBefore`）；首组不画。 */
  dividerBefore?: boolean;
  items: AdminNavigationItem[];
}

export interface AdminNavigationWorkspace {
  id: AdminWorkspaceId;
  label: string;
  shortLabel: string;
  description: string;
  homeHref: string;
  icon: IconName;
  sections: AdminNavigationSection[];
}

const tenantOpsSections: AdminNavigationSection[] = [
  {
    id: "overview",
    code: "operation_overview_group",
    i18nKey: "menu.operation.overview_group",
    status: "active",
    title: "概览",
    items: [
      {
        id: "platformOverview",
        code: "operation_overview",
        i18nKey: "menu.operation.overview",
        status: "active",
        href: "/",
        label: "运营总览",
        subLabel: "Overview",
        description: "核心运营指标、各业务域关键趋势和平台健康快照。",
        icon: "squares-four",
      },
      {
        id: "opsTodos",
        code: "operation_todo",
        i18nKey: "menu.operation.todo",
        status: "active",
        href: "/ops-todos",
        label: "待办任务",
        subLabel: "Tasks",
        description: "聚合待审核、异常告警和需要人工介入的运营任务。",
        icon: "list-checks",
      },
    ],
  },
  {
    id: "tenantsAccounts",
    code: "tenant_account",
    i18nKey: "menu.operation.tenant_account",
    status: "active",
    title: "租户管理",
    dividerBefore: true,
    items: [
      {
        id: "tenants",
        code: "tenant_profile",
        i18nKey: "menu.operation.tenant_profile",
        status: "active",
        href: "/tenants",
        // 「租户管理」而不是「租户信息」（owner 2026-09-21）——页面改名后
        // 导航没跟上；侧栏与页内标题对不上的后果是运营以为是两个地方。
        label: "租户管理",
        subLabel: "Tenants",
        description: "管理平台租户资料、状态、生命周期和运营备注。",
        icon: "buildings",
      },
      {
        id: "accounts",
        /* 「账号管理」（owner 2026-09-21），与「租户管理」成对。code 不动。
           **改名要改两处**：侧栏渲染的中文来自 `messages/*.json` 的
           `navigation.items.accounts.label`，这里的 `label` 只是兜底。
           2026-09-18 那次「账号体系→平台用户」只改了这里，词条没跟上，
           于是侧栏三天来一直显示「账号体系」——改名等于没发生。 */
        code: "account_system",
        i18nKey: "menu.operation.account_system",
        status: "active",
        href: "/accounts",
        label: "账号管理",
        subLabel: "Accounts",
        description: "跨租户查询平台账号，管理账号状态、登录安全和联系方式。",
        icon: "user",
      },
      {
        id: "verifications",
        code: "identity_verification",
        i18nKey: "menu.operation.identity_verification",
        status: "active",
        href: "/verifications",
        label: "实名认证",
        subLabel: "Verification",
        description: "审核租户企业资质材料，处理通过、驳回和复核状态。",
        icon: "medal",
      },
    ],
  },
  {
    id: "productsPlans",
    code: "product_system",
    i18nKey: "menu.operation.product_system",
    status: "active",
    title: "产品体系",
    items: [
      {
        id: "products",
        code: "product_capability",
        i18nKey: "menu.operation.product_capability",
        status: "active",
        href: "/products",
        label: "产品目录",
        subLabel: "Products",
        description:
          "维护产品目录:成熟度（正式版/公测版/开发中）、上站可见性与营销内容（业务价值、能力亮点、行业等），供官网渲染。技术注册在运维台。",
        icon: "database",
      },
      {
        id: "planVersions",
        // 原本也写 `service_plan`（与「方案套餐」撞码），显然是复制粘贴漏改
        // ——它自己的 i18nKey 一直是 `plan_version`。菜单码要进
        // `admin.operator_permission.perm_code`（唯一约束），撞码建不起权限树。
        code: "plan_version",
        i18nKey: "menu.operation.plan_version",
        status: "active",
        href: "/plan-versions",
        // 正名「套餐发布」→「产品套餐」（owner 2026-09-18）：与下面的「方案套餐」
        // 成对——一个的主语是产品，一个的主语是行业方案。"发布"说的是动作不是对象。
        label: "产品套餐",
        subLabel: "Product Plans",
        description:
          "按产品发布套餐：每个产品挂几档由需要决定，草稿编辑价格与配额，发布冻结并设为当前版本，完整保留 plan_version 版本史。",
        icon: "package",
      },
      {
        id: "productSolutions",
        code: "solution_package",
        i18nKey: "menu.operation.solution_package",
        status: "active",
        href: "/product-solutions",
        label: "解决方案",
        subLabel: "Solutions",
        description:
          "按行业业务场景组合产品能力，定义方案边界、包含产品和适用客户。",
        icon: "workflow",
      },
      {
        id: "servicePlans",
        code: "service_plan",
        i18nKey: "menu.operation.service_plan",
        status: "active",
        href: "/service-plans",
        // 正名「服务套餐」→「方案套餐」（owner 2026-09-18）：主语是行业方案，与
        // 「产品套餐」成对可区分。
        label: "方案套餐",
        subLabel: "Solution Plans",
        description:
          "管理行业方案下的 Free、Pro、企业版等档位，把既有 plan 绑到方案的五档上。",
        icon: "stack",
      },
      {
        id: "promotions",
        code: "promotion_campaign",
        i18nKey: "menu.operation.promotion_campaign",
        status: "active",
        href: "/promotions",
        label: "营销优惠",
        subLabel: "Promotions",
        description: "配置优惠码和折扣活动，限定适用产品、套餐和核销规则。",
        icon: "sparkles",
      },
    ],
  },
  {
    id: "subscriptionsTransactions",
    code: "subscription_transaction",
    i18nKey: "menu.operation.subscription_transaction",
    status: "active",
    title: "订阅交易",
    items: [
      {
        id: "subscriptions",
        code: "subscription",
        i18nKey: "menu.operation.subscription",
        status: "active",
        href: "/subscriptions",
        label: "订阅管理",
        subLabel: "Subscriptions",
        description:
          "运营侧管理租户服务权益实例，处理试用转正、续期、暂停、取消和配额风险。",
        icon: "ticket",
      },
      {
        id: "orders",
        code: "order_record",
        i18nKey: "menu.operation.order_record",
        status: "active",
        href: "/orders",
        label: "交易订单",
        subLabel: "Orders",
        // 加油包订单合并进来（owner 2026-09-18）：它本来就是订单的一种（存储扩展包 /
        // AI 加油包），单列一项让同一件事在侧栏出现两次。**只是不再单独占一个菜单
        // 位**——`/addon-orders` 路由与页面都还在，深链不受影响。
        description:
          "查询订单列表和详情，追踪支付状态并处理异常订单；含存储扩展包 / AI 加油包的待核销队列。",
        icon: "receipt",
      },
      {
        id: "usageMetering",
        code: "usage_billing",
        i18nKey: "menu.operation.usage_billing",
        status: "active",
        href: "/usage-metering",
        label: "用量计费",
        subLabel: "Usage Billing",
        description:
          "查询租户、产品和套餐维度的用量明细，维护计量规则和异常告警。",
        icon: "gauge",
      },
      {
        id: "promotionRedemptions",
        code: "promotion_redeem",
        i18nKey: "menu.operation.promotion_redeem",
        status: "active",
        href: "/promotion-redemptions",
        label: "优惠核销",
        subLabel: "Redemptions",
        description: "查看优惠码使用记录、折扣核销统计和订单关联数据。",
        icon: "seal-check",
      },
    ],
  },
  {
    id: "supportCompliance",
    code: "customer_service",
    i18nKey: "menu.operation.customer_service",
    status: "active",
    title: "客户服务",
    // 这里**不画线**（owner 2026-09-20）：租户管理 / 产品体系 / 订阅交易 /
    // 客户服务四组都是围绕客户展开的，属同一层，中间切一刀会把它们读成两段。
    // 全侧栏只留两条线，切出「概览 / 客户侧 / 经营侧」三层。
    items: [
      {
        id: "tickets",
        code: "support_ticket",
        i18nKey: "menu.operation.support_ticket",
        status: "active",
        href: "/tickets",
        label: "工单中心",
        subLabel: "Tickets",
        description: "处理用户工单、人工分派、状态流转和反馈闭环。",
        icon: "chat-circle",
      },
      {
        id: "announcements",
        code: "notification_message",
        i18nKey: "menu.operation.notification_message",
        status: "active",
        href: "/announcements",
        label: "消息公告",
        subLabel: "Announcements",
        description: "发布平台公告和定向通知，查询通知触达与历史记录。",
        icon: "megaphone",
      },
    ],
  },
  {
    id: "financeSettlement",
    code: "finance_settlement",
    i18nKey: "menu.operation.finance_settlement",
    status: "active",
    title: "财务结算",
    dividerBefore: true,
    items: [
      {
        id: "billing",
        code: "billing_center",
        i18nKey: "menu.operation.billing_center",
        status: "active",
        href: "/billing",
        label: "账单中心",
        subLabel: "Billing",
        description: "管理账单生成、应收确认、异常处理和线下发票登记入口。",
        icon: "file-text",
      },
      {
        id: "payments",
        code: "payment_record",
        i18nKey: "menu.operation.payment_record",
        status: "active",
        href: "/payments",
        label: "收款管理",
        subLabel: "Payments",
        description:
          "收款台账与对账视角，查看线下/线上收款、账单关联和需关注流水。",
        icon: "wallet",
      },
      {
        id: "invoices",
        code: "invoice_record",
        i18nKey: "menu.operation.invoice_record",
        status: "active",
        href: "/invoices",
        label: "发票管理",
        subLabel: "Invoices",
        description:
          "线下发票台账，跟踪开票登记、寄送交付、红冲作废和账单关联。",
        icon: "certificate",
      },
    ],
  },
  {
    id: "commercialAnalysis",
    code: "commercial_analysis",
    i18nKey: "menu.operation.commercial_analysis",
    status: "active",
    // 正名「商业分析」→「商业管理」（owner 2026-09-18）：组里除了分析还有计价策略，
    // 后者是配置不是分析。
    title: "商业管理",
    items: [
      {
        id: "commerceOverview",
        code: "commerce_overview",
        i18nKey: "menu.operation.commerce_overview",
        status: "active",
        href: "/commerce-overview",
        label: "商业分析",
        subLabel: "Commerce Analytics",
        description:
          "聚合订阅、订单、收款、账单、发票、用量和优惠的运营指标与风险快照。",
        icon: "chart-bar",
      },
      {
        // /atlas：三平面拆分后从原「平台自治域」迁入。它是商业/平台资源（模型供应/
        // 路由/策略）非治理，故留在 admin 运营域；opera 产品目录的
        // buildAdminAtlasGrantsUrl() 深链仍指向这里。菜单码 model_gateway /
        // i18nKey menu.platform.model_gateway 保持不变。
        id: "atlas",
        code: "model_gateway",
        i18nKey: "menu.platform.model_gateway",
        status: "active",
        href: "/atlas",
        // admin 侧只写商业封装（计价规则 + 限流策略），供应商/模型是只读镜像；真正
        // 的模型平台（供应生命周期/密钥/路由）在 opera /model/services。
        label: "模型计价策略",
        subLabel: "Model Pricing",
        description:
          "配置模型计价规则与限流策略；供应商/模型为只读，其生命周期管理在运维台。",
        icon: "coins",
      },
      {
        // 与「模型计价策略」成对的能力侧计价面。**尚无页面**：本条按注册表里既有的
        // `planned` 形态占位并禁用，不给它 `code`——菜单码要进
        // `admin.operator_permission.perm_code`，新增一个要同时动 seed 与迁移（权限
        // 目录那条线），不在本批范围。做页面时连同权限码一起补。
        id: "capabilityPricing",
        i18nKey: "menu.operation.capability_pricing",
        status: "planned",
        href: "/capability-pricing",
        label: "能力计价策略",
        subLabel: "Capability Pricing",
        description: "配置能力调用的计价规则与限流策略（规划中，页面尚未建）。",
        icon: "percent",
      },
    ],
  },
];

// 「模型技能」分组已撤（2026-09-18）：/atlas 并入「商业管理」，而「能力目录」
// （/skills，Runos 能力注册表的只读镜像）按 owner 指示**从侧栏删除**——注册与管理
// 本就在 opera「能力注册」，admin 这份只读镜像没有独立的运营动作。路由与页面保留，
// 只是不再占一个菜单位。
//
// 原 platformAutonomySections（平台自治域）已整体撤走 —— 三平面拆分 cutover
// （2026-09-02）：身份权限、安全审计、系统配置、通知基座九页迁往 arche 治理平面。
// /settings（操作员自助账户设置）不进侧栏，走 Header 齿轮入口（AdminHeader）。

export const adminWorkspaces: AdminNavigationWorkspace[] = [
  {
    id: "tenant-ops",
    // 三平面统一措辞「{X}平面」（owner 2026-09-18）：admin=运营、opera=运维、
    // arche=治理，三家 header 用同一个词尾，避免「平台」既指产品又指平面。
    label: "运营平面",
    shortLabel: "运营",
    description: "面向租户、用户、产品、订阅、交易和服务支持的运营管理。",
    homeHref: "/",
    icon: "buildings",
    sections: tenantOpsSections,
  },
];

export const defaultAdminWorkspace: AdminNavigationWorkspace =
  adminWorkspaces[0] as AdminNavigationWorkspace;
export const adminNavigationSections: AdminNavigationSection[] =
  tenantOpsSections;

export function flattenAdminNavigationSections(
  workspaces: AdminNavigationWorkspace[] = adminWorkspaces,
) {
  return workspaces.flatMap((workspace) =>
    workspace.sections.map((section) => ({
      workspace,
      section,
    })),
  );
}

export function flattenAdminNavigationItems(
  workspaces: AdminNavigationWorkspace[] = adminWorkspaces,
) {
  return flattenAdminNavigationSections(workspaces).flatMap(
    ({ workspace, section }) =>
      section.items.map((item) => ({
        workspace,
        section,
        item,
      })),
  );
}

function isActivePath(pathname: string, href: string) {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function getAdminNavigationItemByPath(pathname: string) {
  return flattenAdminNavigationItems().find(({ item }) =>
    isActivePath(pathname, item.href),
  );
}

export function getAdminWorkspaceByPath(
  pathname: string,
): AdminNavigationWorkspace {
  const itemMatch = getAdminNavigationItemByPath(pathname);

  if (itemMatch) {
    return itemMatch.workspace;
  }

  return (
    adminWorkspaces.find((workspace) =>
      isActivePath(pathname, workspace.homeHref),
    ) ?? defaultAdminWorkspace
  );
}
