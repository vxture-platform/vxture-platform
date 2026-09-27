"use client";

/**
 * MaintenanceDetailDialog.tsx - 产品「升级维护中」的详情弹窗（官网目录卡 / 产品详情 hero）
 * @package @vxture/website
 * @layer Presentation
 *
 * owner 2026-09-28：「应该点击按钮，弹窗说明和倒计时框，使用 DS 验证码输入框类似的大字号
 * 倒计时框。」此前按钮位置先是两行状态字（owner 判「变态」），再改成留空——留空等于把
 * 「什么时候回来」藏起来。现在卡上是一颗「升级维护中」按钮，开这扇窗；窗里说清三件事：
 * 暂不可订 / 已订阅的这段时间怎么算 / 预计几点回来，加一个走秒的倒计时。
 *
 * ## 倒计时框：DS 的 InputOTP 三件，一格一位
 *
 * InputOTP / InputOTPGroup / InputOTPSlot 组成 HH : MM : SS 六格。方格从 InputOTP 的
 * 上下文读 `value` 的每一位——所以这里**不手画六个框**：DS 改了验证码框的描边 / 圆角 /
 * 阴影，这里跟着变。方格只改三个尺度（高 / 宽 / 字号），DS 的 `cn` 会把默认档换掉，
 * 其余全部继承。分隔符不用 DS 的 InputOTPSeparator（它写死一条横杠「-」，时钟该是冒号）。
 *
 * 它只是**显示**，不是输入，所以底层那颗 `<input>` 给 `type="hidden"`：
 *   · 不可聚焦。DialogForm 开窗时把焦点交给第一个可用字段（选择器排除 hidden 与
 *     disabled）；用 `readOnly` 它仍会被聚焦，一格亮起激活环、像在等人输入。
 *   · 不走 `disabled`：DS 容器对 `:has(:disabled)` 做半透明，倒计时会被调暗。
 *   · 表单提交也不带它（没有 name）。
 * 六格整体 aria-hidden，读屏读旁边那句 sr-only 的整话「距恢复还有 …」。
 *
 * ## 与订阅冻结弹窗（SuspensionDetailDialog）相同的三条自律
 *
 * 终点是运营填的**估计**（不是平台承诺）；过点不翻负数（改说「恢复时间已到，正在收尾」）；
 * 不显示维护原因。走秒也照它的办法：开着才跑，关了清掉；首帧（挂载前）方格画横杠，
 * 服务端与客户端首次渲染一致。
 *
 * 页脚同样两个键各有各的事：主键去「联系我们」，次键关窗——DialogForm 的页脚固定两键，
 * 两个都写「知道了」是重复控件（2026-09-26 走查已踩过一次）。
 */

import { useEffect, useState } from "react";
import {
  DialogForm,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  useMounted,
} from "@vxture/design-system";
import { formatDateTime } from "@vxture-platform/shared";
import { useRouter } from "@/lib/i18n/navigation";
import { maintenanceCountdown } from "./maintenance-detail.logic";

export interface MaintenanceDetailLabels {
  /** 「升级维护中」——与卡上那颗按钮同一个词。 */
  title: string;
  /** 「产品正在升级维护，暂不可订阅。」——对所有人。 */
  visitor: string;
  /** 「已订阅的服务暂停期间不计入有效期，恢复后自动顺延。」——只给已订阅的看。 */
  subscriber: string;
  /** 「预计 {time} 恢复」（原串） */
  expected: string;
  /** 「距恢复还有」——六格上方那一行。 */
  countdown: string;
  /** 「距恢复还有 {remain}」（原串）——读屏用的一句整话。 */
  countdownReadable: string;
  /** 「{d} 天」（原串）——超过一天时写在六格前面。 */
  days: string;
  /** 「恢复时间已到，正在收尾」——过点之后替换六格。 */
  elapsed: string;
  /** 「联系支持」 */
  contact: string;
  /** 关闭 */
  close: string;
}

/** 挂载前六格里画的东西：一格一条横杠。 */
const PLACEHOLDER_DIGITS = "------";

/* 方格只动尺度：高 / 宽 / 字号 / 字重 / 等宽数字。描边、圆角、阴影、颜色全是 DS 的。 */
const slotClass = "h-14 w-11 text-3xl font-semibold tabular-nums";
const separatorClass =
  "px-1 text-2xl font-semibold text-vx-gray-400 dark:text-vx-gray-500";

