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
import { DialogForm } from "@vxture/design-system";
import { formatDateTime } from "@vxture-platform/shared";
import { useRouter } from "@/lib/i18n/navigation";
import { daysSince, remainingUntil } from "./suspension-detail.logic";

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
  const router = useRouter();
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
      /*
       * 页脚两个键各有各的事（2026-09-26 走查修）：主键去「联系我们」，次键关窗。
       *
       * 上一版为了躲开「cancelLabel 不带动作 ⇒ 写『联系支持』是假动作」这个坑，把两个键
       * 都设成了关闭语义——结果页脚成了两个一模一样的「知道了」。躲开一个坑掉进另一个：
       * 重复控件同样是没想清楚。正解是让主键担起那件唯一值得做的事。
       */
      submitLabel={labels.contact}
      cancelLabel={labels.close}
      onOpenChange={onOpenChange}
      onSubmit={(event) => {
        event.preventDefault();
        /* 统一跳「联系我们」，不开 mailto（owner 2026-09-26）：那一页把电话、邮箱、表单
           都摆在一起，而 mailto 在没配邮件客户端的机器上什么都不会发生——又是个假动作。
           走 i18n 的 Link 路由（同站内部跳转），不用 window.location 整页刷。 */
        router.push("/contact");
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
    </DialogForm>
  );
}
