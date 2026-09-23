/**
 * plan-fingerprint.constants.ts —— 套餐版本组件指纹的**单一算法**。
 *
 * @package @vxture-platform/shared
 *
 * ── 它答的是什么 ──
 * 接入认证针对的是**待发布的草稿版本**，而草稿在发布前仍可改。所以认证时记一份组件
 * 指纹，发布门比对：对不上说明认过的那一版和正在发布的这一版已经不是同一个东西。
 *
 * 用指纹而不是「认证时间晚于最后修改时间」：后者会把「改了又改回来」判成失效，
 * 而那并没有改变任何权益形状。
 *
 * ── 为什么算法要收在这里，而不是两边各写一份 ──
 * 写入方是 opera-bff（认证时算并落库），读取方是 admin-bff（发布时重算并比对）。
 * 两份分叉的症状是**「明明刚认过却说指纹对不上」**——一个纯粹的假警报，而且两边
 * 各自看都「没错」，谁也不报错。这类「两处推导同一件事」的漂移，仓里已经栽过几次
 * （i18n 键、计量名、检查项归属），所以这一次从一开始就只留一处。
 *
 * ── 取哪几列 ──
 * 决定**权益形状**的那几列：产品、组件角色、档位、功能、配额。不取 id 与时间戳——
 * 那会让「同样的配置重建一次」也算改动，而认证关心的是形状变没变，不是行换没换。
 *
 * 次序固定按 (product_id, component_role)：`string_agg` 不带 ORDER BY 的话，同一份
 * 组件在两次查询里可能摊出不同的次序，指纹随机变化——那种缺陷只在多组件套餐上出现，
 * 而且时灵时不灵。
 *
 * 空组件（一条都没有）算 `sha256('')`，不是 NULL：一个没有组件的版本仍然是一个确定的
 * 形状，它和「读不到」是两件事。
 */

/**
 * 计算指纹的 SQL 片段。用法：把它放进 `SELECT … FROM product.plan_components pc
 * WHERE pc.plan_version_id = $n`，取 `fingerprint` 列。
 *
 * `sha256()` 是 PostgreSQL 11 起的内建函数，不依赖 pgcrypto；`encode(…, 'hex')`
 * 固定产出 64 个字符，正好是 `certification_runs.component_fingerprint` 的列宽。
 */
export const PLAN_COMPONENT_FINGERPRINT_SQL = `encode(sha256(convert_to(
  coalesce(string_agg(
    pc.product_id::text || '|' || pc.component_role || '|' ||
    coalesce(pc.tier, '') || '|' ||
    coalesce(pc.features::text, '{}') || '|' ||
    coalesce(pc.quota::text, '{}'),
    E'\\n' ORDER BY pc.product_id, pc.component_role), ''), 'UTF8')), 'hex')`;
