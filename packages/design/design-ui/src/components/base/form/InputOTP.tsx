/**
 * InputOTP.tsx - 一次性验证码输入（shadcn 惯例，底层 input-otp）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Form
 *
 * 结构承上游四件：InputOTP / Group / Slot / Separator。取值差异：
 * - 槽位尺寸绑控件刻度（h-control-md / w-control-md），跟随密度三档；
 *   上游的 size-9 裸数值不跟随。
 * - 假光标用 `animate-pulse`：上游的 caret-blink 是自定义 keyframes，
 *   DS 不为单个组件开全局 keyframes（060 判据），脉动表达"此处待输入"已够。
 * - 激活槽的高亮走 interactive 同款 ring 三件，与全体控件的焦点语言一致。
 */

"use client";

import * as React from "react";
import { OTPInput, OTPInputContext } from "input-otp";
import { cn } from "../../../utils/cn";
import { invalid } from "../../../styles/recipes";

export function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  readonly containerClassName?: string;
}) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn(
        "flex items-center gap-xs has-[:disabled]:opacity-disabled",
        containerClassName,
      )}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  );
}

export function InputOTPGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn("flex items-center", className)}
      {...props}
    />
  );
}

export interface InputOTPSlotProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly index: number;
}

export function InputOTPSlot({
  index,
  className,
  ...props
}: InputOTPSlotProps) {
  const inputOTPContext = React.useContext(OTPInputContext);
  const slot = inputOTPContext?.slots[index];

  return (
    <div
      data-slot="input-otp-slot"
      data-active={slot?.isActive}
      className={cn(
        "relative flex h-control-md w-control-md items-center justify-center",
        "border-y border-r border-input text-body-md text-foreground shadow-raised",
        "outline-none transition-all duration-fast ease-standard",
        "first:rounded-l-md first:border-l last:rounded-r-md",
        "data-[active=true]:z-10 data-[active=true]:border-ring",
        "data-[active=true]:ring-3 data-[active=true]:ring-ring/50",
        invalid,
        className,
      )}
      {...props}
    >
      {slot?.char}
      {slot?.hasFakeCaret ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="h-icon-sm w-px animate-pulse bg-foreground" />
        </div>
      ) : null}
    </div>
  );
}

/** 分组连接符（123-456 中间那一杠）。 */
export function InputOTPSeparator(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="separator"
      data-slot="input-otp-separator"
      className="px-2xs text-muted-foreground"
      {...props}
    >
      -
    </div>
  );
}
