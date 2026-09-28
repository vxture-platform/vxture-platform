import { afterEach, describe, expect, it } from "vitest";
import { subscribeNoticesChanged } from "@/lib/notice-unread";
import {
  canMarkNoticeRead,
  markReadBlocker,
  openNotice,
  type ClickThroughNotice,
} from "./click-through";

/**
 * 「点进去就算已读」的三条不变式（见 `click-through.ts` 文件头）。
 *
 * 这几条**肉眼看不出后果**，所以必须在这里钉住：
 *   · 次序（先标后跳）写错的话，屏幕上一切正常——只是跳走后那一段已经卸载，标记
 *     那一下根本没发出去，而角标一直挂着原来的数。
 *   · 「标失败不拦跳转」写错的话，只有在接口刚好出错的那一次才现形，而那一次运营者
 *     看到的是「点了不动」。
 *   · 「已读的不再标」写错的话，多发一次幂等请求，没有任何可见后果——直到有人按
 *     请求数算账。
 */

const unread: ClickThroughNotice = {
  id: "n-1",
  link: "/orders/OD-1",
  readAt: null,
};

const alreadyRead: ClickThroughNotice = {
  ...unread,
  readAt: "2026-09-28T02:00:00.000Z",
};

const offPlane: ClickThroughNotice = { ...unread, onThisPlane: false };

const withoutLink: ClickThroughNotice = { ...unread, link: null };

/** 订阅点是模块级单例，用例自己退订，免得一个用例的监听者数到下一个用例头上。 */
let stopWatching: (() => void) | null = null;

afterEach(() => {
  stopWatching?.();
  stopWatching = null;
});

/** 把「角标被通知去重取」也记进同一条时间线，好判它落在跳转之前还是之后。 */
function watchBadge(calls: string[]): void {
  stopWatching = subscribeNoticesChanged(() => {
    calls.push("badge");
  });
}

/** 让挂着的微任务跑完：标记是异步的，跳转不等它。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("点进一条通告", () => {
  it("先把标记发出去，再跳——跳走之后这一段就卸载了，放在后面等于不做", async () => {
    const calls: string[] = [];

    openNotice(unread, {
      markRead: (noticeId) => {
        calls.push(`mark:${noticeId}`);
      },
      navigate: (link) => {
        calls.push(`go:${link}`);
      },
    });

    expect(calls).toEqual(["mark:n-1", "go:/orders/OD-1"]);
    await flush();
  });

  it("标不上也照跳，并且照样请角标去重读真数", async () => {
    const calls: string[] = [];
    watchBadge(calls);

    openNotice(unread, {
      markRead: () => Promise.reject(new Error("409 已经读过了")),
      navigate: (link) => {
        calls.push(`go:${link}`);
      },
    });

    // 跳转不等标记回来：这一下是运营者按的，标已读只是它的附带结果。
    expect(calls).toEqual(["go:/orders/OD-1"]);

    await flush();
    expect(calls).toEqual(["go:/orders/OD-1", "badge"]);
  });

  it("标记同步抛出也照跳", async () => {
    const calls: string[] = [];

    openNotice(unread, {
      markRead: () => {
        throw new Error("会话没了");
      },
      navigate: (link) => {
        calls.push(`go:${link}`);
      },
    });

    expect(calls).toEqual(["go:/orders/OD-1"]);
    await flush();
  });

  it("标成功之后敲一次订阅点——角标是这一下唯一的可见证据", async () => {
    const calls: string[] = [];
    watchBadge(calls);

    openNotice(unread, {
      markRead: () => Promise.resolve({ marked: 1 }),
      navigate: () => {
        calls.push("go");
      },
    });

    await flush();
    expect(calls).toEqual(["go", "badge"]);
    expect(calls.filter((call) => call === "badge")).toHaveLength(1);
  });

  it("已经读过的不再标第二遍，跳照旧", async () => {
    const calls: string[] = [];
    watchBadge(calls);

    openNotice(alreadyRead, {
      markRead: (noticeId) => {
        calls.push(`mark:${noticeId}`);
      },
      navigate: (link) => {
        calls.push(`go:${link}`);
      },
    });

    await flush();
    // 没标就没什么变了，也就不必请角标重取。
    expect(calls).toEqual(["go:/orders/OD-1"]);
  });

  it("投给别的平面的不标（它没有「我读过没有」可言），跳照旧", async () => {
    const calls: string[] = [];
    watchBadge(calls);

    openNotice(offPlane, {
      markRead: (noticeId) => {
        calls.push(`mark:${noticeId}`);
      },
      navigate: (link) => {
        calls.push(`go:${link}`);
      },
    });

    await flush();
    expect(calls).toEqual(["go:/orders/OD-1"]);
  });

  it("没有落地页的既不标也不跳", async () => {
    const calls: string[] = [];
    watchBadge(calls);

    openNotice(withoutLink, {
      markRead: (noticeId) => {
        calls.push(`mark:${noticeId}`);
      },
      navigate: (link) => {
        calls.push(`go:${link}`);
      },
    });

    await flush();
    expect(calls).toEqual([]);
  });
});

describe("标不了已读的两个理由", () => {
  it("未读、且投到本平面，才标得了", () => {
    expect(markReadBlocker(unread)).toBeNull();
    expect(canMarkNoticeRead(unread)).toBe(true);
  });

  it("两个理由各自报自己那一个（行操作按它出 hint）", () => {
    expect(markReadBlocker(alreadyRead)).toBe("alreadyRead");
    expect(markReadBlocker(offPlane)).toBe("offPlane");
    expect(canMarkNoticeRead(alreadyRead)).toBe(false);
    expect(canMarkNoticeRead(offPlane)).toBe(false);
  });

  it("不在本平面先报：它连「读过没有」都不成立，说「已经读过了」是个凭空的答案", () => {
    expect(markReadBlocker({ ...alreadyRead, onThisPlane: false })).toBe(
      "offPlane",
    );
  });

  it("缺 onThisPlane = 收件面那一份 = 按定义投到本平面", () => {
    expect("onThisPlane" in unread).toBe(false);
    expect(markReadBlocker(unread)).toBeNull();
  });
});
