/**
 * surfaces.ts - 营销页共用的整页背景
 *
 * 只有一条：上下渐变底。它原来写在 ComingSoonPage 里（`/workbench`、
 * `/industry-scenarios` 两页在用），owner 2026-09-24 要 `/contact` 也用同一款
 * （「现在背景是纯白色的。修正为渐变色，industry-scenarios 使用这个背景」）。
 *
 * 抽出来而不是抄一份：抄一份之后两边各自演进，而「两页背景应该一样」这件事没有任何
 * 东西会提醒你——它不会报错，只会某天看起来不一样。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-09-24
 */

/** 上下渐变底：亮色由品牌浅色收到卡面色，暗色走中性两档。 */
export const MARKETING_GRADIENT_SURFACE =
  "bg-linear-to-b from-vx-brand-100 to-vx-surface dark:from-vx-gray-800 dark:to-vx-gray-900";
