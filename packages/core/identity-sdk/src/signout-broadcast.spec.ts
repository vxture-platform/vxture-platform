import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  broadcastSignOut,
  onSignOutBroadcast,
  signOutBroadcastKey,
} from "./signout-broadcast";

/** 只记录写入，够用来断言"写进去的是什么"。 */
function stubStorage() {
  const writes: Array<[string, string]> = [];
  vi.stubGlobal("window", {
    localStorage: {
      setItem: (k: string, v: string) => {
        writes.push([k, v]);
      },
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return writes;
}

describe("signOutBroadcastKey", () => {
  it("按门户分键 —— 两个门户不同源，本来也共享不了", () => {
    expect(signOutBroadcastKey("opera")).not.toBe(signOutBroadcastKey("admin"));
  });

  it("不与闲置钟的键相撞", () => {
    // 闲置钟用的是 `vx:<portal>:last-activity`。撞了的话，登出广播会被当成
    // "别的标签页有人在干活"，把会话反向续命。
    expect(signOutBroadcastKey("opera")).not.toBe("vx:opera:last-activity");
  });
});

describe("broadcastSignOut", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("写到自己的键上", () => {
    const writes = stubStorage();
    const key = signOutBroadcastKey("opera");
    broadcastSignOut(key);
    expect(writes).toEqual([[key, expect.any(String)]]);
  });

  it("连续两次广播写出的值不同 —— 否则第二次登出传不出去", () => {
    // storage 事件只在值**发生变化**时触发。断言"看起来像时间戳"是不够的：
    // 固定值 "1" 同样能通过那种断言，而它正是这里要挡住的写法。要断言的是
    // 性质本身——**变了**。
    const writes = stubStorage();
    const key = signOutBroadcastKey("opera");
    let t = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => (t += 1000));
    broadcastSignOut(key);
    broadcastSignOut(key);
    vi.restoreAllMocks();
    expect(writes).toHaveLength(2);
    expect(writes[1]![1]).not.toBe(writes[0]![1]);
  });

  it("存储被禁时静默退化，不抛", () => {
    // 隐私模式下 setItem 会抛。登出本身必须照走完。
    vi.stubGlobal("window", {
      localStorage: {
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(() => broadcastSignOut("k")).not.toThrow();
  });

  it("服务端渲染时是空操作", () => {
    vi.stubGlobal("window", undefined);
    expect(() => broadcastSignOut("k")).not.toThrow();
  });
});

describe("onSignOutBroadcast", () => {
  let handler: ((e: StorageEvent) => void) | null = null;

  beforeEach(() => {
    handler = null;
    vi.stubGlobal("window", {
      addEventListener: (type: string, fn: (e: StorageEvent) => void) => {
        if (type === "storage") handler = fn;
      },
      removeEventListener: vi.fn(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("只对自己的键作出反应", () => {
    const onSignedOut = vi.fn();
    onSignOutBroadcast("vx:opera:signed-out-at", onSignedOut);
    handler!({ key: "vx:opera:last-activity", newValue: "1" } as StorageEvent);
    expect(onSignedOut).not.toHaveBeenCalled();
    handler!({ key: "vx:opera:signed-out-at", newValue: "1" } as StorageEvent);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("忽略清空（newValue 为 null）", () => {
    // localStorage.clear() 会发一个 newValue=null 的事件。那不是登出。
    const onSignedOut = vi.fn();
    onSignOutBroadcast("vx:opera:signed-out-at", onSignedOut);
    handler!({
      key: "vx:opera:signed-out-at",
      newValue: null,
    } as StorageEvent);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("服务端渲染时返回一个可安全调用的停止函数", () => {
    vi.stubGlobal("window", undefined);
    expect(() => onSignOutBroadcast("k", () => {})()).not.toThrow();
  });
});
