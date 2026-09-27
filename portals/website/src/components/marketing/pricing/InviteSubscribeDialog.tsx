"use client";

/**
 * InviteSubscribeDialog — 邀请档的「邀请订阅」弹窗（/pricing 档位卡）。
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * owner 2026-09-28：邀请订阅是**套餐级**的（admin 按档设 is_public，运营给账号定向发
 * 邀请券），官网此前把它整个产品级地拦在门外——只要一个产品全是邀请档，定价页就只剩
 * 一块空态，档位、价格、权益全看不见。现在邀请档照常进阶梯，卡上的 CTA 是「邀请订阅」，
 * 点开这扇窗讲清三件事：这一档只接受邀请 / 已有邀请的登录 console 就能看到并下单 /
 * 还没有的向我们申请。
 *
 * 页脚两键各有各的事（与冻结 / 维护两扇窗同一裁定，DialogForm 的 cancel 只会关窗，
 * 不能挂动作）：主键「我已有邀请」在新标签页打开 console 的订阅深链（带这一档与当前
 * 展示的周期；邀请是定向发到账号上的，登录后那一档就在，不用输码）；次键关窗。
 * 「申请邀请」是正文里的一颗 outline 链接按钮——它自己就是落点（mailto 到销售邮箱，
 * 主题带产品与档名），放进页脚的 cancel 位就成了假动作。
 */

import { Button, DialogForm } from "@vxture/design-system";

export interface InviteSubscribeLabels {
  /** 「邀请订阅」 */
  title: string;
  /** 这一档只接受邀请 / 有邀请怎么用 / 没邀请怎么办。 */
  description: string;
  /** 「我已有邀请」（主键 → console 深链） */
  holder: string;
  /** 「申请邀请」（正文里的 mailto 链接按钮） */
  request: string;
  /** 关闭（次键） */
  close: string;
}

export function InviteSubscribeDialog({
  open,
  onOpenChange,
  labels,
  consoleHref,
  requestHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: InviteSubscribeLabels;
  /** console /subscribe 深链（product / intent / target_tier / cycle 都已带上）。 */
  consoleHref: string;
  /** mailto 链接（主题已按产品 + 档名填好）。 */
  requestHref: string;
}) {
  return (
    /* 预设要求用 DialogForm（统一的字段滚动区与页脚）——ds/overlay-panel-preset 不许
       裸 DialogContent。 */
    <DialogForm
      open={open}
      size="sm"
      title={labels.title}
      description={labels.description}
      submitLabel={labels.holder}
      cancelLabel={labels.close}
      onOpenChange={onOpenChange}
      onSubmit={(event) => {
        event.preventDefault();
        /* 新标签页打开 console：营销页不走掉（与档位卡上的订阅深链同一习惯）。 */
        window.open(consoleHref, "_blank", "noopener,noreferrer");
        onOpenChange(false);
      }}
    >
      <div>
        <Button asChild variant="outline">
          <a href={requestHref}>{labels.request}</a>
        </Button>
      </div>
    </DialogForm>
  );
}
