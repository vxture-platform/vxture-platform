/**
 * FieldTier.tsx - 表单字段的**分档**骨架。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * ## 为什么要分档
 *
 * 一个「接入 Provider」这样的表单有八九个字段，平铺成一长串时，读的人无从判断哪些
 * 是**必须想清楚的**、哪些是**填不填都行的**。结果是要么每一栏都停下来想一遍，要么
 * 一路 Tab 过去把该想的也跳了。分档回答的就是这一个问题：这一栏值不值得你停下来。
 *
 * ## 只有三档，而且不给第四档
 *
 * | 档 | 收什么 | 判据 |
 * | --- | --- | --- |
 * | `identity` | 决定「这条记录是什么」的字段 | 必填，且创建后多半改不了 |
 * | `details` | 影响展示与运营的字段 | 可选，改了不动身份 |
 * | `advanced` | 少用、易错、或有副作用的字段 | 默认折叠 |
 *
 * 档位写死在类型里而不是开放字符串：**档一多就退化成随手分组**，每个页面按自己的
 * 想法切三五段，跨页面之间又对不上——那正是分档要治的毛病。三档不够用，说明该拆成
 * 两个表单（或者一个表单加一次后续编辑），而不是加第四档。
 *
 * `advanced` **默认折叠**：它的存在本身是个信号——「这里的东西你多半不用碰」。默认
 * 展开就把这个信号抹掉了，还让前两档被挤到视线之外。
 */

"use client";

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";

export type FieldTierKind = "identity" | "details" | "advanced";

const TIER_LABEL: Record<FieldTierKind, string> = {
  identity: "身份",
  details: "常规",
  advanced: "高级",
};

export interface FieldTierProps {
  readonly tier: FieldTierKind;
  /** 覆盖档名。缺省用档位的标准名——**先考虑不覆盖**：跨页面同一档同一个词，才是分档的意义。 */
  readonly title?: React.ReactNode;
  /** 一句话说清这一档在这张表单里具体收了什么。 */
  readonly hint?: React.ReactNode;
  /** 缺省：`advanced` 折叠，其余展开。 */
  readonly defaultOpen?: boolean;
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function FieldTier({
  tier,
  title,
  hint,
  defaultOpen,
  children,
  className,
}: FieldTierProps) {
  const collapsible = tier === "advanced";
  const [open, setOpen] = React.useState(defaultOpen ?? tier !== "advanced");

  const header = (
    <div className="flex flex-col gap-2xs text-left">
      <span className="flex items-center gap-2xs text-label-md text-foreground">
        {collapsible ? (
          <Icon
            name={open ? "chevron-down" : "chevron-right"}
            size="sm"
            aria-hidden="true"
          />
        ) : null}
        {title ?? TIER_LABEL[tier]}
      </span>
      {hint ? (
        <span className="text-body-sm text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );

  return (
    <section className={cn("flex flex-col gap-md", className)}>
      {collapsible ? (
        /* `type="button"`：这一件基本只出现在 `<form>` 里，不写死类型的话点一下
           就是提交——一个展开动作把表单交了出去。 */
        <button
          type="button"
          className="w-full"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {header}
        </button>
      ) : (
        header
      )}
      {open ? <div className="flex flex-col gap-lg">{children}</div> : null}
    </section>
  );
}
