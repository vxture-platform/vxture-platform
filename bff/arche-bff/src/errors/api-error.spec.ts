/**
 * api-error.spec.ts —— 钉住封套的**内容**（product_251 X-1）。
 *
 * 守卫脚本 `check-api-conventions.mjs` 挡的是文本模式：有没有裸异常、码是不是大写。
 * 它挡不住**语义回退**——比如有人把 500 的 `retryable` 改成 `true`，脚本一声不吭。
 * 这份测试钉的就是那些判断。
 */
import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  ApiError,
  defaultRetryable,
  invalidRequest,
  notEntitled,
  REJECTION_CODES,
  stepUpRequired,
  upstreamUnavailable,
} from "./api-error";

const envelopeOf = (e: ApiError) => e.getResponse() as Record<string, unknown>;

describe("defaultRetryable —— 「原样重发有没有可能成功」", () => {
  it("上游/限流类可重试", () => {
    expect(defaultRetryable(HttpStatus.TOO_MANY_REQUESTS)).toBe(true);
    expect(defaultRetryable(HttpStatus.BAD_GATEWAY)).toBe(true);
    expect(defaultRetryable(HttpStatus.SERVICE_UNAVAILABLE)).toBe(true);
    expect(defaultRetryable(HttpStatus.GATEWAY_TIMEOUT)).toBe(true);
  });

  it("其余 4xx 不可重试——这么发永远不行", () => {
    expect(defaultRetryable(HttpStatus.BAD_REQUEST)).toBe(false);
    expect(defaultRetryable(HttpStatus.FORBIDDEN)).toBe(false);
    expect(defaultRetryable(HttpStatus.CONFLICT)).toBe(false);
  });

  /* 这条最容易被「500 是临时故障吧」的直觉改掉。未知故障下让调用方自动重试，
     只会把一个故障放大成一片——留个测试挡住那个直觉。 */
  it("500 **不可**重试", () => {
    expect(defaultRetryable(HttpStatus.INTERNAL_SERVER_ERROR)).toBe(false);
  });
});

describe("封套四件套", () => {
  it("code / message / retryable 必有，statusCode 随行", () => {
    const body = envelopeOf(
      invalidRequest("VALIDATION_REQUIRED", "productCode is required"),
    );
    expect(body).toMatchObject({
      code: "VALIDATION_REQUIRED",
      message: "productCode is required",
      retryable: false,
      statusCode: 400,
    });
  });

  it("`field` 给了才出现——没有的时候不留一个 undefined 键", () => {
    expect(envelopeOf(invalidRequest("X_Y", "m"))).not.toHaveProperty("field");
    expect(envelopeOf(invalidRequest("X_Y", "m", "productCode")).field).toBe(
      "productCode",
    );
  });

  it("显式 retryable 压过默认值", () => {
    expect(
      envelopeOf(
        new ApiError(HttpStatus.BAD_REQUEST, "X_Y", "m", { retryable: true }),
      ).retryable,
    ).toBe(true);
  });
});

describe("拒绝词表 —— 不许各造各的", () => {
  it("词表就是这四个", () => {
    expect([...REJECTION_CODES]).toEqual([
      "NOT_ENTITLED",
      "POLICY_DENIED",
      "APPROVAL_REQUIRED",
      "QUOTA_EXCEEDED",
    ]);
  });

  /* 能力门是全仓最高频的拒绝点。它一旦自造码（`CATALOG_NOT_ENTITLED` 之类），
     消费方就得按产品分支判——X-1 要防的正是这个。 */
  it("能力门缺失一律 NOT_ENTITLED，且把缺的能力名带出去", () => {
    const body = envelopeOf(notEntitled("platform:product.manage"));
    expect(body.code).toBe("NOT_ENTITLED");
    expect(body.message).toContain("platform:product.manage");
    expect(body.statusCode).toBe(403);
  });
});

describe("step-up 是一条出路，不是一个错误", () => {
  /* `retryable: true` 是真的：走完仪式把原请求原样重发就会成功。
     另：message 必须保持 `step_up_required`——门户的兜底判断还认它，
     两边不能同时换（见 api-error.ts 该函数注释）。 */
  it("403 + AUTH_STEP_UP_REQUIRED + retryable=true", () => {
    const body = envelopeOf(stepUpRequired());
    expect(body).toMatchObject({
      code: "AUTH_STEP_UP_REQUIRED",
      message: "step_up_required",
      retryable: true,
      statusCode: 403,
    });
  });

  it("不借用 APPROVAL_REQUIRED——那是「要另一个人来批」", () => {
    expect(envelopeOf(stepUpRequired()).code).not.toBe("APPROVAL_REQUIRED");
  });
});

describe("上游不可达", () => {
  it("502 且强制可重试", () => {
    const body = envelopeOf(
      upstreamUnavailable("ATLAS_UNAVAILABLE", "Atlas is unavailable"),
    );
    expect(body).toMatchObject({
      code: "ATLAS_UNAVAILABLE",
      retryable: true,
      statusCode: 502,
    });
  });
});
