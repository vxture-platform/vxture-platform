/**
 * cn.ts - 类名合并工具
 * @package @vxture/design-ui
 *
 * clsx 拼接 + tailwind-merge 去冲突。**tailwind-merge 必须按本仓的 T2 命名重新配置**
 * ——它认错组的后果是静默丢类，没有任何报错。
 *
 * @copyright Vxture Team
 * @layer Shared
 * @category Utils
 */

import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** T2 排版角色族。`text-<族>-<档>` 产出的是字号，不是颜色。 */
const TYPE_FAMILIES = [
  "display",
  "heading",
  "title",
  "body",
  "label",
  "code",
] as const;

/**
 * `text-` 前缀在 Tailwind 里同时承载**字号**和**文字颜色**两组，tailwind-merge
 * 靠内置刻度表把二者分开。我们的 T2 角色名不在那张表里，于是它把
 * `text-label-sm`（字号）和 `text-primary-foreground`（颜色）判成同一组，
 * 后写的挤掉先写的——**类名直接从 DOM 上消失**。
 *
 * 实测症状：Button 基础类里有 `text-primary-foreground`、`xs` 尺寸变体里有
 * `text-label-sm`，合并后蓝底按钮的文字变成深灰，而且只有这一档如此——
 * 其余档没写字号覆盖，所以没触发。
 *
 * 显式登记后：`text-<六族>-*` 与 `text-overline` 归字号组，其余 `text-*` 仍按颜色处理。
 */
/** 角色档位不做穷举：新增一档不必回来改这里。 */
const anyStep = () => true;

/**
 * T2 描边宽度档。`border-t-medium` 是宽度不是颜色——tailwind-merge 不认识
 * `medium` 这个档，会把它判进 border-**color** 组，于是 `border-t-medium` 与
 * `border-t-info-border` 互相顶替，后写的把前写的从 DOM 上挤掉。
 * 实测症状：MetricCard 顶缘色条 2px 静默变 1px（浏览器实测抓到，同 vx-type 一案）。
 */
const BORDER_WIDTH_STEPS = ["thin", "medium", "thick"] as const;

/** 逐侧登记进内置的 border-w* 组，让宽度档只和宽度互斥、不再碰颜色组。 */
const borderWidthGroups = Object.fromEntries(
  (
    [
      ["border-w", "border"],
      ["border-w-t", "border-t"],
      ["border-w-r", "border-r"],
      ["border-w-b", "border-b"],
      ["border-w-l", "border-l"],
      ["border-w-x", "border-x"],
      ["border-w-y", "border-y"],
    ] as const
  ).map(([group, prefix]) => [group, [{ [prefix]: [...BORDER_WIDTH_STEPS] }]]),
);

/**
 * T2 间距档。`p-xl` / `pt-none` / `gap-control-md` 的档名不在 tailwind-merge 的
 * 内置刻度表里，padding / margin / gap 这些组根本认不出它们——
 * `cn("p-xl pt-none", "p-xl")` 三条类全部原样保留，冲突交给 CSS 声明顺序裁决。
 * 实测症状：CardContent 基类的 `pt-none` 压过调用方后写的 `p-xl`，指标卡顶部
 * 内边距静默归零（2026-08-03 opera 对照 admin 抓到，与 vx-type / border-width 同族）。
 * 档名走文法谓词而非穷举：spacing 新增档位不必回来改这里。
 *
 * ⚠ `--spacing-*` 命名空间不止"内边距档"：Tailwind v4 里 `size-*` / `w-*` /
 * `h-*` 也从这里取值，所以 `icon-* / media-* / header-* / sidebar-*` 四族必须
 * 一并登记。漏登记的症状同样是静默的——2026-08-04 实测：`Avatar` 基类的
 * `size-media-xs`(32px) 与调用方传入的 `size-media-sm`(48px) **两条同时留在
 * DOM 上**，谁生效由生成 CSS 的先后顺序决定，于是面板里的大头像永远是 32px，
 * 传什么都不动。判据：凡 T2 有 `--spacing-<族>-<档>` 的族，这里都要认。
 */
const isSpacingStep = (value: string) =>
  /^(none|2xs|xs|sm|md|lg|[2-6]?xl|(row|control|icon|media|header|sidebar)-[a-z0-9-]+)$/.test(
    value,
  );

/**
 * T2 `--container-*` 下的语义族。与上面同一类病，只是换了个命名空间：`w-*` /
 * `min-w-*` / `max-w-*` 在 v4 里按 `--width|--min-width|--max-width → --spacing
 * → --container` 依次取值，而 tailwind-merge 的内置刻度表里没有 `panel-*` /
 * `overlay-*` 这些档名，于是同组两条类一起留在 DOM 上，谁生效由生成 CSS 的先后
 * 顺序决定——调用方传的那条未必赢。
 *
 * 实测（2026-08-07）：
 *   `max-w-panel-sm` + `max-w-panel-lg` → 两条都在（**本来就漏，不是这次引入的**）
 *   `min-w-overlay-xs` + `min-w-overlay-md` → 两条都在，于是给
 *   `DropdownMenuContent` 传 `className="min-w-overlay-md"` 覆盖不掉默认档
 *
 * 判据同上一条，只是把"`--spacing-<族>`"扩到"T2 里带族名的档，无论它落在哪个
 * 命名空间"。新增 `--container-<族>-<档>` 记得回来加进这条正则。
 */
const isContainerStep = (value: string) =>
  /^(panel|overlay)-(2xs|xs|sm|md|lg|[2-6]?xl)$/.test(value);

const twMergeConfigured = extendTailwindMerge<"vx-type">({
  extend: {
    theme: {
      // Tailwind v4 的 --spacing-* 供 p/m/gap/inset 等所有间距组共用，
      // 在 theme 层登记一次即可全组生效。
      spacing: [isSpacingStep],
      // 同理，--container-* 供 w / min-w / max-w 三组共用。
      container: [isContainerStep],
    },
    classGroups: {
      // 自成一组，与内置 `text-color` 互不相干，故二者可以共存。
      // ⚠ 必须用 Record 形式逐段声明；`"label-*"` 这种通配串在 v3 不匹配，
      //   写了不报错，只是所有角色继续落回 text-color——症状与没配一模一样。
      "vx-type": [
        {
          text: [
            ...TYPE_FAMILIES.map((family) => ({ [family]: [anyStep] })),
            "overline",
          ],
        },
      ],
      ...borderWidthGroups,
    },
    // 与内置字号组互斥：`text-sm` 和 `text-label-lg` 说的是同一件事，
    // 两条都留下等于让 CSS 顺序决定，那不叫合并。
    conflictingClassGroups: {
      "vx-type": ["font-size"],
      "font-size": ["vx-type"],
    },
  },
});

/**
 * 类名合并工具函数。
 *
 * @param inputs - 类名列表，支持字符串、对象、数组等多种格式
 * @returns 合并后的类名字符串
 * @example
 * ```tsx
 * cn('btn', { 'btn-primary': isPrimary }, ['px-md', 'py-sm'])
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMergeConfigured(clsx(inputs));
}
