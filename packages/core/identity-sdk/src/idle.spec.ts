import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sharedActivityDomain, startIdleWatcher } from "./idle";

/**
 * 这份 spec 是 2026-08-24「登录 60 秒被踢」之后补的。闲置钟此前没有一条断言——
 * 它的两个缺陷（初始化读 localStorage 旧值、跨门户互相看不见活动）在"登出是本地
 * 的、静默 SSO 秒回"的年代天天触发也无人察觉，登出改成全局后当天现形。
 */

/** 可控的假浏览器：手动驱动 interval 回调，storage/cookie 都是内存里的。 */
function fakeBrowser(nowRef: { t: number }) {
  const storage = new Map<string, string>();
  let cookieJar = "";
  let tick: (() => void) | null = null;
  const win = {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
    },
    location: { hostname: "x.vxture.com", protocol: "https:" },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setInterval: (fn: () => void) => {
      tick = fn;
      return 1;
    },
    clearInterval: vi.fn(),
  };
  const doc = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    get cookie() {
      return cookieJar;
    },
    // 极简 cookie jar：只存 name=value，够断言用。
    set cookie(v: string) {
      const [pair] = v.split(";");
      if (!pair) return;
      const [name] = pair.split("=");
      const rest = cookieJar
        .split("; ")
        .filter((c) => c && !c.startsWith(`${name}=`));
      cookieJar = [...rest, pair.trim()].join("; ");
    },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  return {
    storage,
    setCookie: (pair: string) => {
      doc.cookie = pair;
    },
    fire: () => tick?.(),
    now: () => nowRef.t,
  };
}

const MIN = 60_000;

describe("sharedActivityDomain", () => {
  it("取末两段，让 admin / opera 互见", () => {
    expect(sharedActivityDomain("x.vxture.com")).toBe("vxture.com");
    expect(sharedActivityDomain("y.vxture.com")).toBe("vxture.com");
  });

  it("localhost / IP / 单段名没有可共享的父域", () => {
    expect(sharedActivityDomain("localhost")).toBeNull();
    expect(sharedActivityDomain("127.0.0.1")).toBeNull();
    expect(sharedActivityDomain("intranet")).toBeNull();
  });
});

describe("startIdleWatcher", () => {
  const nowRef = { t: 0 };
  beforeEach(() => {
    nowRef.t = 10 * 60 * 60_000; // 上午十点，任意
  });
  afterEach(() => vi.unstubAllGlobals());

  it("localStorage 里的旧值不算数 —— 刚加载的页面以现在起算", () => {
    // 缺陷原型：上一轮使用留下的时间戳（几小时前）被当作 lastActivity，
    // 刚登录的人 15 秒后的第一次检查就被判"已闲置 30 分钟"。
    const b = fakeBrowser(nowRef);
    b.storage.set("vx:opera:last-activity", String(nowRef.t - 5 * 60 * MIN));
    const onIdle = vi.fn();
    startIdleWatcher({
      idleMs: 30 * MIN,
      onIdle,
      storageKey: "vx:opera:last-activity",
      now: () => nowRef.t,
    });
    nowRef.t += 15_000; // 第一次检查
    b.fire();
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("到达即广播：启动时就把现在写进 storage 与共享 cookie", () => {
    const b = fakeBrowser(nowRef);
    startIdleWatcher({
      idleMs: 30 * MIN,
      onIdle: vi.fn(),
      storageKey: "vx:opera:last-activity",
      sharedActivityCookie: "vx_wf_activity",
      now: () => nowRef.t,
    });
    expect(b.storage.get("vx:opera:last-activity")).toBe(String(nowRef.t));
    expect(document.cookie).toContain(`vx_wf_activity=${nowRef.t}`);
  });

  it("另一个工作台的活动挡住开火 —— 共享 cookie 更新则不闲", () => {
    // 缺陷原型：人在 opera 干活，后台 admin 标签页 30 分钟没动就全局登出。
    const b = fakeBrowser(nowRef);
    const onIdle = vi.fn();
    startIdleWatcher({
      idleMs: 30 * MIN,
      onIdle,
      storageKey: "vx:admin:last-activity",
      sharedActivityCookie: "vx_wf_activity",
      now: () => nowRef.t,
    });
    nowRef.t += 31 * MIN; // 本门户 31 分钟没动
    b.setCookie(`vx_wf_activity=${nowRef.t - 2 * MIN}`); // 但另一个工作台 2 分钟前有活动
    b.fire();
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("两个工作台都闲够了才开火", () => {
    const b = fakeBrowser(nowRef);
    const onIdle = vi.fn();
    startIdleWatcher({
      idleMs: 30 * MIN,
      onIdle,
      storageKey: "vx:admin:last-activity",
      sharedActivityCookie: "vx_wf_activity",
      now: () => nowRef.t,
    });
    b.setCookie(`vx_wf_activity=${nowRef.t}`);
    nowRef.t += 31 * MIN; // 双方都 31 分钟没动（cookie 停在启动时刻）
    b.fire();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("不传 sharedActivityCookie 时行为不变（customer 面不共享）", () => {
    const b = fakeBrowser(nowRef);
    const onIdle = vi.fn();
    startIdleWatcher({
      idleMs: 30 * MIN,
      onIdle,
      storageKey: "vx:console:last-activity",
      now: () => nowRef.t,
    });
    nowRef.t += 31 * MIN;
    b.setCookie(`vx_wf_activity=${nowRef.t}`); // 有 cookie 也不看
    b.fire();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
