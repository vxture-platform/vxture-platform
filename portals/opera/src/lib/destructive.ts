"use client";

/* destructive.ts — 破坏性确认的文案出口（opera）。
 *
 * DS 9.0 起 `confirm` 的四处内建文案（标题拼法、取消钮、处理中态、前置条件未
 * 满足的悬停说明）**托底是英文**，而且那是有意的托底：出了岔子时界面仍然可读，
 * 不是让人依赖它。所以每一处 `confirm` 都要传这四项，收在这里之后，没走
 * `useConfirmLabels()` 的那几处就是漏网。
 *
 * ## 这个文件曾经是个权宜之计，现在不是了
 *
 * 2026-08-25 建这个文件时 opera 还没有 i18n 基座，所以它是「字典按 locale 分组、
 * 中英都真的写全、`resolveLocale()` 一处决定取哪一组」——今天固定回中文，等接上
 * i18n 再换。头注里当时写着合并条件：**等 opera 接上 next-intl**。
 *
 * 2026-08-26 接上了。字典删掉，四项改从 `t("destructive.*")` 取，与 admin / console
 * 那两份同形。加一门语言现在要改的地方是 `messages/`，不是这个文件。
 *
 * `titleTemplate` 也过 i18n 不是讲究：中文「{verb}{target}？」无空格、全角问号，
 * 英文「{verb} {target}?」有空格、半角。语序与标点属于语言，不属于组件。
 * （DS 4.0 曾把中文语序写死在件里，英文下渲染成 `Deletemodel service？`。）
 */

import type { DestructiveConfirm } from "@vxture/design-system";
import { useTranslations } from "next-intl";

/**
 * 返回一个「给 confirm 补文案」的函数。
 *
 * 合并顺序钉死：调用方在后，可以覆盖任意一项（`cancelLabel: "保留邀请"` 这类
 * 反向覆盖是产品判断，不该被这一层挡住）。反过来写会让一个 `undefined` 悄悄
 * 盖掉托底，而那种错读代码时看不出来。
 */
export function useConfirmLabels(): (
  confirm: DestructiveConfirm,
) => DestructiveConfirm {
  const t = useTranslations("destructive");
  return (confirm) => ({
    /* `t.raw` 而不是 `t`：这一条的值是「{verb}{target}？」，占位符要留给 DS 去填。
       `t()` 会当场把它当 ICU 串求值，而 `verb`/`target` 此刻还不存在，于是抛
       `FORMATTING_ERROR` 并回落——确认框的标题就渲染成 `destructive.titleTemplate`
       这一串键路径。这个缺陷两道门禁一个都抓不到（类型对、词条也对），是把栈
       跑起来点开一个删除确认框才看见的。 */
    titleTemplate: t.raw("titleTemplate") as string,
    cancelLabel: t("cancel"),
    pendingLabel: t("pending"),
    blockedHint: t("blocked"),
    ...confirm,
  });
}
