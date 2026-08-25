/* destructive.ts — 破坏性确认的文案出口（accounts）。
 *
 * 与 `portals/opera/src/lib/destructive.ts` 同形，理由完整写在那一份的头注里，
 * 不在这里重复：要点是 DS 9.0 起 `confirm` 的四处内建文案托底是英文、且那是
 * 有意的托底而非产品语言，所以每个调用点都得传，收在一处才清点得出漏网的。
 *
 * ## 为什么是复制而不是共用
 *
 * 共用要有个放得下的地方。`@vxture-platform/shared` 是 BFF 也在吃的非 React 包，
 * 把 `DestructiveConfirm`（来自 DS）搬进去等于给服务端包挂上设计系统依赖，
 * 代价比这三十行大得多。accounts 与 opera 的差别也不只是字典：接上 i18n 之后
 * 两边的 locale 来源不会是同一个。
 *
 * 合并的条件写在这里，省得以后靠猜：**等 accounts 与 opera 都接上 next-intl**，
 * 这两份都会退化成 admin/console 那样的十行 `t()` 包装，那时候该做的是四份一起
 * 收成一份 hook，而不是现在把两份半成品先粘起来。
 */

import type { DestructiveConfirm } from "@vxture/design-system";

export interface DestructiveLabels {
  readonly titleTemplate: string;
  readonly cancelLabel: string;
  readonly pendingLabel: string;
  readonly blockedHint: string;
}

/**
 * 两种语言都写全，不是占位。
 *
 * `titleTemplate` 的差别不只是词：中文「{verb}{target}？」无空格、全角问号，
 * 英文「{verb} {target}?」有空格、半角。语序与标点属于语言，不属于组件。
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
 * accounts 还没有 locale 来源（无 next-intl、无 cookie 约定），所以现在固定回
 * 中文。写成函数而不是常量，是为了让「接上 i18n」有一个明确的单点。
 */
function resolveLocale(): string {
  return FALLBACK_LOCALE;
}

export function destructiveLabels(): DestructiveLabels {
  return DICT[resolveLocale()] ?? DICT[FALLBACK_LOCALE]!;
}

/**
 * 给一份 `DestructiveConfirm` 补上当前语言的文案。
 *
 * 合并顺序钉死：调用方在后，可以反向覆盖任意一项（那是产品判断，不该被这
 * 一层挡住）。反过来写会让一个 `undefined` 悄悄盖掉托底，而那种错读代码时
 * 看不出来。
 */
export function confirmLabels(confirm: DestructiveConfirm): DestructiveConfirm {
  return { ...destructiveLabels(), ...confirm };
}
