import type { IconName } from "@vxture/design-system";

// 三平面拆分 cutover（2026-09-02）：治理面（身份权限/安全审计/系统配置/通知基座）
// 整体迁往 arche 治理平面，admin 只保留「运营业务域」这一个工作域。原
// `platform-autonomy` 自治域已撤，其中 /atlas（模型平台）作为商业/平台资源留在
// 运营域「模型技能」分组，/settings（操作员自助账户设置）保留为 Header 齿轮入口。
export type AdminWorkspaceId = "tenant-ops";

export interface AdminNavigationItem {
  id: string;
  code?: string;
  i18nKey?: string;
  status?: "active" | "planned";
  href: string;
  label: string;
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
    title: "运营总览",
    items: [
      {
        id: "platformOverview",
        code: "operation_overview",
        i18nKey: "menu.operation.overview",
        status: "active",
        href: "/",
        label: "运营总览",
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
        description: "聚合待审核、异常告警和需要人工介入的运营任务。",
        icon: "table",
      },
    ],
  },
  {
    id: "tenantsAccounts",
    code: "tenant_account",
    i18nKey: "menu.operation.tenant_account",
    status: "active",
    title: "租户账号",
    items: [
      {
        id: "tenants",
        code: "tenant_profile",
        i18nKey: "menu.operation.tenant_profile",
        status: "active",
        href: "/tenants",
        label: "租户信息",
        description: "管理平台租户资料、状态、生命周期和运营备注。",
        icon: "buildings",
      },
      {
        id: "accounts",
        code: "account_system",
        i18nKey: "menu.operation.account_system",
        status: "active",
        href: "/accounts",
        label: "账号体系",
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
        description:
          "维护产品目录:成熟度（正式版/公测版/开发中）、上站可见性与营销内容（业务价值、能力亮点、行业等），供官网渲染。技术注册在运维台。",
        icon: "database",
      },
      {
        id: "productSolutions",
        code: "solution_package",
        i18nKey: "menu.operation.solution_package",
        status: "active",
        href: "/product-solutions",
        label: "解决方案",
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
        label: "服务套餐",
        description:
          "管理业务产品方案下的 Free、Pro、企业版等服务套餐，配置配额、价格和售卖范围。",
        icon: "star",
      },
      {
        id: "planVersions",
        // 原本也写 `service_plan`（与上面「服务套餐」撞码），显然是复制粘贴漏改
        // ——它自己的 i18nKey 一直是 `plan_version`。菜单码要进
        // `admin.operator_permission.perm_code`（唯一约束），撞码建不起权限树。
        code: "plan_version",
        i18nKey: "menu.operation.plan_version",
        status: "active",
        href: "/plan-versions",
        label: "套餐发布",
        description:
          "按产品 × 五档矩阵发布套餐：空档新建、草稿编辑价格与配额、发布冻结并设为当前版本，完整保留 plan_version 版本史。",
        icon: "star",
      },
      {
        id: "promotions",
        code: "promotion_campaign",
        i18nKey: "menu.operation.promotion_campaign",
        status: "active",
        href: "/promotions",
        label: "营销优惠",
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
        description:
          "运营侧管理租户服务权益实例，处理试用转正、续期、暂停、取消和配额风险。",
        icon: "star",
      },
      {
        id: "orders",
        code: "order_record",
        i18nKey: "menu.operation.order_record",
        status: "active",
        href: "/orders",
        label: "交易订单",
        description: "查询订单列表和详情，追踪支付状态并处理异常订单。",
        icon: "table",
      },
      {
        id: "addonOrders",
        code: "addon_order_record",
        i18nKey: "menu.operation.addon_order_record",
        status: "active",
        href: "/addon-orders",
        label: "加油包订单",
        description:
          "存储扩展包 / AI 加油包的待核销队列,确认收款即自动授予配额池。",
        icon: "lightning",
      },
      {
        id: "usageMetering",
        code: "usage_billing",
        i18nKey: "menu.operation.usage_billing",
        status: "active",
        href: "/usage-metering",
        label: "用量计费",
        description:
          "查询租户、产品和套餐维度的用量明细，维护计量规则和异常告警。",
        icon: "graph",
      },
      {
        id: "promotionRedemptions",
        code: "promotion_redeem",
        i18nKey: "menu.operation.promotion_redeem",
        status: "active",
        href: "/promotion-redemptions",
        label: "优惠核销",
        description: "查看优惠码使用记录、折扣核销统计和订单关联数据。",
        icon: "check",
      },
    ],
  },
  {
    id: "commercialAnalysis",
    code: "commercial_analysis",
    i18nKey: "menu.operation.commercial_analysis",
    status: "active",
    title: "商业分析",
    items: [
      {
        id: "commerceOverview",
        code: "commerce_overview",
        i18nKey: "menu.operation.commerce_overview",
        status: "active",
        href: "/commerce-overview",
        label: "商业总览",
        description:
          "聚合订阅、订单、收款、账单、发票、用量和优惠的运营指标与风险快照。",
        icon: "chart-bar",
      },
    ],
  },
  {
    id: "capabilitiesServices",
    code: "model_skill",
    i18nKey: "menu.operation.model_skill",
    status: "active",
    title: "模型技能",
    items: [
      {
        // /atlas 模型平台：三平面拆分后从原「平台自治域」迁入。它是商业/平台资源
        // （模型供应/路由/策略），非治理，故留在 admin 运营域而不随治理面去 arche；
        // opera 产品目录的 buildAdminAtlasGrantsUrl() 深链仍指向这里。菜单码
        // model_gateway / i18nKey menu.platform.model_gateway 保持不变——seed 权限
        // 码不动（arche 与 admin 共用同一套 admin.operator_permission.perm_code）。
        id: "atlas",
        code: "model_gateway",
        i18nKey: "menu.platform.model_gateway",
        status: "active",
        href: "/atlas",
        // 名实归位(2026-09-02):admin 侧只写商业封装(计价规则+限流策略),供应商/模型
        // 是只读镜像;真正的模型平台(供应生命周期/密钥/路由)在 opera /model/services。
        // 故正名为「模型计价与策略」,不再借"模型平台"这个基础设施名。
        label: "模型计价与策略",
        description:
          "配置模型计价规则与限流策略；供应商/模型为只读，其生命周期管理在运维台。",
        icon: "cloud",
      },
      // /model-grants「模型授权」(tenant↔model 轴) 已退役(2026-09-02,owner 授权):
      // Atlas 自身文档标注该轴"不应存在",访问应从订阅(tenant↔product)+ 产品↔端点
      // 绑定(opera /model/grants)派生。删 admin 的管理面,不碰 Atlas 存量授权与执行。
      {
        id: "skills",
        code: "skill_market",
        i18nKey: "menu.operation.skill_market",
        status: "active",
        href: "/skills",
        // 名实归位(2026-09-02):本页是 Runos 能力注册表的**只读**镜像,注册与管理在
        // opera「能力注册」。"技能市场"暗示可交易/可管理,与只读实质不符 → 正名「能力目录」。
        label: "能力目录",
        description:
          "Runos 已注册能力的只读目录；注册与管理在运维台「能力注册」。",
        icon: "cube",
      },
    ],
  },
  {
    id: "financeSettlement",
    code: "finance_settlement",
    i18nKey: "menu.operation.finance_settlement",
    status: "active",
    title: "财务结算",
    items: [
      {
        id: "billing",
        code: "billing_center",
        i18nKey: "menu.operation.billing_center",
        status: "active",
        href: "/billing",
        label: "账单中心",
        description: "管理账单生成、应收确认、异常处理和线下发票登记入口。",
        icon: "key",
      },
      {
        id: "payments",
        code: "payment_record",
        i18nKey: "menu.operation.payment_record",
        status: "active",
        href: "/payments",
        label: "收款管理",
        description:
          "收款台账与对账视角，查看线下/线上收款、账单关联和需关注流水。",
        icon: "check",
      },
      {
        id: "invoices",
        code: "invoice_record",
        i18nKey: "menu.operation.invoice_record",
        status: "active",
        href: "/invoices",
        label: "发票管理",
        description:
          "线下发票台账，跟踪开票登记、寄送交付、红冲作废和账单关联。",
        icon: "table",
      },
    ],
  },
  {
    id: "supportCompliance",
    code: "customer_service",
    i18nKey: "menu.operation.customer_service",
    status: "active",
    title: "客户服务",
    items: [
      {
        id: "tickets",
        code: "support_ticket",
        i18nKey: "menu.operation.support_ticket",
        status: "active",
        href: "/tickets",
        label: "工单中心",
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
        description: "发布平台公告和定向通知，查询通知触达与历史记录。",
        icon: "bell",
      },
    ],
  },
];

// 原 platformAutonomySections（平台自治域）已整体撤走 —— 三平面拆分 cutover
// （2026-09-02）：身份权限（平台用户/角色/权限策略）、安全审计（审计日志/风险记录/
// 合规事件）、系统配置（参数配置/开关控制）、通知基座（发送记录）九页迁往 arche
// 治理平面（arche.vxture.com，独立门户 + arche-bff，读写同一套 admin.* 表）。
// 保留在 admin 运营域的两项已就地安置：/atlas（模型平台）并入上方「模型技能」分组；
// /settings（操作员自助账户设置）不再进侧栏，走 Header 齿轮入口（AdminHeader）。
// 平台总览（/platform）撤销，其职能由 arche 的「治理总览」承接。

export const adminWorkspaces: AdminNavigationWorkspace[] = [
  {
    id: "tenant-ops",
    label: "运营业务域",
    shortLabel: "运营域",
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
