/**
 * navigation.ts — Arche 导航注册表（业务配置，由产品侧组装）。
 *
 * Arche 是**平台治理平面**：从 admin 剥出的最高信任层，只管平台自身的身份权限、
 * 安全审计、风控合规、系统配置与通知审计。与 admin（商业运营）、opera（技术运维）
 * 三平面按操作人群分立——治理动作的信任等级最高、频率最低，物理独立成面以落实
 * 职责分离（SoD）与审计独立性。
 *
 * 命名沿用 opera 的三条规则：`label` 中文功能名 + `subLabel` 英文原词同项两行；
 * `description` 只喂 Ctrl+K 搜索不进侧栏；分组按**管理域**切分。
 *
 * 图标一律取 DS iconDictionary 语义键（类型收窄为 IconName，写错编译期报）。
 *
 * PR① 阶段：本文件先立信息架构，各页为占位；真实页面与 arche-bff router 在 PR②
 * 从 admin「平台自治域」迁入。类型契约来自 DS 的 ShellSidebarNav。
 */

import type { ShellNavItem, ShellNavSection } from "@vxture/design-system";

export interface ArcheNavItem extends ShellNavItem {
  /** 只喂 Ctrl+K 搜索与搜索结果副行，侧栏不渲染。 */
  description?: string;
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
        description: "身份、审计、合规、配置的当前态与待办",
      },
    ],
  },
  {
    /* 平台自身的账号 / 角色 / 权限策略。写口单点在治理面，admin 与 opera 只读跳转。 */
    title: "身份权限",
    dividerBefore: true,
    items: [
      {
        href: "/admins",
        label: "平台用户",
        subLabel: "Platform Admin",
        icon: "fingerprint",
        description: "内部运营账号的开通、停用与凭证",
      },
      {
        href: "/roles",
        label: "平台角色",
        subLabel: "Role",
        icon: "role",
        description: "操作角色与其 rank（跨操作员管控）",
      },
      {
        href: "/permissions",
        label: "权限策略",
        subLabel: "Permission Policy",
        icon: "list-checks",
        description: "域 / 板块 / 页面 / 操作四级权限树",
      },
    ],
  },
  {
    /* 谁在什么时候改了什么 + 风控与合规。与 opera 的「技术变更审计」不同类：
       这里是操作 / 问责 / 合规，opera 那边是管理面技术变更。 */
    title: "安全审计",
    items: [
      {
        href: "/audit-logs",
        label: "审计日志",
        subLabel: "Audit Log",
        icon: "clipboard",
        description: "操作员动作的全量问责流水",
      },
      {
        href: "/risk-records",
        label: "风险记录",
        subLabel: "Risk Record",
        icon: "shield-check",
        description: "风控命中与处置",
      },
      {
        href: "/compliance-events",
        label: "合规事件",
        subLabel: "Compliance Event",
        icon: "certificate",
        description: "合规义务事件与留痕",
      },
    ],
  },
  {
    /* 平台级配置：参数、开关。配的是被治理的平台，不是控制台自己。 */
    title: "系统配置",
    items: [
      {
        href: "/settings",
        label: "系统设置",
        subLabel: "Settings",
        icon: "settings",
        description: "平台级通用设置",
      },
      {
        href: "/system-parameters",
        label: "参数配置",
        subLabel: "Parameter",
        icon: "gauge",
        description: "运行参数的集中管理",
      },
      {
        href: "/feature-toggles",
        label: "开关控制",
        subLabel: "Feature Toggle",
        icon: "tree-structure",
        description: "特性开关的启停与灰度",
      },
    ],
  },
  {
    /* 通知的**投递审计**（发送记录/回执留痕，只读）。发送动作与"基座"（渠道/模板/
       队列）不归治理：向租户发通知是 admin 客户服务域的事，投递基座是基础设施。
       治理面只保留合规问责视角，故正名「通知审计」，不叫"基座"。 */
    title: "通知审计",
    dividerBefore: true,
    items: [
      {
        href: "/notification-logs",
        label: "发送记录",
        subLabel: "Notification Log",
        icon: "terminal",
        description: "系统通知的投递流水与状态",
      },
    ],
  },
];
