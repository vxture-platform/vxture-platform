/**
 * signout-broadcast.ts —— 同源多标签页的登出广播。**不绑框架**（同 idle.ts）。
 *
 * ── 为什么需要它 ─────────────────────────────────────────────────────────
 * 登出销毁的是**服务端**的会话。已经打开的标签页不发请求就不知道这件事——它上面
 * 的界面仍是登录后的样子，仍能点、能填，直到某次请求撞上 401 或用户手动刷新。
 * 一个人在两个标签页开着同一个工作台，从其中一个登出，另一个还停在数据上，这既
 * 是安全问题（无人看管的终端上留着可读的内容），也是"到底登出没有"的困惑来源。
 *
 * 后端通道登出解决不了这一段：它是 IdP 到 RP 的服务端事件，浏览器里那些已经渲染
 * 好的页面收不到。跨门户（admin ↔ opera 不同源）的标签页也只能等下一次请求——
 * 那时 RP 会话已经被后端通道登出销毁，会如实 401。**本件只管同源这一段**，
 * localStorage 的 storage 事件本来就不跨源。
 *
 * ── 为什么不轮询 ─────────────────────────────────────────────────────────
 * 轮询会把会话养成不死（见 idle.ts 里 console 那个 2s 轮询的教训）：它按秒发请求，
 * 人在不在都发。广播是事件驱动的，登出发生时才有一次写入。
 */

/** 广播用的存储键。同门户同源必须一致，且**不能**与闲置钟的键相同。 */
export function signOutBroadcastKey(portal: string): string {
  return `vx:${portal}:signed-out-at`;
}

/**
 * 告诉同源的其他标签页：这份会话已经结束了。
 *
 * 写的是时间戳而不是固定值——`storage` 事件只在值**发生变化**时触发，写同一个值
 * 第二次登出就广播不出去了。
 */
export function broadcastSignOut(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, String(Date.now()));
  } catch {
    // 隐私模式 / 存储被禁：退化成"下一次请求时才发现"，与修此件之前同等。
  }
}

/**
 * 监听同源其他标签页的登出，返回停止函数。
 *
 * `storage` 事件**不会**在写入的那个标签页里触发，所以发起登出的页面不会收到自己
 * 的广播——它本来就正在跳转。
 */
export function onSignOutBroadcast(
  storageKey: string,
  onSignedOut: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: StorageEvent) => {
    if (event.key !== storageKey || !event.newValue) return;
    onSignedOut();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
