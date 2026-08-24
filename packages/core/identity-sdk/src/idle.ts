/**
 * idle.ts —— 客户端闲置钟。**不绑框架**（同 presence.ts 的理由）。
 *
 * ── 为什么在客户端 ───────────────────────────────────────────────────────
 * "人还在不在"只有浏览器知道。服务端能看到的都是代理指标：IdP 看得到换票频率，
 * BFF 看得到请求频率——**两者都不是在场**。一个人读长表格、填长表单、对着屏幕
 * 想事情，全程在工作却一个请求都不发（2026-08-07 定稿，见 workplans §二十三）。
 *
 * ── 什么算活动 ───────────────────────────────────────────────────────────
 * 只认**人做出来的**事件：按键、指针按下、滚轮、触摸、窗口重新获得焦点。
 *
 * **定时器与轮询一律不算。** 它们按秒发，人在不在都发，认了就等于把会话养成不死
 * ——这正是 console 那个 2s 轮询造成的毛病。本件自己也用定时器，但那是用来**检查
 * 是否已闲置**，它只会让会话结束，永远不会让会话延长。这两件事必须分清。
 *
 * ── 已知边界（有意接受）─────────────────────────────────────────────────
 * 切到别的标签页/别的应用期间收不到交互，因此会被判闲置——哪怕人一直坐在电脑前。
 * 这不是缺陷：**任何应用都无法区分"人去开会了"和"人走了"**，而闲置超时防的正是
 * 无人看管的终端（NIST 800-63B §7.2 的 unattended terminal）。AWS / Azure /
 * Salesforce 同口径。切回来的那一刻（focus）立刻算活动，29 分 59 秒回来不掉。
 *
 * ── 跨标签页 ─────────────────────────────────────────────────────────────
 * 同源多个标签页共用一份会话 cookie，任何一个被判闲置都会把其余的一起带走。所以
 * 活动时间戳经 `localStorage` 广播：在 B 标签页干活，A 标签页不会自己超时。
 *
 * ── 跨门户（workforce）─────────────────────────────────────────────────
 * 登出改成全局后（2026-08-24），"带走其余的"不再限于同源：admin 的闲置钟开火，
 * opera 一起下线。而 localStorage 是同源的，admin 看不见人在 opera 的活动。
 * 所以活动时间戳还写一份到父域 cookie（`sharedActivityCookie`，运行时从
 * hostname 推导 Domain），两个工作台在判定边缘互查——任一工作台有活动，全体不闲。
 */

/** 人做出来的事件。滚动不在内——惯性滚动与程序滚动都会触发，不是可靠的在场信号。 */
const HUMAN_EVENTS = ["keydown", "pointerdown", "wheel", "touchstart"] as const;

/** 检查节拍。比阈值小得多即可，精度不重要——它决定的是"最晚多久发现已闲置"。 */
const CHECK_INTERVAL_MS = 15_000;

/** 写回 localStorage 的节流。每次按键都写盘没必要，10 秒的误差无所谓。 */
const PERSIST_THROTTLE_MS = 10_000;

export interface IdleWatcherOptions {
  /** 闲置阈值。运营面 30 分钟，C 端 4 小时（2026-08-07 owner 定）。 */
  readonly idleMs: number;
  /**
   * 判定闲置后调用。**实现方应当直接登出，不要弹窗询问。**
   *
   * "要不要继续"是消费级网银来的 UX 惯例，不是安全要求——NIST 800-63B 通篇没有
   * 要求过它，而对正在操作的人定期弹窗打断是荒谬的（owner 判）。
   */
  readonly onIdle: () => void;
  /** 跨标签页共享活动时间戳的键。同门户同源必须一致。 */
  readonly storageKey: string;
  /**
   * 跨**门户**共享活动时间戳的 cookie 名（写在父域上，运行时从 hostname 推导）。
   *
   * localStorage 是同源的：admin 标签页看不见人在 opera 的活动。自登出改成全局
   * （end_session + 后端通道）后，这个盲区从无害变成致命——后台开着的 admin
   * 标签页 30 分钟没动就触发登出，把正在 opera 干活的人一起带走。两个工作台共用
   * 同一个中央会话，"闲置"就必须按同一个人算：任一工作台有活动，全体不闲。
   *
   * admin / opera 传同一个名字（如 `vx_wf_activity`）；customer 面暂不传——
   * console/website 与工作台不同 realm，共享会把两个 realm 的时钟绑在一起。
   */
  readonly sharedActivityCookie?: string;
  /** 测试注入。 */
  readonly now?: () => number;
}

/**
 * 启动闲置钟，返回停止函数。
 *
 * 只在浏览器里有意义；服务端渲染时返回一个空的停止函数，调用方不必自己判断环境。
 */
