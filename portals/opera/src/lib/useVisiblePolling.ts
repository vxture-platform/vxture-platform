"use client";

/**
 * useVisiblePolling — 只在页面可见时轮询：**隐藏即停、回前台补取、卸载即清**。
 * @package @vxture/opera
 * @layer Presentation
 *
 * ## 它替换掉了什么
 *
 * 服务状态与任务调度两页此前各写了一份**一模一样**的轮询，而两份都有同一个缺陷：
 *
 * ```ts
 * const timer = setInterval(() => {
 *   if (document.visibilityState === "visible") void reload({ silent: true });
 * }, 30_000);
 * ```
 *
 * 它判了可见性，但判法是**定时器照跳、只跳过请求**。页面在后台挂一小时，计时器仍然
 * 醒 120 次——每一次都要唤醒主线程、跑一遍闭包、再决定什么都不做。省下的只是网络，
 * 没省下调度；而且回到前台时还得等最长一个完整周期才看到新数据，在此之前屏幕上是
 * 一份最多 30 秒前的旧值，看起来却像是刚刷新的。
 *
 * 这里要的是**真停**：`clearInterval`，回前台重新起并**立即补一次**。
 *
 * ## 为什么抽出来而不是各页各写
 *
 * 设计文件 §7.3 按数据性质规定了频次（存活探测 30s、累计计数器 60s、窗口聚合手动、
 * 明细流不轮询、真实上游调用仅手动）。这张表若靠每页各写一份 `setInterval` 迟早分叉
 * ——现在两页已经是同一段代码抄了两遍，而两遍都错在同一处。收敛之后页面只声明频次，
 * "隐藏怎么办、回来怎么办"由这里统一回答。
 *
 * ## 不做的事
 *
 * **不管首次加载。** 进页面取第一次是页面自己的事：那一次通常要显示 loading，而轮询
 * 是静默的。把两件事塞进一个 hook，调用方就得多传一个"第一次要不要 silent"的参数，
 * 而那个参数只会有一个取值。
 */

import { useEffect, useRef } from "react";

/**
 * @param tick 每次轮询要做的事。**可以是每次渲染都变的新函数**——内部用 ref 持有，
 *   不会因为它变了就重启计时器（那会导致高频渲染的页面永远轮询不到）。
 * @param intervalMs 频次。按设计文件 §7.3 的数据性质选，不要随手填。
 * @param enabled 置 false 时完全不轮询（例如读取失败后不该继续打上游）。缺省 true。
 */
export function useVisiblePolling(
  tick: () => void,
  intervalMs: number,
  enabled = true,
): void {
  const tickRef = useRef(tick);
  /* 在 effect 里赋值而不是在渲染体里：**渲染期写 ref 是 React 明令不做的事**——并发
     渲染下这次渲染可能被丢弃，而 ref 的写入不会跟着回滚，于是计时器会拿着一个从未
     真正提交过的闭包去跑。每次提交后无条件更新（不给依赖数组），保证拿到的永远是最新
     的那个函数。 */
  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      stop();
      timer = setInterval(() => tickRef.current(), intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        /* 先补一次再起表：不补的话，回到前台看到的是最长一个周期之前的旧值，
           而它在屏幕上与刚取回的新值长得一模一样。 */
        tickRef.current();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    /* tick 有意不在依赖里——它每次渲染都是新引用，进依赖会让计时器不停重启，
       在一个每秒渲染几次的页面上等于永远轮询不到。 */
  }, [intervalMs, enabled]);
}
