/**
 * list-empty-reason.ts —— 清单空了，是「本来就没有」还是「被筛掉了」。
 * @package @vxture/console
 *
 * ── 这一份存在的理由（2026-09-29，生产上被逮到）──
 * 工单页原先写的是：
 *
 *   const filtered = query.trim().length > 0 || filter !== "unresolved";
 *
 * 它想回答「这一页空是不是筛选造成的」，实际回答的是「用户动过筛选器没有」。
 * 两个问题只在一种情况下不同——**默认值本身就在筛**——而工单页的默认值
 * `unresolved` 正是在筛（已解决 / 已关闭 / 已取消都被它挡掉）。
 *
 * 后果在生产上是这样的：租户有一张单，处理完了停在「已解决」等客户确认。客户打开
 * 「我的工单」，上面的统计卡写着「待你确认 1 / 全部工单 1」，下面的表格却说
 * **「还没有提过工单」**——而且因为判成了「没筛」，给出的动作是「提交工单」而不是
 * 「重置筛选」。于是这一页同时做了两件坏事：告诉客户一句假话，然后把他推去
 * **再开一张重复的单**——而他那张单其实正等着他回一句话。
 *
 * ── 判据 ──
 * 比**全集**与**可见集**，不比控件和它的默认值。空态只在 `visible` 为 0 时才渲染，
 * 那一刻全集非空就说明是筛掉的，全集也空才是真的一张都没有。
 * 这个判据与「有几个筛选器、默认值是什么、以后加不加新筛选器」全都无关——
 * 这正是原来那行做不到的：它把一个具体的默认值 `"unresolved"` 焊死在了判据里。
 */

/** 空态的两种成因。名字比布尔值好：`filtered=false` 读起来像「没筛」，而不是「一张都没有」。 */
export type ListEmptyReason = "none" | "filtered";

/**
 * @param totalCount   未经任何筛选的全集条数
 * @param visibleCount 当前筛选 / 搜索之后剩下的条数
 *
 * 只有 `visible` 为 0 时这个答案才有意义（空态就是在那时渲染的）；`visible` 非 0
 * 时返回 `"none"`，调用方本来也不会去画空态。
 */
export function listEmptyReason(
  totalCount: number,
  visibleCount: number,
): ListEmptyReason {
  return visibleCount === 0 && totalCount > 0 ? "filtered" : "none";
}
