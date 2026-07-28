/**
 * navigation.ts — Capability Console shell navigation registry.
 *
 * The shell owns only chrome-level navigation: an overview page plus one entry
 * per mounted L1 provider admin module. Module entries are FULL page
 * navigations (`external: true`) — each module is an independent app the edge
 * proxies under its mount path (10-shell-mount-contract.md §2), not a Next.js
 * route of this shell. A new L1 module = one item here + its nginx location
 * block + the BFF audience map entry.
 */

export interface CapNavItem {
  href: string;
  label: string;
  icon: string;
  /** true = mounted provider module (full navigation, edge-proxied app) */
  external: boolean;
  /** module not yet deployed (mount reserved by contract, batch D/F) */
  pending?: boolean;
  description?: string;
}

export interface CapNavSection {
  title: string;
  items: CapNavItem[];
}

export const capNavSections: CapNavSection[] = [
  {
    title: "控制台",
    items: [
      {
        href: "/",
        label: "总览",
        icon: "ph-squares-four",
        external: false,
      },
    ],
  },
  {
    title: "能力模块",
    items: [
      {
        href: "/atlas/",
        label: "Atlas · 模型平台",
        icon: "ph-cpu",
        external: true,
        pending: true,
        description:
          "Provider / 模型注册表、密钥轮换、路由策略(atlas admin-module,批D 挂载)",
      },
      {
        href: "/runa/",
        label: "Runa · 技能平台",
        icon: "ph-plugs-connected",
        external: true,
        pending: true,
        description: "技能注册、上下线、验签(runa admin-module,批F 挂载)",
      },
    ],
  },
];