export function startIdleWatcher(options: IdleWatcherOptions): () => void {
  const { idleMs, onIdle, storageKey, sharedActivityCookie } = options;
  const now = options.now ?? (() => Date.now());

  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  /**
   * 以**现在**起算，不读 localStorage 的旧值。
   *
   * 原先是 `readPersisted(storageKey) ?? now()`：localStorage 里躺着上一轮使用的
   * 时间戳（它不随会话结束消失），刚登录、页面刚加载，闲置钟一启动就读到几小时前
   * 的值——15 秒后的第一次检查即判"已闲置 30 分钟"，人刚进门就被请出去。
   * 导航到本页这件事**本身就是人的动作**（而且刚穿过认证门），理应作数。
   * 旧值的用途只剩运行期的跨标签页同步，那由 onStorage 单向"只取更新"承担。
   *
   * 这个缺陷一直存在，但从前登出是本地的、静默 SSO 秒回，误触发不可见；
   * 登出改成全局后（2026-08-24），它成了"登录 60 秒被踢"。
   */
  let lastActivity = now();
  let lastPersisted = 0;
  let stopped = false;

  const persist = (at: number) => {
    try {
      window.localStorage.setItem(storageKey, String(at));
    } catch {
      // 隐私模式 / 存储被禁：跨标签页共享退化，本标签页的计时不受影响。
    }
    if (sharedActivityCookie) {
      writeSharedActivity(sharedActivityCookie, at, idleMs);
    }
  };

  const markActive = () => {
    if (stopped) return;
    const at = now();
    lastActivity = at;
    // 节流写回：让别的标签页看得到，但不必每次按键都落盘。
    if (at - lastPersisted >= PERSIST_THROTTLE_MS) {
      lastPersisted = at;
      persist(at);
    }
  };

  // 到达即活动，且立即广播——别让同门户的其他标签页、或另一个工作台的闲置钟，
  // 在"人刚登进来"的窗口里开火。
  persist(lastActivity);
  lastPersisted = lastActivity;

  // 别的标签页有人在干活 → 本标签页跟着延后。只接受比本地更新的时间戳，
  // 避免旧值把已经前进的计时拉回去。
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey || !event.newValue) return;
    const at = Number(event.newValue);
    if (Number.isFinite(at) && at > lastActivity) lastActivity = at;
  };

  // 切回本页算活动——人回来了。切走不算，也不重置。
  const onVisibility = () => {
    if (document.visibilityState === "visible") markActive();
  };

  for (const type of HUMAN_EVENTS) {
    window.addEventListener(type, markActive, { passive: true });
  }
  window.addEventListener("focus", markActive);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("storage", onStorage);

  const timer = window.setInterval(() => {
    if (stopped) return;
    // 开火前看一眼共享 cookie：另一个工作台的活动也算"人在"。只在判定边缘才读
    // （每 15s 一次），不进热路径。
    if (sharedActivityCookie) {
      const shared = readSharedActivity(sharedActivityCookie);
      if (shared !== null && shared > lastActivity) lastActivity = shared;
    }
    if (now() - lastActivity >= idleMs) {
      stopped = true;
      onIdle();
    }
  }, CHECK_INTERVAL_MS);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    for (const type of HUMAN_EVENTS) {
      window.removeEventListener(type, markActive);
    }
    window.removeEventListener("focus", markActive);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * 共享活动 cookie 的域：从 hostname 取末两段（opera.vxture.com → vxture.com），
 * 让 admin / opera 互见。localhost / IP（本地开发）没有可共享的父域——返回 null，
 * cookie 落在本 host 上，跨门户共享退化为同源，与 localStorage 等价，不多不少。
 *
 * 平台只在 vxture.com 一个可注册域下运营，末两段即父域；这里**不是**通用的
 * PSL 求解（co.uk 之类不在本平台的世界里）。
 */
export function sharedActivityDomain(hostname: string): string | null {
  if (
    hostname === "localhost" ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    !hostname.includes(".")
  ) {
    return null;
  }
  return hostname.split(".").slice(-2).join(".");
}

function writeSharedActivity(name: string, at: number, idleMs: number): void {
  const domain = sharedActivityDomain(window.location.hostname);
  // Max-Age 盖过闲置窗即可：过期自然消失，别当长期状态留着。
  const maxAge = Math.ceil(idleMs / 1000) + 60;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  try {
    document.cookie =
      `${name}=${at}; Path=/; SameSite=Lax; Max-Age=${maxAge}` +
      (domain ? `; Domain=${domain}` : "") +
      secure;
  } catch {
    // 写不进（罕见）：跨门户共享退化，本标签页计时不受影响。
  }
}

function readSharedActivity(name: string): number | null {
  try {
    const m = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${name}=(\\d+)(?:;|$)`),
    );
    if (!m?.[1]) return null;
    const at = Number(m[1]);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/**
 * 各 realm 的闲置阈值（2026-08-07 owner 定，见 workplans §二十三）。
 *
 * 两个值都严于 NIST 800-63B AAL2 的建议上限（闲置 ≤ 1 小时）——运营面更严是因为
 * 它是高权限面；C 端放宽到 4 小时是因为客户自助场景里频繁重登的代价远大于收益。
 */
export const IDLE_MS = {
  /** 运营面：admin / opera。 */
  workforce: 30 * 60_000,
  /** 客户面：console / website。 */
  customer: 4 * 60 * 60_000,
} as const;
