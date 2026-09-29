import { describe, expect, it } from "vitest";
import { TICKET_STATUSES } from "@vxture-platform/shared";
import {
  FINISHED_TICKET_STATUSES,
  OPEN_TICKET_STATUSES,
  canReplyToTicket,
  isOpenTicket,
  isTicketFinished,
} from "./ticket-state";

describe("工单状态分组", () => {
  it("七个值恰好分成三档,不重不漏", () => {
    // `isTicketFinished` 定义成 `!canReplyToTicket`,所以"三者之一为真"是恒真的,
    // 断言那个等于什么都没查。真正会动的判据是**分档**:每个值落进
    // 盯着 / 收尾但可回 / 结束 三档中的恰好一档,三档之和等于整个值域。
    const buckets = { open: [], reversible: [], finished: [] } as Record<
      "open" | "reversible" | "finished",
      string[]
    >;
    for (const status of TICKET_STATUSES) {
      if (isOpenTicket(status)) buckets.open.push(status);
      else if (canReplyToTicket(status)) buckets.reversible.push(status);
      else buckets.finished.push(status);
    }
    expect(buckets).toEqual({
      open: ["open", "pending", "in_progress", "reopened"],
      reversible: ["resolved"],
      finished: ["closed", "cancelled"],
    });
    expect(
      buckets.open.length + buckets.reversible.length + buckets.finished.length,
    ).toBe(TICKET_STATUSES.length);
  });

  it("「未结」与「终态」互斥——一张单不能同时在盯着又已经结束", () => {
    for (const status of TICKET_STATUSES) {
      expect(isOpenTicket(status) && isTicketFinished(status)).toBe(false);
    }
  });

  it("resolved 不进未结,但仍然能回复——它是可逆的那一档", () => {
    // 这一条是本文件存在的理由:三处判据里最容易漏掉的就是它,
    // 而漏掉的后果是把一张还能救的单画成结束了。
    expect(isOpenTicket("resolved")).toBe(false);
    expect(canReplyToTicket("resolved")).toBe(true);
    expect(isTicketFinished("resolved")).toBe(false);
  });

  it("closed 与 cancelled 是终态,回复框必须关", () => {
    expect(canReplyToTicket("closed")).toBe(false);
    expect(canReplyToTicket("cancelled")).toBe(false);
    expect(FINISHED_TICKET_STATUSES).toEqual(["closed", "cancelled"]);
  });

  it("值域外的词落进保守那一档:不可回复、不算未结", () => {
    // `event_type` 是开放集、`status` 将来也可能多一个词。多出来的那个词必须落到
    // 「不给写字的框」这一边——反过来的错会让客户对着一张不再处理的单说话,没人回。
    expect(isOpenTicket("escalated")).toBe(false);
    expect(canReplyToTicket("escalated")).toBe(false);
    expect(isTicketFinished("escalated")).toBe(true);
  });

  it("未结那四个与 admin 侧「未结数」同一组值", () => {
    // admin 的 ticketOpenCount 口径写在 console.types.ts 上:
    // open/pending/in_progress/reopened。两边不一样就会出现
    // 「运营看到 3 张未结,客户抽屉里 4 条」这种谁也说不清的差。
    expect([...OPEN_TICKET_STATUSES]).toEqual([
      "open",
      "pending",
      "in_progress",
      "reopened",
    ]);
  });
});
