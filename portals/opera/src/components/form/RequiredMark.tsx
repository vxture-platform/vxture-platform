/**
 * RequiredMark.tsx — 必填标记。
 * @package @vxture/opera
 * @layer Presentation
 * @category Components - Form
 *
 * owner 2026-09-11:「同时标记必填信息条目」。
 *
 * ── 为什么不用一个裸的红星 ──
 * 红星是个约定俗成但**只对看得见的人成立**的符号：读屏把 `*` 读成「星号」，
 * 或者干脆跳过（很多实现把纯标点当装饰）。所以这里给的是
 * `aria-hidden` 的视觉标记 + 一段只读给读屏的文字。
 *
 * ── 颜色 ──
 * 用 `destructive-text` 而不是自造红：必填与危险共用同一根语义色轴，这样主题
 * 切换与对比度校准只有一处。它不表示"危险"，表示"这里不给就过不去"——
 * 在本系统里这两件事恰好同色，但同色是**结果**不是理由。
 *
 * ── 用法 ──
 * 放在 `FieldLabel` 内部、文字之后：
 *   <FieldLabel htmlFor="x">产品码<RequiredMark /></FieldLabel>
 * 不要放在 label 之外——那样读屏念完标签才念到"必填"，中间隔着控件。
 */

export function RequiredMark() {
  return (
    <>
      <span
        aria-hidden="true"
        className="ml-3xs align-top text-label-sm text-destructive-text"
      >
        *
      </span>
      <span className="sr-only">（必填）</span>
    </>
  );
}
