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

import { useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import {
  Button,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
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
 * 横向用 `gap-x-7xl`（默认密度 **128px**，紧凑 96px）——DS 12.6.0 为此新加的
 * 「栏间沟」档。此前用 `2xl`(40px) 时第一栏的输入框看起来贴着第二栏的标签，
 * owner 两次走查都点了这一条。
 *
 * **不要改用写死像素的 arbitrary 值**：那会绕过密度轴，紧凑模式下不跟着收窄，
 * 而那正是密度存在的意义；`ds/no-app-tailwind-arbitrary-scale` 也会拦。
 *
 * 纵向仍用 `gap-lg`——上下是同一列里的相邻字段，不需要横向那么大的分隔。
 */
export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-x-7xl gap-y-lg md:grid-cols-2">{children}</div>
  );
}

/**
 * 帮助提示：鼠标移上去就出、移开就收。
 *
 * owner 2026-09-11:「信息是鼠标 hover 弹出，移开关闭，不能让点击才显示」。要点一下
 * 才出来的说明，读者得先知道「这里有东西可点」——而一个淡色小图标恰恰不提示可点。
 *
 * 触发器仍是 `<button>`：Tooltip 在键盘上靠 focus 触发，非可聚焦元素等于只给鼠标
 * 用户。`TooltipProvider` 挂在 `OperaShell` 上，这里直接用。
 *
 * 图标**与标签同色**（owner：颜色太重了）——它是标签的附属物，不该比标签本身显眼。
 */
export function HelpHint({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={`${label}的说明`}
        className="inline-flex shrink-0 items-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name="help" size="sm" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent className="max-w-panel-sm">{children}</TooltipContent>
    </Tooltip>
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
  /**
   * 这一格里装的是**一组**控件（如「预览 + 上传 + 移除」），不是单个控件。
   *
   * `<label htmlFor>` 只能指向一个控件；一组控件该用 `role="group"` +
   * `aria-labelledby`。给了这个之后 `id` 变成**标签自己的** id，调用点不必
   * （也不该）再把同一个 id 挂到里面某个控件上。
   */
  readonly group?: boolean;
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
  group,
  children,
}: FormFieldProps) {
  /* 小字且淡：标签是索引不是内容。 */
  const labelClass = `text-label-sm font-normal ${
    error ? "text-destructive-text" : "text-muted-foreground"
  }`;

  return (
    <div
      className={`flex min-w-0 flex-col gap-xs${full ? " md:col-span-2" : ""}`}
    >
      {/* **定高**。此前带帮助图标的行比不带的高一截,两栏并排时标签与控件逐行
          错开(owner 2026-09-11:「label 行高没有统一,有帮助图标的高了一些,导致
          排版错位」)。`h-control-xs` 是 DS 的控件高度档,比图标高、比标签行高——
          把行高从「内容决定」改成「档位决定」,有没有图标都一样。 */}
      <div className="flex h-control-xs items-center gap-2xs">
        {group ? (
          /* 组的标签不是 `<label>`：它不指向单个控件，而是被下面那层
             `aria-labelledby` 引用。用 `<label>` 且不给 htmlFor 会变成一个
             指不到任何东西的标签——比没有更糟。 */
          <span id={id} className={labelClass}>
            {label}
          </span>
        ) : (
          <Label htmlFor={id} className={labelClass}>
            {label}
          </Label>
        )}
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
        {help ? <HelpHint label={label}>{help}</HelpHint> : null}
      </div>
      {group ? (
        <div role="group" aria-labelledby={id}>
          {children}
        </div>
      ) : (
        children
      )}
      {error ? (
        <p className="text-body-sm text-destructive-text">{error}</p>
      ) : null}
    </div>
  );
}

export interface ToggleRowProps {
  readonly id: string;
  readonly label: string;
  readonly help?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: boolean) => void;
}

/**
 * 一行开关：标签在左、开关在右，同一行。
 *
 * owner 2026-09-11:「两个版面：label：内容选择，同行；现在都是选择，样式需要一致。」
 * 此前「可见性」两项与「端」四项虽然都是开关，却长得不一样——前者是裸开关配一个
 * 上方标签，后者是带边框的方块。**同一种交互出现两种外观，读者会以为它们是两回事。**
 *
 * 帮助图标与 `FormField` 用同一个：hover 出、移开收，颜色与标签同色。
 */
export function ToggleRow({
  id,
  label,
  help,
  checked,
  disabled,
  onChange,
}: ToggleRowProps) {
  return (
    <div className="flex h-control-md items-center justify-between gap-sm rounded-md border border-border px-sm">
      <span className="flex min-w-0 items-center gap-2xs">
        <Label htmlFor={id} className="truncate text-body-sm font-normal">
          {label}
        </Label>
        {help ? <HelpHint label={label}>{help}</HelpHint> : null}
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

/**
 * 带复制按钮的输入框。
 *
 * owner 2026-09-11:「给输入框末尾留复制按钮，方便拷贝」。域名、上游、回调、
 * client_id 这类值的用途就是**被粘到别处**——粘进工单、粘进对方的配置、粘进
 * 一封交接邮件。让人手动划选一个等宽长串是这一页最高频的摩擦。
 *
 * 用 `InputGroup` 而不是在框旁边摆个按钮：聚焦环要圈住两者，手写 `absolute`
 * 会压住输入文字的末尾（同 `LockedInput` 的判断）。
 *
 * 反馈用按钮自身的短暂态而不是 toast：复制是个微动作，弹一条全局提示太重，
 * 而且连点几个字段会刷出一串。
 */
export function CopyableInput({
  value,
  ...props
}: ComponentProps<typeof InputGroupInput> & { readonly value: string }) {
  const [copied, setCopied] = useState(false);
  const canCopy = value.trim() !== "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板可能被浏览器策略挡掉（非安全上下文、权限被拒）。失败就什么都不做——
         值本来就在框里看得见，用户仍然可以手动选。弹一条"复制失败"只是噪音。 */
    }
  }

  return (
    <InputGroup>
      <InputGroupInput {...props} value={value} />
      {canCopy ? (
        <InputGroupAddon align="end">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={copied ? "已复制" : "复制"}
            onClick={() => void copy()}
          >
            <Icon
              name={copied ? "check" : "copy"}
              size="sm"
              aria-hidden="true"
              className={copied ? "text-success-text" : "text-muted-foreground"}
            />
          </Button>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}
