/**
 * brand.constants.ts — 官网品牌名的**单一权威**。
 * @package @vxture-platform/shared
 *
 * owner 2026-09-10 走查:页面标题已改「Ruyin Studio」,但**浏览器 tab 与
 * `<title>` 还是「vxture AI」**。根因是品牌名散在四处各写一份——
 * 两份 header 词条(zh/en)+ `layout.tsx` 的静态 metadata + `metadata.ts` 的
 * 双语标题。改了看得见的那两处,看不见的两处没人会想起来。
 *
 * tab 标题恰恰是**最不容易被自己发现**的一处:改站的人盯着页面看,
 * 而 tab 上那行字要切出去才看得到。
 *
 * 所以收成一处。词条里的 `logo.text` 仍各自保留(它可能因语言而不同的排版需要),
 * 但**值必须与这里一致**——`check-brand-name` 守卫比对二者。
 */

/** 品牌名(拉丁形,中英一致)。 */
export const BRAND_NAME = "Ruyin Studio";

/** 浏览器 tab / `<title>` 上的完整标题:品牌名 + 一句定位。 */
export const BRAND_TITLE: Record<"zh-CN" | "en-US", string> = {
  "zh-CN": `${BRAND_NAME} | 释放数据潜力`,
  "en-US": `${BRAND_NAME} | Unleash Data Potential`,
};