export function MaintenanceDetailDialog({
  open,
  onOpenChange,
  labels,
  until,
  subscribed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: MaintenanceDetailLabels;
  /** 运营填的预计恢复时间（ISO）。 */
  until: string;
  /** 看这扇窗的人是否订阅了这个产品：决定要不要说「暂停期间不计入有效期」那一句。 */
  subscribed: boolean;
}) {
  const router = useRouter();
  const mounted = useMounted();
  /* 每秒重算一次：倒计时显示到秒。弹窗关着时不跑。 */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [open]);
  void tick;

  const state = mounted ? maintenanceCountdown(until, Date.now()) : null;
  const invalid = state?.kind === "invalid";
  const running = state?.kind === "running" ? state : null;
  /* 走 shared 的 formatDateTime（lint:datetime-discipline 要求）。locale 传 undefined：
     这串是给看它的人的，按运行时区域格式化才对——弹窗只在点开后才渲染，没有
     hydration 对不上的问题（目录卡那行灰字曾经有，见 maintenanceUntilText）。 */
  const expectedText = invalid
    ? ""
    : formatDateTime(until, undefined, "", { date: "long", time: "short" });
  const digits = running
    ? `${running.hours}${running.minutes}${running.seconds}`
    : PLACEHOLDER_DIGITS;
  const daysText =
    running && running.days > 0
      ? labels.days.replace("{d}", String(running.days))
      : null;
  const readable = running
    ? labels.countdownReadable.replace(
        "{remain}",
        [daysText, `${running.hours}:${running.minutes}:${running.seconds}`]
          .filter(Boolean)
          .join(" "),
      )
    : null;

  return (
    /* 预设要求用 DialogForm（统一的字段滚动区与页脚），哪怕这是个只读面板——
       ds/overlay-panel-preset 不许裸 DialogContent。 */
    <DialogForm
      open={open}
      size="sm"
      title={labels.title}
      description={labels.visitor}
      submitLabel={labels.contact}
      cancelLabel={labels.close}
      onOpenChange={onOpenChange}
      onSubmit={(event) => {
        event.preventDefault();
        /* 统一跳「联系我们」，不开 mailto（owner 2026-09-26，与冻结弹窗同一裁定）。 */
        router.push("/contact");
      }}
    >
      <div className="grid gap-4 text-sm">
        {subscribed ? (
          <p className="text-vx-gray-600 dark:text-vx-gray-300">
            {labels.subscriber}
          </p>
        ) : null}
        {expectedText ? (
          <p className="text-vx-gray-500 dark:text-vx-gray-400">
            {labels.expected.replace("{time}", expectedText)}
          </p>
        ) : null}
        {invalid ? null : state?.kind === "elapsed" ? (
          <p className="font-medium text-vx-gray-900 dark:text-vx-white">
            {labels.elapsed}
          </p>
        ) : (
          <div className="grid justify-items-center gap-3 py-2">
            <p className="text-vx-gray-500 dark:text-vx-gray-400">
              {labels.countdown}
            </p>
            {readable ? <p className="sr-only">{readable}</p> : null}
            <div
              aria-hidden
              className="flex flex-wrap items-center justify-center gap-3"
            >
              {daysText ? (
                <span className="text-2xl font-semibold tabular-nums text-vx-gray-900 dark:text-vx-white">
                  {daysText}
                </span>
              ) : null}
              <InputOTP
                type="hidden"
                readOnly
                value={digits}
                maxLength={PLACEHOLDER_DIGITS.length}
                autoComplete="off"
                pushPasswordManagerStrategy="none"
                containerClassName="justify-center"
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} className={slotClass} />
                  <InputOTPSlot index={1} className={slotClass} />
                </InputOTPGroup>
                <span className={separatorClass}>:</span>
                <InputOTPGroup>
                  <InputOTPSlot index={2} className={slotClass} />
                  <InputOTPSlot index={3} className={slotClass} />
                </InputOTPGroup>
                <span className={separatorClass}>:</span>
                <InputOTPGroup>
                  <InputOTPSlot index={4} className={slotClass} />
                  <InputOTPSlot index={5} className={slotClass} />
                </InputOTPGroup>
              </InputOTP>
            </div>
          </div>
        )}
      </div>
    </DialogForm>
  );
}
