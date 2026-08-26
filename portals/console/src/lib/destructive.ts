"use client";

/* destructive.ts — 破坏性确认的文案出口（console）。
 *
 * DS 9.0 起 `ConfirmDestructive` 的四处内建文案托底是英文，而且那是有意的：托底
 * 的意义在于漏传时界面仍然可读，不是让人依赖它——英文默认值出现在生产界面上，
 * 说明有人忘了传。所以每一处 `confirm` 都要传这四项。
 *
 * ## 与 opera 那份的差别，以及为什么不合并
 *
 * console 有真的 i18n 基座（next-intl + 运行时 locale 切换），所以这里直接接
 * `t()`，是个 **hook**；opera 没有基座，那份是按 locale 分组的常量表加一个
 * `resolveLocale()`。两处形状不同**是因为语言来源不同，不是因为没统一**——把
 * opera 那份强行做成 hook 只会造出一个永远返回同一份字典的假 hook。
 *
 * 合并要等 opera 接上 i18n；那时两处都变成"读 t()"，才是同一件事。
 *
 * ## `titleTemplate` 为什么必须过 i18n
 *
 * 语序和标点属于语言：中文是「{verb}{target}？」（无空格、全角问号），英文是
 * 「{verb} {target}?」。DS 4.0 曾把中文语序写死在件里，英文下渲染成
 * `Deletemodel service？`。这一格不是文案，是语法。
 */

import { useTranslations } from "next-intl";
import type { DestructiveConfirm } from "@vxture/design-system";

/**
 * 返回一个「给 confirm 补文案」的函数。
 *
 * 合并顺序钉死：调用方在后，所以 `cancelLabel: t("keepInvitation")` 这类反向措辞
 * 覆盖得掉——那是产品判断。反过来写会让一个 `undefined` 悄悄盖掉托底。
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
