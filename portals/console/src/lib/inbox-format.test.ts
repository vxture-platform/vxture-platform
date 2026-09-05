import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatInboxTime, inboxPresentation } from "./inbox-format";

describe("inboxPresentation", () => {
  it("到期 / 退款被拒是 danger", () => {
    expect(inboxPresentation("subscription.expired")).toEqual({
      level: "danger",
      icon: "warning",
    });
    expect(inboxPresentation("refund.rejected").level).toBe("danger");
  });

  it("即将到期 / 续费单是 warning", () => {
    expect(inboxPresentation("subscription.expiring_soon")).toEqual({
      level: "warning",
      icon: "calendar",
    });
    expect(inboxPresentation("order.renewal_created").icon).toBe("receipt");
  });

  it("退款流转、履约、公告是 info", () => {
    expect(inboxPresentation("refund.requested").icon).toBe("wallet");
    expect(inboxPresentation("order.fulfilled").icon).toBe("seal-check");
    expect(inboxPresentation("announcement.published").icon).toBe("bell");
  });

  it("未知模板键回落到 info + bell,而不是抛", () => {
    expect(inboxPresentation("something.new")).toEqual({
      level: "info",
      icon: "bell",
    });
  });
});

describe("formatInboxTime", () => {
  const NOW = new Date("2026-09-05T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("一小时内按分钟、一天内按小时、七天内按天(相对时间)", () => {
    expect(formatInboxTime("2026-09-05T11:55:00Z", "en-US")).toBe(
      "5 minutes ago",
    );
    expect(formatInboxTime("2026-09-05T09:00:00Z", "en-US")).toBe(
      "3 hours ago",
    );
    expect(formatInboxTime("2026-09-03T12:00:00Z", "en-US")).toBe("2 days ago");
  });

  it("满七天起显示日期", () => {
    const out = formatInboxTime("2026-08-20T12:00:00Z", "en-US");
    expect(out).toMatch(/08\/20\/2026|2026/);
    expect(out).not.toMatch(/ago/);
  });

  it("非法时间返回空串", () => {
    expect(formatInboxTime("not-a-date", "en-US")).toBe("");
  });
});
