import type { IconName } from "@vxture/design-system";

export type AdminWorkspaceId = "tenant-ops" | "platform-autonomy";

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
        label: "产品能力",
        description:
          "管理可组合、可授权、可计量的基础产品能力，包括平台、智能体、大模型和三方接入能力。",
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
        id: "modelGrants",
        code: "model_access",
        i18nKey: "menu.operation.model_access",
        status: "active",
        href: "/model-grants",
        label: "模型授权",
        description: "按产品、租户和套餐配置模型访问权限、配额和路由优先级。",
        icon: "shield-check",
      },
      {
        id: "skills",
        code: "skill_market",
        i18nKey: "menu.operation.skill_market",
        status: "active",
        href: "/skills",
        label: "技能市场",
        description: "注册和管理智能体可调用技能，配置上下线、端点和运行状态。",
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

const platformAutonomySections: AdminNavigationSection[] = [
  {
    id: "autonomyOverview",
    code: "platform_overview",
    i18nKey: "menu.platform.overview",
    status: "active",
    title: "平台总览",
    items: [
      {
        id: "platformAutonomy",
        code: "platform_overview",
        i18nKey: "menu.platform.overview",
        status: "active",
        href: "/platform",
        label: "平台总览",
        description:
          "平台自治域首页，展示平台运行状态、关键指标、风险提醒与治理入口。",
        icon: "squares-four",
      },
    ],
  },
  {
    id: "identityAccess",
    code: "identity_access",
    i18nKey: "menu.platform.identity_access",
    status: "active",
    title: "身份权限",
    items: [
      {
        id: "platformAdmins",
        code: "platform_admin",
        i18nKey: "menu.platform.admin_user",
        status: "active",
        href: "/platform-admins",
        label: "平台用户",
        description: "管理平台自治域内部用户，不面向租户最终用户。",
        icon: "user",
      },
      {
        id: "adminRoles",
        code: "platform_role",
        i18nKey: "menu.platform.admin_role",
        status: "active",
        href: "/admin-roles",
        label: "平台角色",
        description:
          "管理平台内部角色，包括预置角色、自定义角色、角色状态与角色授权。",
        icon: "role",
      },
      {
        id: "adminPermissions",
        code: "permission_policy",
        i18nKey: "menu.platform.permission_policy",
        status: "active",
        href: "/admin-permissions",
        label: "权限策略",
        description: "管理平台自治域权限点、权限分组、策略绑定与授权范围。",
        icon: "shield-check",
      },
    ],
  },
  {
    id: "platformResources",
    code: "platform_resource",
    i18nKey: "menu.platform.platform_resource",
    status: "active",
    title: "平台资源",
    items: [
      {
        id: "atlas",
        code: "model_gateway",
        i18nKey: "menu.platform.model_gateway",
        status: "active",
        href: "/atlas",
        label: "模型平台",
        description:
          "管理大模型供应商、模型路由、调用策略、限流策略与可用性状态。",
        icon: "cloud",
      },
      // 密钥管理（/platform-secrets）2026-08-31 摘掉：它读的 admin.governance_record
      // 从未建表，页面永远为空；平台密钥的真实归属是 deploy 的 27-provision 与 opera
      // 「接入凭据」。同批摘掉的还有审批中心 / 字典管理 / 通知渠道——四间空屋，上线
      // 前一并撤（owner 2026-08-30 裁定）。菜单码与 seed 的 operator_permission 行
      // 随本次一起退役（migrations/2026-08-31-admin-retire-empty-menus.sql）。
    ],
  },
  // runtimeOps（「运行保障」组）已整体撤走：维护窗口（2026-08-07）、服务监控
  // （2026-08-11）、任务调度（2026-08-11）先后迁往 opera，三项都是基础设施运维，
  // 归控制平面而不是运营后台。任务调度在 opera 侧换了数据源——admin 这份读的
  // admin.governance_record 从未建过表（设计已弃用，见
  // docs/30-design/data_admin_200_schema.md），opera 那份改成
  // provisioning.webhook_deliveries（真实的 webhook 投递队列，此前无任何观测面）
  // 的观测视图，不是同一份代码搬家。菜单码/i18n key 随组一并撤走。
  {
    id: "securityAudit",
    code: "security_audit",
    i18nKey: "menu.platform.security_audit",
    status: "active",
    title: "安全审计",
    items: [
      {
        id: "auditLogs",
        code: "audit_log",
        i18nKey: "menu.platform.audit_log",
        status: "active",
        href: "/audit-logs",
        label: "审计日志",
        description: "查询平台操作日志、登录日志、权限变更日志和安全事件日志。",
        icon: "info",
      },
      {
        id: "riskRecords",
        code: "risk_record",
        i18nKey: "menu.platform.risk_record",
        status: "active",
        href: "/risk-records",
        label: "风险记录",
        description: "管理租户风险评估记录：录入、跟进、审阅处置与标签归类。",
        icon: "warning",
      },
      {
        id: "complianceEvents",
        code: "compliance_event",
        i18nKey: "menu.platform.compliance_event",
        status: "active",
        href: "/compliance-events",
        label: "合规事件",
        description:
          "跟踪平台与租户合规事件：指派处理人、办结与驳回、证据留存。",
        icon: "shield-check",
      },
    ],
  },
  {
    id: "systemSetting",
    code: "system_setting",
    i18nKey: "menu.platform.system_setting",
    status: "planned",
    title: "系统配置",
    items: [
      {
        id: "systemSettings",
        code: "system_setting_general",
        i18nKey: "menu.platform.system_setting_general",
        status: "active",
        href: "/settings",
        label: "系统设置",
        description:
          "平台级系统设置入口，集中管理通用偏好、运行参数与全局策略。Header 齿轮为其快捷入口。",
        icon: "settings",
      },
      {
        id: "systemParameters",
        code: "system_parameter",
        i18nKey: "menu.platform.system_parameter",
        status: "planned",
        href: "/system-parameters",
        label: "参数配置",
        description:
          "待建设模块，用于维护平台级参数、默认值、运行参数和全局策略参数。",
        icon: "settings",
      },
      {
        id: "featureToggles",
        code: "feature_toggle",
        i18nKey: "menu.platform.feature_toggle",
        status: "planned",
        href: "/feature-toggles",
        label: "开关控制",
        description:
          "待建设模块，用于控制平台功能开关、灰度开关、实验开关和风险隔离开关。",
        icon: "trigger",
      },
    ],
  },
  {
    id: "notificationCenter",
    code: "notification_center",
    i18nKey: "menu.platform.notification_center",
    status: "planned",
    title: "通知中心",
    items: [
      {
        id: "notificationLogs",
        code: "notification_log",
        i18nKey: "menu.platform.notification_log",
        status: "planned",
        href: "/notification-logs",
        label: "发送记录",
        description:
          "待建设模块，用于追踪平台通知能力的发送记录、回执和失败重试。",
        icon: "table",
      },
    ],
  },
];

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
  {
    id: "platform-autonomy",
    label: "平台自治域",
    shortLabel: "自治域",
    description: "面向内部用户、平台资源、运行可靠性、安全审计和治理能力。",
    homeHref: "/platform",
    icon: "shield-check",
    sections: platformAutonomySections,
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
