"use client";

/* ConfirmDestructiveDialog — 破坏性动作的确认关。
 *
 * ## 为什么存在
 *
 * DS 目前给的是**两个互不相关的开关**：`ActionMenuItem.danger` 把菜单项染红，
 * `DialogFormProps.danger` 把提交按钮染红。两个都只管颜色，没有一个管"拦不拦"。
 * 于是「红」和「拦」是两个独立决定，而写页面的人只被提醒了前一个。
 *
 * 2026-08-25 全仓普查：29 个 `danger: true` 的菜单项里，14 个 `onSelect` 直接就把
 * 事做了。其中不可逆的六条有四条在 console——删除账单地址、取消订单、取消加油包
 * 订单、撤销邀请，全是对客面，点错的代价直接落到客户身上。
 *
 * **红色而不设防比不染红更危险**：红色让人以为系统知道这件事很重，于是手更松。
 *
 * ## 为什么是 DialogForm 而不是 AlertDialog
 *
 * 两个原语各缺一半：`AlertDialog` 有确认语义但 `AlertDialogAction` 没有任何
 * variant，要红只能自己写 class（禁自造样式）；`DialogForm` 有 `danger` 但没人
 * 规定它必须用来确认。`DialogForm danger` 是唯一一个**两样都现成**的组合，也是
 * admin 与 opera 已经在用的那一个——console 自己也有三处在用。
 *
 * ## 它要求什么
 *
 * `consequence` 是**必填**，这是这个件的全部意义。写确认框的成本从来不在弹窗，
 * 在于说清"点下去之后会发生什么、能不能撤"。做成必填参数，那句话就从"谁记得谁写"
 * 变成"不写就编译不过"。
 *
 * ## 归宿
 *
 * 这件该住在 DS 里（它没有任何业务含义），届时 admin/opera 那些手写的
 * `DialogForm danger` 确认一并收敛，并加一条 guardrail：`danger: true` 而没有确认
 * 就报错。在 DS 收走之前，它先住在 console。
 */

import { DialogForm } from "@vxture/design-system";

export interface ConfirmDestructiveDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 要做的是什么，带上对象名——「取消订单 VX-2026-0001」好过「确认取消」。 */
  readonly title: string;
  /**
   * **点下去之后会发生什么、能不能撤。** 必填。
   *
   * 不是"确定吗？"——那句话不携带任何信息，读的人只能凭原本就有的印象再点一次。
   */
  readonly consequence: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
}

export function ConfirmDestructiveDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
}: ConfirmDestructiveDialogProps) {
  return (
    <DialogForm
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      danger
      title={title}
      description={consequence}
      submitLabel={confirmLabel}
      cancelLabel={cancelLabel}
      submitting={busy}
      onSubmit={(event) => {
        /* 破坏性动作一律走这里：阻止表单默认提交，由调用方自己决定何时关。
           关得太早会让"正在撤销"这段时间无处显示，用户以为没生效于是再点一次。 */
        event.preventDefault();
        onConfirm();
      }}
    />
  );
}
