"use client";

/**
 * DetailForm.tsx — 详情页的表单排布件（板块缩进 + 字段行）。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * owner 2026-09-11 走查产品详情页后给的排布要求，这里是它们的实现：
 *
 *   · 字段一律**上下结构**：标签在上、控件在下。标签小字且淡——它是索引不是内容，
 *     和值抢同一个字号会让整页读起来像一张没有层次的表。
 *   · 说明文字**收进帮助图标**：此前每个字段下面挂一段 `FieldDescription`，十几个
 *     字段就是十几段散文，页面被说明淹没。说明仍然要有（那些判据是真的要读的），
 *     但默认收起，点图标才出来。
 *   · 两列之间的**横向间距要足够大**：原来第一列的控件几乎贴着第二列的标签，
 *     视线分不清哪个标签管哪个框。
 *   · 板块内容**与标题文字对齐**，不顶头。
 *
 * ── 缩进为什么不能写死像素 ──
 * DS 的 `SectionHeader` level 2 是「24px 图标 + `gap-lg`」。而 `gap-lg` 是
 * `--space-lg = --vx-spacing * 6`，**随密度变化**（紧凑模式下 `--vx-spacing` 更小）。
 * 写死一个像素级的左内边距，在切到紧凑密度时就会和标题错开。
 *
 * 所以这里用**结构**对齐：一个与图标同宽的占位列 + 同一个 `gap-lg`。密度一变，
 * 两边一起变。唯一的字面量是 `size-6`(24px)，它镜像 DS 里 level 2 的图标尺寸——
 * 那是个常量不是 token，改了 DS 这里要跟着改，所以写在注释里。
 */

import type { ReactNode } from "react";
import {
  Button,
  Icon,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@vxture/design-system";

/**
 * 板块内容区：与 `SectionHeader` 的标题文字左对齐。
 *
 * 占位列 `size-6` = level 2 的图标宽；`gap-lg` 与 header 里的同一个 token。
 * 窄屏（<md）不缩进——那点宽度经不起再让出 40px，且窄屏下图标与标题本来就挤在
 * 一起，对齐的参照系已经不明显。
 */
export function SectionBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-lg">
      <div aria-hidden className="hidden size-6 shrink-0 md:block" />
      <div className="flex min-w-0 flex-1 flex-col gap-lg">{children}</div>
    </div>
  );
}

/**
 * 两列字段栅格。
 *
 * `gap-x-2xl` 比常规的 `gap-md` 宽出一档，专治 owner 指出的那条：
 * 「第一个内容与第二个条目标题挨在一起」。纵向仍用 `gap-lg`——上下是同一列里的
 * 相邻字段，不需要横向那么大的分隔。
 */
export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-x-2xl gap-y-lg md:grid-cols-2">{children}</div>
  );
}

export interface FormFieldProps {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  /** 收进帮助图标的说明。不给就不出图标。 */
  readonly help?: ReactNode;
  /** 校验失败时的原因。给了就把标签与控件一起染红。 */
  readonly error?: string | undefined;
  /** 跨两列（长文本、开关组）。 */
  readonly full?: boolean;
  readonly children: ReactNode;
}

/**
 * 一个字段：标签行（小字 + 必填标记 + 帮助图标）+ 控件 + 错误。
 *
 * ── 错误为什么要染到控件上 ──
 * owner:「保存时提示缺少信息，对应的信息框应该高亮红色体现。不然找不到位置。」
 * 一条 toast 说「产品名必填」，而页面上有十几个框——运营者得自己一个个找。
 *
 * **`aria-invalid` 要挂在控件本身，不能挂在这个容器上。** DS 的 `invalid` 配方是
 * `aria-invalid:border-destructive` 这类**自身变体**——挂到外层 div 上，里面的
 * input 一点反应都没有。那份配方的注释正好写着它防的就是这件事：「不会出现
 * 『标了 aria 但没变红』」。
 *
 * 所以调用点要自己写 `aria-invalid={!!error}`。本件负责另外两半：标签转红、
 * 错误原因落在控件下面。漏写 `aria-invalid` 的字段仍会有红标签与红字，
 * 退化成「少一圈红边」而不是「什么都看不出来」。
 */
export function FormField({
  id,
  label,
  required,
  help,
  error,
  full,
  children,
}: FormFieldProps) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-xs${full ? " md:col-span-2" : ""}`}
    >
      <div className="flex items-center gap-2xs">
        <Label
          htmlFor={id}
          /* 小字且淡：标签是索引不是内容。 */
          className={`text-label-sm font-normal ${
            error ? "text-destructive-text" : "text-muted-foreground"
          }`}
        >
          {label}
        </Label>
        {required ? (
          <>
            <span
              aria-hidden="true"
              className="align-top text-label-sm text-destructive-text"
            >
              *
            </span>
            <span className="sr-only">（必填）</span>
          </>
        ) : null}
        {help ? (
          <Popover>
            <PopoverTrigger asChild>
              {/* 用 DS 的 Button 而不是裸 <button>:焦点环、悬停、禁用态都归件管,
                  自己写一套等于在这一个页面里开一个不受 DS 约束的分支。 */}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`${label}的说明`}
              >
                <Icon name="help" size="sm" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            {/* 说明常常是两三句带判据的话，`max-w-panel-sm` 给它一个可读的行宽，
                而不是让它铺成一条横贯全屏的细线。 */}
            <PopoverContent className="max-w-panel-sm text-body-sm">
              {help}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      {children}
      {error ? (
        <p className="text-body-sm text-destructive-text">{error}</p>
      ) : null}
    </div>
  );
}
