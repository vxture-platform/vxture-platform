/**
 * pending-recipes.mjs — 判定"手写了本该由配方层提供的片段"的模式。
 *
 * 曾经还带一份豁免清单（批 A 建立配方层时按当时现状实测生成），批 B–E 把 17 个
 * 组件逐个改造完后清空并删除。现在没有豁免。
 */

/**
 * 判定"手写了本该由配方提供的片段"的模式。
 *
 * 只认这三类：焦点环、禁用态压暗、校验失败态。它们在每个组件里都该长一个样，
 * 且写错了不报错。间距、颜色这类各组件本就该不同的，不在此列。
 */
export const RECIPE_PATTERNS = [
  ["focus-visible:ring", "interactive"],
  ["disabled:opacity", "interactive"],
  ["aria-invalid:", "invalid"],
];
