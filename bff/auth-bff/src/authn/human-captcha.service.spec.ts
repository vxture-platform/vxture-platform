/**
 * Captcha scene isolation, replay handling and configuration regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HumanCaptchaService } from "./human-captcha.service";
import { CaptchaRouter } from "../routers/captcha.router";

// ============================================================================
// Fixtures
// ============================================================================

const PARAM = JSON.stringify({
  sceneId: "customer-scene",
  certifyId: "certify-1",
  deviceToken: "private-device-token",
});
function build() {
  const redis = {
    reserveCaptchaVerification: vi.fn(async () => true),
    reserveCaptchaCeremony: vi.fn(async () => true),
    storeCaptchaProof: vi.fn(async (_token: string, _realm: string) => {}),
    consumeCaptchaProof: vi.fn(async () => true),
  };
  return { redis, service: new HumanCaptchaService(redis as never) };
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ALIYUN_CAPTCHA_ENABLED", "true");
  vi.stubEnv("ALIYUN_CAPTCHA_ACCESS_KEY_ID", "private-access-id");
  vi.stubEnv("ALIYUN_CAPTCHA_ACCESS_KEY_SECRET", "private-secret");
  vi.stubEnv("ALIYUN_CAPTCHA_PREFIX", "public-prefix");
  vi.stubEnv("ALIYUN_CAPTCHA_REGION", "cn");
  vi.stubEnv("ALIYUN_CAPTCHA_CUSTOMER_SCENE_ID", "customer-scene");
  vi.stubEnv("ALIYUN_CAPTCHA_WORKFORCE_SCENE_ID", "workforce-scene");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================================
// Configuration and realm isolation
// ============================================================================

describe("captcha runtime configuration", () => {
  it("exposes only public config with separate server-mapped scene IDs", () => {
    const { service } = build();
    expect(service.config("customer")).toEqual({
      enabled: true,
      sceneId: "customer-scene",
      prefix: "public-prefix",
      region: "cn",
    });
    expect(service.config("workforce")).toMatchObject({
      sceneId: "workforce-scene",
    });
    expect(JSON.stringify(service.config("customer"))).not.toContain("private");
  });
  it.each(["false", "", "TRUE-INVALID"])(
    "fails closed for disabled/missing production switch %s",
    (value) => {
      vi.stubEnv("ALIYUN_CAPTCHA_ENABLED", value);
      expect(() => build().service.config("customer")).toThrow(
        "human_verification_unavailable",
      );
    },
  );
  it.each([
    "ALIYUN_CAPTCHA_ACCESS_KEY_ID",
    "ALIYUN_CAPTCHA_ACCESS_KEY_SECRET",
    "ALIYUN_CAPTCHA_PREFIX",
    "ALIYUN_CAPTCHA_CUSTOMER_SCENE_ID",
    "ALIYUN_CAPTCHA_WORKFORCE_SCENE_ID",
  ])("rejects incomplete configuration %s", (key) => {
    vi.stubEnv(key, "");
    expect(() => build().service.config("customer")).toThrow();
  });
  it("rejects identical scenes and unknown regions", () => {
    vi.stubEnv("ALIYUN_CAPTCHA_WORKFORCE_SCENE_ID", "customer-scene");
    expect(() => build().service.config("workforce")).toThrow();
    vi.stubEnv("ALIYUN_CAPTCHA_WORKFORCE_SCENE_ID", "workforce-scene");
    vi.stubEnv("ALIYUN_CAPTCHA_REGION", "other");
    expect(() => build().service.config("customer")).toThrow();
  });
  it("permits explicit local disable only outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALIYUN_CAPTCHA_ENABLED", "false");
    const { service, redis } = build();
    expect(service.config("customer")).toEqual({ enabled: false });
    await service.consume("workforce", undefined);
    expect(redis.consumeCaptchaProof).not.toHaveBeenCalled();
  });
  it("rejects arbitrary public realm input and prevents config caching", () => {
    const router = new CaptchaRouter(build().service);
    const response = { setHeader: vi.fn() };
    expect(() => router.config("admin", response as never)).toThrow(
      "invalid_realm",
    );
    router.config("customer", response as never);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "no-store",
    );
  });
});

describe("captcha verification and proof consumption", () => {
  it("mints a realm-bound opaque proof only after provider verification", async () => {
    const { service, redis } = build();
    const request = vi.fn(async () =>
      Response.json({
        Code: "Success",
        Success: true,
        Result: { VerifyResult: true, CertifyId: "certify-1" },
      }),
    );
    vi.stubGlobal("fetch", request);
    const proof = await service.verify("customer", PARAM, "ip");
    expect(proof).toMatchObject({
      token: expect.stringMatching(/^[0-9a-f-]{36}$/),
      expiresIn: 120,
    });
    expect(redis.reserveCaptchaCeremony).toHaveBeenCalledWith(
      "customer-scene",
      "certify-1",
    );
    expect(redis.storeCaptchaProof).toHaveBeenCalledWith(
      proof.token,
      "customer",
    );
    expect(
      redis.reserveCaptchaCeremony.mock.invocationCallOrder[0],
    ).toBeLessThan(request.mock.invocationCallOrder[0]!);
    await service.consume("workforce", proof.token);
    expect(redis.consumeCaptchaProof).toHaveBeenCalledWith(
      proof.token,
      "workforce",
    );
  });
  it("rejects crossed scenes before provider verification", async () => {
    const { service, redis } = build();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(service.verify("workforce", PARAM, "ip")).rejects.toThrow(
      "human_verification_failed",
    );
    expect(redis.reserveCaptchaCeremony).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects replay and rate exhaustion before provider verification", async () => {
    const { service, redis } = build();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    redis.reserveCaptchaVerification.mockResolvedValueOnce(false);
    await expect(service.verify("customer", PARAM, "ip")).rejects.toMatchObject(
      { status: 429 },
    );
    redis.reserveCaptchaCeremony.mockResolvedValue(false);
    await expect(service.verify("customer", PARAM, "ip")).rejects.toThrow(
      "human_verification_failed",
    );
    expect(request).not.toHaveBeenCalled();
    expect(redis.storeCaptchaProof).not.toHaveBeenCalled();
  });
  it("keeps sensitive SDK/provider text out of failure logs and responses", async () => {
    const { service, redis } = build();
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("private-secret private-device-token");
      }),
    );
    await expect(service.verify("customer", PARAM, "ip")).rejects.toThrow(
      "human_verification_unavailable",
    );
    expect(warn).toHaveBeenCalledWith(
      "captcha_verification_failed realm=customer reason=provider-unavailable",
    );
    expect(redis.storeCaptchaProof).not.toHaveBeenCalled();
  });
  it("does not mint proofs on provider rejection or Redis outages", async () => {
    const { service, redis } = build();
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ Success: false })),
    );
    await expect(service.verify("customer", PARAM, "ip")).rejects.toThrow(
      "human_verification_failed",
    );
    expect(redis.storeCaptchaProof).not.toHaveBeenCalled();
    redis.reserveCaptchaCeremony.mockRejectedValue(
      new Error("redis unavailable"),
    );
    await expect(service.verify("customer", PARAM, "ip")).rejects.toThrow(
      "redis unavailable",
    );
  });
  it.each([undefined, "", "not-a-proof"])(
    "rejects malformed proof %s without store access",
    async (token) => {
      const { service, redis } = build();
      await expect(service.consume("customer", token)).rejects.toThrow(
        "human_verification_failed",
      );
      expect(redis.consumeCaptchaProof).not.toHaveBeenCalled();
    },
  );
  it("rejects expired, replayed or crossed-realm proofs and propagates store failures", async () => {
    const { service, redis } = build();
    const token = "00000000-0000-0000-0000-000000000000";
    redis.consumeCaptchaProof.mockResolvedValueOnce(false);
    await expect(service.consume("workforce", token)).rejects.toThrow(
      "human_verification_failed",
    );
    redis.consumeCaptchaProof.mockRejectedValueOnce(
      new Error("redis unavailable"),
    );
    await expect(service.consume("customer", token)).rejects.toThrow(
      "redis unavailable",
    );
  });
});
