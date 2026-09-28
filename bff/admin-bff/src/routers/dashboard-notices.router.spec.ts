/**
 * dashboard-notices.router.spec.ts —— 运营通告读侧的门、筛选透传、全部标记已读。
 *
 * ── 为什么这几条要有测试 ──
 * 这一批给通告读侧加了四项筛选。筛选器最坏的失败不是报错，是**报成功而没筛**：
 *   · `severity=urgent`（把「紧急」写成了英文）如果被当成「没给」，接口回全部三档，
 *     而调用方会以为自己筛过了——屏幕上的数字和标题都对不上，却没有任何一处报错。
 *   · 参数名写错、或者把 `unread=false` 当成 truthy，结果是同一类：看起来筛了。
 *   · 反过来，`scope` 与筛选是两类入参。`plane` / `operatorId` 一旦能从请求里进来，
 *     这个只读端点就变成了「读别的平面 / 别人已读状态」的探测面。
 *
 * 「全部标记已读」那一条另有一个判据：它**不收筛选参数**。收了的话，同一个按钮在
 * 铃铛抽屉里（全平面未读）和在筛过的 /messages 上（这一屏）就是两个意思，而按完
 * 角标不归零这件事在界面上无从解释。
 *
 * 摘要档（digest）那一条是**回归**判据：第四批只加筛选，不许动 scope 的语义。
 *
 * ── 值的词汇不在这里钉 ──
 * 四个参数**认哪些值**由 `@vxture/service-notice` 的 `filters/notice-filters.ts` 一处
 * 定，opera 的发布面读的是同一份；那份约定自己的测试在
 * `services/notification/notice/src/filters/notice-filters.spec.ts`（opera-bff 的 spec
 * 也引着它）。下面「四项筛选」那一组钉的是**本 BFF 这一侧**：解析器真的接上了，且包里
 * 抛的 `NoticeFilterError` 被翻成了 admin 的 400。
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { Pool } from "pg";
import {
  NOTICE_KEYWORD_MAX,
  parseNoticeFilters,
  type NoticeService,
} from "@vxture/service-notice";
import { DashboardRouter } from "./dashboard.router";
import { PLANE_ROOT } from "../auth/plane";
import type { RequestContext } from "../types/console.types";

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const NOTICE_ID = "22222222-2222-4222-8222-222222222222";

const makeReq = (capabilities: string[] | null): Request & RequestContext =>
  ({
    user: capabilities ? { id: OPERATOR_ID, name: "运营" } : undefined,
    capabilities: capabilities ?? undefined,
  }) as unknown as Request & RequestContext;

/** 有会话、有本平面根码的正常请求。 */
const okReq = () => makeReq([PLANE_ROOT]);

const emptyResult = {
  items: [],
  total: 0,
  unread: 0,
  counts: { info: 0, warning: 0, critical: 0 },
};

function routerWith(overrides: Partial<Record<string, unknown>> = {}) {
  const list = vi.fn().mockResolvedValue(emptyResult);
  const markRead = vi.fn().mockResolvedValue({
    id: NOTICE_ID,
    readAt: "2026-09-28T02:00:00.000Z",
  });
  const markAllRead = vi.fn().mockResolvedValue(0);
  const notices = {
    list,
    markRead,
    markAllRead,
    ...overrides,
  } as unknown as NoticeService;
  // 首页总览那半边用不到池；通告这几条一次都不碰它。
  const pool = { query: vi.fn() } as unknown as Pool;
  return {
    router: new DashboardRouter(pool, notices),
    list,
    markRead,
    markAllRead,
    pool,
  };
}

