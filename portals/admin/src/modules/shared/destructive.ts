"use client";

/* destructive.ts — 破坏性确认的文案出口（admin）。
 *
 * 与 console 那份同形，只是翻译函数来自本门户的 `useConsoleTranslations` 而不是
 * next-intl 的 `useTranslations`。理由见 console 版头注：DS 的托底是英文且有意
 * 如此，四处文案必须由应用传。
 *
 * `titleTemplate` 过 i18n 不是讲究：语序与标点属于语言。中文「{verb}{target}？」
 * 无空格、全角问号；英文「{verb} {target}?」。DS 4.0 曾把中文语序写死在件里，
 * 英文下渲染成 `Deletemodel service？`。
 */

import type { DestructiveConfirm } from "@vxture/design-system";
import { useConsoleTranslations } from "@/lib/ConsoleIntl";

/**
 * 返回一个「给 confirm 补文案」的函数。
 *
 * 合并顺序钉死：调用方在后，可以覆盖任意一项（「保留」「暂不停用」这类反向措辞
 * 在某些动作上确实更准）。反过来写会让一个 `undefined` 悄悄盖掉托底。
 */
export function useConfirmLabels(): (
  confirm: DestructiveConfirm,
) => DestructiveConfirm {
  const t = useConsoleTranslations("destructive");
  return (confirm) => ({
    titleTemplate: t("titleTemplate"),
    cancelLabel: t("cancel"),
    pendingLabel: t("pending"),
    blockedHint: t("blocked"),
    ...confirm,
  });
}
