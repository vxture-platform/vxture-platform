/* destructive.ts — 破坏性确认的文案出口（opera）。
 *
 * ## 为什么要有这一层
 *
 * DS 9.0 起 `ConfirmDestructive` 的四处内建文案（标题拼法、取消钮、处理中态、
 * 前置条件未满足的悬停说明）**托底是英文**，而且那是有意的：托底的意义在于漏传
 * 时界面仍然可读，不是让人依赖它——英文默认值出现在生产界面上，说明有人忘了传。
 *
 * 所以每一处 `confirm` 都要传这四项。逐个调用点手写会有两个后果：同一个「取消」
 * 在不同页面长出不同写法（那正是 DS 收口这些文案要解决的问题），以及「哪些还没
 * 传」无从清点。收在这里之后，没走 `confirmLabels()` 的那几处就是漏网。
 *
 * ## 形状是可翻译的，即使 opera 现在还是单语
 *
 * opera 目前没有 i18n 基座（没有 `messages/`、没有 next-intl、1614 串中文写在
 * 代码里）。给这一个件单独接一套 i18n 会造出一座孤岛：三十个确认框可翻译，旁边
 * 一千六百串不可翻译。那不是双语，是双语的样子。
 *
 * 所以这里的做法是：**字典按 locale 分组、两种语言都真的写全**，取哪一份由
 * `resolveLocale()` 一处决定。今天它固定回 `zh-CN`；opera 接上 next-intl 之后，
 * 把那个函数换成读运行时 locale（或整体换成 `t()`）即可，**调用点一行不动**。
 *
 * 判据是：加一门语言要改几个地方。现在是一个——`DICT` 里加一组。
 */

import type { DestructiveConfirm } from "@vxture/design-system";

/** DS 收的四处文案出口。与 `DestructiveConfirm` 里同名字段一一对应。 */
export interface DestructiveLabels {
  readonly titleTemplate: string;
  readonly cancelLabel: string;
  readonly pendingLabel: string;
  readonly blockedHint: string;
}

/**
 * 两种语言都写全，不是占位。
 *
 * `titleTemplate` 的差别不只是词：中文是「{verb}{target}？」（无空格、全角问号），
 * 英文是「{verb} {target}?」。DS 4.0 曾把中文语序写死在件里，英文下渲染成
 * `Deletemodel service？`——语序与标点属于语言，不属于组件。
 */
const DICT: Record<string, DestructiveLabels> = {
  "zh-CN": {
    titleTemplate: "{verb}{target}？",
    cancelLabel: "取消",
    pendingLabel: "处理中…",
    blockedHint: "前置条件未满足，先处理上面标红的那几条。",
  },
  "en-US": {
    titleTemplate: "{verb} {target}?",
    cancelLabel: "Cancel",
    pendingLabel: "Working…",
    blockedHint:
      "Preconditions not met — resolve the items marked above first.",
  },
};

const FALLBACK_LOCALE = "zh-CN";

/**
 * 当前 locale。**这是全模块唯一需要改的地方。**
 *
 * opera 还没有 locale 来源（无 next-intl、无 cookie 约定），所以现在固定回中文。
 * 写成函数而不是常量，是为了让「接上 i18n」这件事有一个明确的、单一的落点——
 * 而不是到时候去三十个调用点里找。
 */
function resolveLocale(): string {
  return FALLBACK_LOCALE;
}

/** 当前语言下的四处文案。 */
export function destructiveLabels(): DestructiveLabels {
  return DICT[resolveLocale()] ?? DICT[FALLBACK_LOCALE]!;
}

/**
 * 给一份 `DestructiveConfirm` 补上当前语言的文案。
 *
 * 合并顺序钉死在这里：调用方在后，所以 `cancelLabel: "保留邀请"` 这类反向措辞
 * 覆盖得掉——那是产品判断，不该被这一层挡住。反过来写（调用方在前）会让一个
 * `undefined` 悄悄盖掉托底，而那种错读代码时看不出来。
 */
export function confirmLabels(confirm: DestructiveConfirm): DestructiveConfirm {
  return { ...destructiveLabels(), ...confirm };
}