describe("GET /api/dashboard/notices 的门", () => {
  it("无会话 → 401，且服务层一次都没被调到", async () => {
    const { router, list } = routerWith();
    await expect(router.listNotices(makeReq(null))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("有会话但没有本平面根码 → 403（进不了 admin 就看不见 admin 的通告）", async () => {
    const { router, list } = routerWith();
    await expect(
      router.listNotices(makeReq(["operator:account.manage"])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(list).not.toHaveBeenCalled();
  });

  it("门就是本平面根码，不是另立的通告权限码", async () => {
    const { router, list } = routerWith();
    await router.listNotices(okReq());
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/dashboard/notices 的 scope（回归：第四批不许动它）", () => {
  it("不给 scope → 摘要档，limit 20", async () => {
    const { router, list } = routerWith();
    await router.listNotices(okReq());
    expect(list).toHaveBeenCalledWith({
      plane: "admin",
      operatorId: OPERATOR_ID,
      digest: true,
      limit: 20,
      offset: 0,
    });
  });

  it("scope=all → 全部档，limit 50", async () => {
    const { router, list } = routerWith();
    await router.listNotices(okReq(), "all");
    expect(list).toHaveBeenCalledWith({
      plane: "admin",
      operatorId: OPERATOR_ID,
      digest: false,
      limit: 50,
      offset: 0,
    });
  });

  it("plane 与 operatorId 都不来自请求——平面是本 BFF 自己，人是会话里的那个", async () => {
    const { router, list } = routerWith();
    // 方法签名里根本没有这两个口子；这里钉的是实参恒为本平面 + 会话里的人。
    await router.listNotices(okReq(), "all", "5", "10");
    const passed = list.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(passed.plane).toBe("admin");
    expect(passed.operatorId).toBe(OPERATOR_ID);
    expect(passed.limit).toBe(5);
    expect(passed.offset).toBe(10);
  });
});

describe("GET /api/dashboard/notices 的四项筛选", () => {
  it("一项都不给时，入参里连键都不出现（不是给一堆 undefined）", async () => {
    const { router, list } = routerWith();
    await router.listNotices(okReq());
    const passed = list.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(passed).sort()).toEqual([
      "digest",
      "limit",
      "offset",
      "operatorId",
      "plane",
    ]);
  });

  it("severity 逗号分隔多选，source / unread / q 各自透传", async () => {
    const { router, list } = routerWith();
    await router.listNotices(
      okReq(),
      "all",
      "50",
      "0",
      "warning,critical",
      "system",
      "true",
      "  退款  ",
    );
    expect(list).toHaveBeenCalledWith({
      plane: "admin",
      operatorId: OPERATOR_ID,
      digest: false,
      limit: 50,
      offset: 0,
      severities: ["warning", "critical"],
      source: "system",
      unreadOnly: true,
      // 两侧空白先 trim：运营者从别处粘过来常带空格，带着空格搜恒空。
      keyword: "退款",
    });
  });

  it("写错的 severity → 400，不当没给（否则回全部三档而调用方以为筛过了）", async () => {
    const { router, list } = routerWith();
    await expect(
      router.listNotices(okReq(), "all", undefined, undefined, "urgent"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });

  it("写错的 source → 400", async () => {
    const { router, list } = routerWith();
    await expect(
      router.listNotices(
        okReq(),
        "all",
        undefined,
        undefined,
        undefined,
        "robot",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });

  it("超长 keyword → 400，不悄悄截一半（截了的话「搜不到」就无从解释）", async () => {
    const { router, list } = routerWith();
    await expect(
      router.listNotices(
        okReq(),
        "all",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "x".repeat(NOTICE_KEYWORD_MAX + 1),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });

  /* `severity=all` / `source=all` 是下拉框「全部」那一项送的值。这一侧原先为它回
     400，而 opera 读作「不筛」——同一个 URL 两种行为。现在两侧同一个答案：不筛。 */
  it("severity=all / source=all 是「不筛」，不是 400", async () => {
    const { router, list } = routerWith();
    await router.listNotices(
      okReq(),
      "all",
      undefined,
      undefined,
      "all",
      "all",
    );
    const passed = list.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(passed).sort()).toEqual([
      "digest",
      "limit",
      "offset",
      "operatorId",
      "plane",
    ]);
  });

  /* 曾经分岔的第三处：opera 认 unread=1，这一侧静默忽略。静默忽略的症状是
     「筛了但没筛」，它和「筛出来很多条」在屏幕上长得一样。 */
  it("unread=1 也开这一档（不再静默忽略）", async () => {
    const { router, list } = routerWith();
    await router.listNotices(
      okReq(),
      "all",
      undefined,
      undefined,
      undefined,
      undefined,
      "1",
    );
    const passed = list.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(passed.unreadOnly).toBe(true);
  });

  it("counts 原样回传，不在这里重算——三档口径只有服务包一处", async () => {
    const counts = { info: 30, warning: 5, critical: 2 };
    const { router } = routerWith({
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 7,
        unread: 12,
        counts,
      }),
    });
    await expect(router.listNotices(okReq(), "all")).resolves.toEqual({
      items: [],
      total: 7,
      unread: 12,
      counts,
    });
  });
});

/* 这一组用的就是两侧共用的那个解析器（`@vxture/service-notice`）。约定本身钉在
   `services/notification/notice/src/filters/notice-filters.spec.ts`；留在这里是为了
   这一侧读代码的人一眼看见「admin 认的值 = 那一份」，而不是另一套。 */
describe("parseNoticeFilters（服务包一处，两个平面共用）", () => {
  it("空串 / 只有逗号 / unread=false 一律读作「没筛」", () => {
    expect(parseNoticeFilters({})).toEqual({});
    expect(
      parseNoticeFilters({
        severity: " , ",
        source: " ",
        unread: "false",
        q: "  ",
      }),
    ).toEqual({});
  });

  it("重复的 severity 去重", () => {
    expect(parseNoticeFilters({ severity: "info,info,warning" })).toEqual({
      severities: ["info", "warning"],
    });
  });

  /* 原先这一侧只认 "true"，`unread=1` 被静默忽略；opera 一直两个都认。取并集：
     两个都开。改的是这一侧的行为，不是测试的口径。 */
  it("unread=true 与 unread=1 都开这一档，其余值不开", () => {
    expect(parseNoticeFilters({ unread: "1" })).toEqual({ unreadOnly: true });
    expect(parseNoticeFilters({ unread: "true" })).toEqual({
      unreadOnly: true,
    });
    expect(parseNoticeFilters({ unread: "yes" })).toEqual({});
  });

  /* 下拉框「全部」那一项：原先这一侧回 400。 */
  it("severity=all / source=all 读作「不筛」", () => {
    expect(parseNoticeFilters({ severity: "all", source: "all" })).toEqual({});
  });

  it("每一项各出现在返回对象里一次，互不牵连", () => {
    expect(
      parseNoticeFilters({
        severity: "critical",
        source: "manual",
        unread: "true",
        q: "ORD-1",
      }),
    ).toEqual({
      severities: ["critical"],
      source: "manual",
      unreadOnly: true,
      keyword: "ORD-1",
    });
  });
});

describe("POST /api/dashboard/notices/read-all", () => {
  it("无会话 → 401；没有本平面根码 → 403；两种情况都不写库", async () => {
    const a = routerWith();
    await expect(
      a.router.markAllNoticesRead(makeReq(null)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(a.markAllRead).not.toHaveBeenCalled();

    const b = routerWith();
    await expect(
      b.router.markAllNoticesRead(makeReq(["operator:account.manage"])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(b.markAllRead).not.toHaveBeenCalled();
  });

  it("门与读同一道（本平面根码），不新立权限码", async () => {
    const { router, markAllRead } = routerWith({
      markAllRead: vi.fn().mockResolvedValue(9),
    });
    void markAllRead;
    await expect(router.markAllNoticesRead(okReq())).resolves.toEqual({
      marked: 9,
    });
  });

  it("只传平面与会话里的人——一个筛选参数都不带过去", async () => {
    const { router, markAllRead } = routerWith();
    await router.markAllNoticesRead(okReq());
    expect(markAllRead).toHaveBeenCalledTimes(1);
    expect(markAllRead).toHaveBeenCalledWith("admin", OPERATOR_ID);
  });

  it("一条未读都没有时回 marked:0，不是 404——「已经全读过了」是个答案", async () => {
    const { router } = routerWith({
      markAllRead: vi.fn().mockResolvedValue(0),
    });
    await expect(router.markAllNoticesRead(okReq())).resolves.toEqual({
      marked: 0,
    });
  });
});

describe("POST /api/dashboard/notices/:id/read（回归：第四批不动它）", () => {
  it("不是 uuid → 400，不送进库", async () => {
    const { router, markRead } = routerWith();
    await expect(
      router.markNoticeRead(okReq(), "read-all"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(markRead).not.toHaveBeenCalled();
  });

  it("服务层回 null（不存在或已撤回）→ 404", async () => {
    const { router } = routerWith({
      markRead: vi.fn().mockResolvedValue(null),
    });
    await expect(
      router.markNoticeRead(okReq(), NOTICE_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("正常一条回 { id, readAt }", async () => {
    const { router } = routerWith();
    await expect(router.markNoticeRead(okReq(), NOTICE_ID)).resolves.toEqual({
      id: NOTICE_ID,
      readAt: "2026-09-28T02:00:00.000Z",
    });
  });
});
