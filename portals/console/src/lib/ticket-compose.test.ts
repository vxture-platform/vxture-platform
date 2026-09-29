import { describe, expect, it } from "vitest";
import {
  buildTicketComposeHref,
  buildTicketDetailHref,
  parseTicketCompose,
} from "./ticket-compose";

const UUID = "4b0d9f1e-2c3a-4d5e-8f70-112233445566";

describe("求助跳转的地址", () => {
  it("不带对象时就是一条去提单的地址", () => {
    expect(buildTicketComposeHref()).toBe("/tickets?compose=1");
  });

  it("带对象时把类型与可视码一起带上", () => {
    expect(
      buildTicketComposeHref({ type: "order", code: "SO20260929001" }),
    ).toBe("/tickets?compose=1&aboutType=order&about=SO20260929001");
  });

  it("码是 uuid 就只跳不带对象——那串东西不许进标题", () => {
    // 上游把 subscriptionId 当成 productCode 传过来的情形:静态检查不会说话,
    // 这里是唯一拦得住的地方。
    expect(buildTicketComposeHref({ type: "subscription", code: UUID })).toBe(
      "/tickets?compose=1",
    );
  });

  it("详情地址走可视码,并且转义", () => {
    expect(buildTicketDetailHref("TK-202609-0000000001")).toBe(
      "/tickets/TK-202609-0000000001",
    );
    expect(buildTicketDetailHref("TK 1")).toBe("/tickets/TK%201");
  });
});

describe("解析求助跳转", () => {
  const parse = (query: string) =>
    parseTicketCompose(new URLSearchParams(query));

  it("认得出对象", () => {
    expect(parse("compose=1&aboutType=bill&about=BILL-202609-0007")).toEqual({
      compose: true,
      subject: { type: "bill", code: "BILL-202609-0007" },
    });
  });

  it("没有参数就什么都不开", () => {
    expect(parse("")).toEqual({ compose: false, subject: null });
  });

  it("带了对象但没带 compose,照样开——那条链接只有一个用途", () => {
    expect(parse("aboutType=order&about=SO20260929001")).toEqual({
      compose: true,
      subject: { type: "order", code: "SO20260929001" },
    });
  });

  it("类型不认识就丢掉对象,但仍然当成要提单", () => {
    expect(parse("compose=1&aboutType=invoice&about=INV-1")).toEqual({
      compose: true,
      subject: null,
    });
  });

  it("手拼一条 uuid 进来也不会被接受", () => {
    expect(parse(`compose=1&aboutType=order&about=${UUID}`)).toEqual({
      compose: true,
      subject: null,
    });
  });

  it("太短、带空格、带中文的值都不是可视码", () => {
    expect(parse("aboutType=order&about=SO1").subject).toBeNull();
    expect(parse("aboutType=order&about=SO 20260929").subject).toBeNull();
    expect(parse("aboutType=order&about=订单一号").subject).toBeNull();
  });

  it("null 参数(服务端首帧)不炸", () => {
    expect(parseTicketCompose(null)).toEqual({ compose: false, subject: null });
  });
});
