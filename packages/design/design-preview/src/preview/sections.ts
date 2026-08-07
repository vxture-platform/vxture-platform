/**
 * sections.ts - 六个大类。
 * @package @vxture/design-preview
 *
 * 每个大类**独占一个页面**，各自统计各自的东西——把全部资源堆在一页，顶部那组数
 * 只能是其中一类的汇总，对其余五类都是错的。
 *
 * 组件按**粒度**分三类，不按定制来源分——`Layer` 的判据见 `./registry`。谁做的
 * （上游 / 我们改的 / 我们建的）由出处标签表达，那是另一根轴，两者不该互相冒充。
 */

import type { Layer } from "./registry";

export type SectionKind = "color" | "icon" | "type" | "component";

export interface Section {
  /** 路由段，同时是 nav 的 key。 */
  readonly slug: string;
  /** 大类名，导航一级。 */
  readonly label: string;
  /** 归属前缀（基础 / 通用 / 暂定）。 */
  readonly realm: string;
  /** 决定这页渲染什么、顶部统计怎么算。 */
  readonly kind: SectionKind;
  /** kind 为 component 时，收哪一档粒度。 */
  readonly layer?: Layer;
  readonly summary: string;
}

export const SECTIONS: readonly Section[] = [
  {
    slug: "color",
    label: "色彩",
    realm: "基础",
    kind: "color",
    summary: "T2 语义角色与 T1 原色阶，运行时从 :root 读出，非手写清单。",
  },
  {
    slug: "icon",
    label: "图标",
    realm: "基础",
    kind: "icon",
    summary:
      "全量图标，按用途分组。名字来自 iconDictionary，同时是 IconName 的类型来源。",
  },
  {
    slug: "type",
    label: "文字",
    realm: "基础",
    kind: "type",
    summary:
      "排版角色刻度。一个角色一次落齐字号、行高、字距、字重，跟随字号三档。",
  },
  {
    slug: "atom",
    label: "原子组件",
    realm: "基础",
    kind: "component",
    layer: "atom",
    summary: "一个控件、一个交互单元、没有子件 API。取值全部绑 T2。",
  },
  {
    slug: "pattern",
    label: "组合组件",
    realm: "通用",
    kind: "component",
    layer: "pattern",
    summary:
      "由多个部件或多个控件拼成。含上游的复合件与我们从产品重复里提炼的图案。",
  },
  {
    slug: "pending",
    label: "临时组件",
    realm: "暂定",
    kind: "component",
    layer: "pending",
    summary: "尚未重写，仍挂已退役的遗留类名——渲染无样式是预期结果。",
  },
];

export function sectionBySlug(slug: string): Section | undefined {
  return SECTIONS.find((s) => s.slug === slug);
}
