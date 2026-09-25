"use client";

/**
 * SuspensionDetailDialog.tsx - 订阅被暂停时的详情弹窗（官网卡片）
 * @package @vxture/website
 * @layer Presentation
 *
 * owner 2026-09-26：「对租户来说『已暂停』不够友好，应该使用维护中/升级中这种，弹窗框为
 * 详情可倒计时」。
 *
 * 三条自律，都来自这条线上已经踩过的坑：
 *
 * ① **倒计时的终点必须是运营填的那个时间**（`expectedResumeAt`），不是最长暂停期算出来
 *    的。后者是内部处置阈值（到点平台原因强制恢复、客户违规终止），把它显示出去，客户会
 *    读成「最晚那天就好了」——平台从没这么说过。没填就只说已经停了多久。
 *
 * ② **过点之后不翻负数**，落回「已暂停 N 天」。估计错了是常事，界面不该把它演成一个承诺
 *    被违背的样子。
 *
 * ③ **不显示暂停原因**。值域里有「客户违规」，那是运营的判断；卡片上的状态字已经是由它
 *    在 BFF 侧映射出来的、对客户为真的说法。这里只补时间与「这些天还不还给你」。
 */

import { useEffect, useState } from "react";
import { Button, DialogForm } from "@vxture/design-system";
import { formatDateTime } from "@vxture-platform/shared";
import { COMPANY_CONTACT } from "@/data/company/contact.data";

export interface SuspensionDetailLabels {
  /** 弹窗标题 = 卡片上那个状态字（维护中 / 审核中 / 服务受限 / 已暂停）。 */
  title: string;
  /** 「服务暂时不可用…」，按顺不顺延选的那一句。 */
  hint: string;
  /** 「已暂停 {days} 天」 */
  since: string;
  /** 「预计 {time} 恢复」 */
  expected: string;
  /** 「距恢复还有 {remain}」 */
  countdown: string;
  /** 「联系支持」 */
  contact: string;
  /** 关闭 */
  close: string;
}

/** 整天数，向上取整到 1——停了两小时也算「已暂停 1 天」，与顺延的取整口径一致。 */
function daysSince(iso: string): number {
  const started = Date.parse(iso);
  if (!Number.isFinite(started)) return 0;
  return Math.max(1, Math.ceil((Date.now() - started) / 86_400_000));
}

/** 剩余时长，`dd天hh时mm分`；已过点或解析不出来返回 null（调用方落回「已暂停 N 天」）。 */
function remainingUntil(iso: string | null): string | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  const ms = target - Date.now();
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** 两段算式单独导出给 spec：弹窗本身是几个 div，会错而且不报错的是这两段。 */
export const __testables = { daysSince, remainingUntil };

export function SuspensionDetailDialog({
  open,
  onOpenChange,
  labels,
  suspendedSince,
  expectedResumeAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: SuspensionDetailLabels;
  suspendedSince: string | null;
  expectedResumeAt: string | null;
}) {
  /* 每分钟重算一次：倒计时显示到分钟，再密只是让页面忙。弹窗关着时不跑。 */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [open]);
  void tick;

  const remain = remainingUntil(expectedResumeAt);
  const expectedText =
    expectedResumeAt && remain
      ? /* 走 shared 的 formatDateTime（lint:datetime-discipline 要求，且它统一了兜底与
           短形态）。locale 传 undefined：这串是给**看它的人**的，按运行时区域格式化才对。 */
        formatDateTime(expectedResumeAt, undefined, "", {
          date: "long",
          time: "short",
        })
      : null;

  return (
    /* 预设要求用 DialogForm（统一的字段滚动区与页脚），哪怕这是个只读面板——
       ds/overlay-panel-preset 不许裸 DialogContent。提交就是关闭。 */
    <DialogForm
      open={open}
      size="sm"
      title={labels.title}
      description={labels.hint}
      submitLabel={labels.close}
      /* 取消键也只是关窗，所以两个键都用「关」的语义——把「联系支持」放在页脚会是个
         假动作（它不会联系任何人）。真正的联系入口是下面那个 mailto，它是条真链接。 */
      cancelLabel={labels.close}
      onOpenChange={onOpenChange}
      onSubmit={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
    >
      <dl className="grid gap-2 text-sm">
        {suspendedSince ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-vx-gray-500 dark:text-vx-gray-400">
              {labels.since.replace(
                "{days}",
                String(daysSince(suspendedSince)),
              )}
            </dt>
          </div>
        ) : null}
        {remain && expectedText ? (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-vx-gray-500 dark:text-vx-gray-400">
                {labels.expected.replace("{time}", expectedText)}
              </dt>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dd className="font-medium tabular-nums text-vx-gray-900 dark:text-vx-white">
                {labels.countdown.replace("{remain}", remain)}
              </dd>
            </div>
          </>
        ) : null}
      </dl>
      <Button asChild variant="outline" className="w-full">
        <a href={`mailto:${COMPANY_CONTACT.service_email}`}>{labels.contact}</a>
      </Button>
    </DialogForm>
  );
}
