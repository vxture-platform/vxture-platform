"use client";

/**
 * useOrderPolling — 订单状态轮询(订阅单 / 加油包单 / 订单列表共用,批 1)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 只在 `active` 为真时跑:定时 + 回到标签页(focus / visibilitychange 且可见)立即
 * 拉一次;in-flight 去重由调用方的 `reload` 自己保证(它知道自己在不在飞)。
 * 此前加油包页的轮询 effect 依赖整个 order 对象,每轮 setOrder 都让 interval 被
 * 清掉重建;这里只依赖 `active` 与 `reload` 的引用。
 */

import { useEffect } from "react";

export function useOrderPolling(
  active: boolean,
  reload: () => void | Promise<void>,
  intervalMs = 15_000,
): void {
  useEffect(() => {
    if (!active) return;
    const tick = () => void reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    const timer = window.setInterval(tick, intervalMs);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, reload, intervalMs]);
}
