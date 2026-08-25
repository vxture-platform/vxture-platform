"use client";

/* destructive.ts — 破坏性确认的文案出口（accounts）。
 *
 * DS 9.0 起 `confirm` 的四处内建文案托底是英文，而且那是有意的托底：出了岔子时
 * 界面仍然可读，不是让人依赖它。所以每一处 `confirm` 都要传这四项，收在这里
 * 之后，没走 `useConfirmLabels()` 的那几处就是漏网。
 *
 * ## 这个文件曾经是个权宜之计
 *
 * 2026-08-25 建它时 accounts 还没有 i18n 基座，所以它是「字典按 locale 分组、
 * 中英都写全、`resolveLocale()` 一处决定取哪一组」。头注里当时写着合并条件：
 * **等 accounts 与 opera 都接上 next-intl，四份一起收成一个 hook。**
 *
 * 2026-08-26 两个都接上了。字典删掉，四项改从 `t("destructive.*")` 取。四个门户
 * 的这个文件现在**一模一样**——真正该做的合并（提到共享包）留到有第五个消费者
 * 时再说：三十行代码、四份复制，和为它新开一个带 React 依赖的包，前者更便宜。
 */

import type { DestructiveConfirm } from "@vxture/design-system";
import { useTranslations } from "next-intl";

/**
 * 返回一个「给 confirm 补文案」的函数。
 *
 * 合并顺序钉死：调用方在后，可以覆盖任意一项。反过来写会让一个 `undefined`
 * 悄悄盖掉托底，而那种错读代码时看不出来。
 */
export function useConfirmLabels(): (
  confirm: DestructiveConfirm,
) => DestructiveConfirm {
  const t = useTranslations("destructive");
  return (confirm) => ({
    titleTemplate: t("titleTemplate"),
    cancelLabel: t("cancel"),
    pendingLabel: t("pending"),
    blockedHint: t("blocked"),
    ...confirm,
  });
}
