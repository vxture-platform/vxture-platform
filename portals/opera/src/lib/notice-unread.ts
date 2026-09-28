"use client";

/**
 * notice-unread.ts — 「未读数变了」这件事的唯一通知点。
 * @package @vxture/opera
 * @layer Presentation
 *
 * 外壳上的铃铛角标与 `/ops/notices` 那一页是两棵互不相邻的树（页面是外壳的
 * children，但角标在 header 里，两者没有共同的业主组件）。页面上按了「知道了」
 * 或「全部标记已读」之后，角标**必须当场变**——它是按钮效果的唯一可见证据；
 * 只靠轮询的话，那一下按完角标还挂着原来的数，读作「按钮没生效」，而人会再按
 * 一次、再一次。
 *
 * 所以这里是个极小的订阅点，不是状态库：值仍然由各自去 BFF 取（那一份才是权威），
 * 这里只负责说一句「去重取」。
 *
 * 事件名不用 DOM 自定义事件：那样两处得各写一遍同一个字符串，写错一个字母就再也
 * 不响，而且不报错。
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * 通告的已读状态变了（标记已读 / 全部标记已读 / 发布 / 撤回）。
 *
 * 发布与撤回也算：它们改的是「有多少条在那儿」，角标跟着动。
 */
export function notifyNoticesChanged(): void {
  for (const listener of [...listeners]) listener();
}

/** 订阅，返回退订函数（给 `useEffect` 的清理用）。 */
export function subscribeNoticesChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
