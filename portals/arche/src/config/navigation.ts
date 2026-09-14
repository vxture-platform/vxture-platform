/**
 * navigation.ts — Arche 导航注册表（业务配置，由产品侧组装）。
 *
 * Arche 是**治理平台**：平台自身的身份权限、安全审计、系统配置与通知审计。与 admin
 * （运营）、opera（运维）三个平台按操作人群分立——治理动作的信任等级最高、频率最低，
 * 物理独立成面以落实职责分离（SoD）与审计独立性。
 *
 * 命名沿用 opera 的三条规则：`label` 中文功能名 + `subLabel` 英文原词同项两行；
 * `description` 只喂 Ctrl+K 搜索与总览入口卡，不进侧栏；分组按**管理域**切分。
 *
 * **每个页面带它在权限树里的页面码**（`arche.menu.*`，与 seed-catalog.mjs 的
 * MENU_TREE 逐项对应）。侧栏、搜索与总览入口只列本人持有页面码的页面——授权闭包保证
 * 持有某页的任一操作码就持有该页的页面码。总览不带码：进得了本平台就看得见。
 *
 * 图标一律取 DS iconDictionary 语义键（类型收窄为 IconName，写错编译期报）。
 */

import type { ShellNavItem, ShellNavSection } from "@vxture/design-system";

export interface ArcheNavItem extends ShellNavItem {
  /** 只喂 Ctrl+K 搜索、搜索结果副行与总览入口卡，侧栏不渲染。 */
  description?: string;
  /** 权限树里的页面码。缺省 = 进得了本平台就看得见（仅总览）。 */
  code?: string;
}

export interface ArcheNavSection extends Omit<ShellNavSection, "items"> {
  items: ArcheNavItem[];
}

export const archeNavSections: ArcheNavSection[] = [
  {
    title: "概览",
    items: [
      {
        href: "/",
        label: "治理总览",
        subLabel: "Overview",
        icon: "squares-four",
        description: "身份、会话、审计、风险、合规与配置的当前态与待办",
      },
    ],
  },
  {
    /* 平台自身的账号 / 角色 / 权限策略 / 登录会话。写口单点在治理平台。 */
    title: "身份权限",
    dividerBefore: true,
    items: [
      {
        href: "/admins",
        label: "平台用户",
        subLabel: "Platform Admin",
        icon: "fingerprint",
        description: "三个平台运营账号的开通、停用与凭证",
        code: "arche.menu.platform_admin",
      },
      {
        href: "/roles",
        label: "平台角色",
        subLabel: "Role",
        icon: "role",
        description: "操作角色、等级与 MFA 下限",
        code: "arche.menu.platform_role",
      },
      {
        href: "/permissions",
        label: "权限策略",
        subLabel: "Permission Policy",
        icon: "list-checks",
        description: "运营、运维、治理三个平台的权限树",
        code: "arche.menu.permission_policy",
      },
      {
        href: "/sessions",
        label: "登录与会话",
        subLabel: "Sign-in & Session",
        icon: "clock",
        description: "在线会话与登录记录（含失败与锁定）",
        code: "arche.menu.sign_in_session",
      },
    ],
  },
  {
    /* 谁在什么时候改了什么 + 风控与合规。与 opera 的「变更审计」不同类：
       这里是操作 / 问责 / 合规，opera 那边是它自己的技术变更。 */
    title: "安全审计",
    items: [
      {
        href: "/audit-logs",
        label: "审计日志",
        subLabel: "Audit Log",
        icon: "clipboard",
        description: "操作员动作的全量问责流水",
        code: "arche.menu.audit_log",
      },
      {
        href: "/risk-records",
        label: "风险记录",
        subLabel: "Risk Record",
        icon: "shield-check",
        description: "风控命中与处置",
        code: "arche.menu.risk_record",
      },
      {
        href: "/compliance-events",
        label: "合规事件",
        subLabel: "Compliance Event",
        icon: "certificate",
        description: "合规义务事件与留痕",
        code: "arche.menu.compliance_event",
      },
    ],
  },
  {
    /* 平台级配置：参数、开关。配的是被治理的平台，不是控制台自己。 */
    title: "系统配置",
    items: [
      {
        href: "/system-parameters",
        label: "参数配置",
        subLabel: "Parameter",
        icon: "gauge",
        description: "平台运行参数的集中管理",
        code: "arche.menu.system_parameter",
      },
      {
        href: "/feature-toggles",
        label: "开关控制",
        subLabel: "Feature Toggle",
        icon: "tree-structure",
        description: "特性开关的启停与灰度",
        code: "arche.menu.feature_toggle",
      },
    ],
  },
  {
    /* 通知的**投递审计**（发送记录/回执留痕，只读）。发送动作与投递基座不归治理。 */
    title: "通知审计",
    dividerBefore: true,
    items: [
      {
        href: "/notification-logs",
        label: "发送记录",
        subLabel: "Notification Log",
        icon: "terminal",
        description: "系统通知的投递流水与状态",
        code: "arche.menu.notification_log",
      },
    ],
  },
];

/**
 * 本人看得见的分组与页面。能力码还没取回（空数组）时返回全部：空侧栏一闪而过比
 * 多列几项更难受，而页面接口本身会挡。没有任何可见页面的分组整组隐去。
 */
export function visibleNavSections(
  capabilities: readonly string[],
): ArcheNavSection[] {
  if (capabilities.length === 0) return archeNavSections;
  return archeNavSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.code || capabilities.includes(item.code),
      ),
    }))
    .filter((section) => section.items.length > 0);
}
