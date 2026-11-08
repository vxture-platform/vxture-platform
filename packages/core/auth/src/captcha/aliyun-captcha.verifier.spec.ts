/**
 * Aliyun captcha RPC request and rejection regression coverage.
 * @package @vxture/core-auth
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { AliyunCaptchaVerifier } from "./aliyun-captcha.verifier";

const PARAM = JSON.stringify({
  sceneId: "scene-1",
  certifyId: "certify-1",
  deviceToken: "device-token",
});
const OPTIONS = {
  accessKeyId: "test-id",
  accessKeySecret: "test-secret",
  region: "cn",
} as const;
const PASS = {
  Code: "Success",
  Success: true,
  Result: { VerifyResult: true, CertifyId: "certify-1" },
};

// ============================================================================
// Signed requests and fail-closed response validation
// ============================================================================

describe("Aliyun captcha verifier", () => {
  it("signs the exact server scene and SDK payload using Alibaba RPC canonical encoding", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json(PASS));
    expect(
      await new AliyunCaptchaVerifier(OPTIONS, request).verify(
        PARAM,
        "scene-1",
      ),
    ).toBe("certify-1");
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://captcha.cn-shanghai.aliyuncs.com");
    const params = init!.body as URLSearchParams;
    expect(params.get("SceneId")).toBe("scene-1");
    expect(params.get("CaptchaVerifyParam")).toBe(PARAM);
    expect(params.get("Action")).toBe("VerifyIntelligentCaptcha");
    expect(params.get("Version")).toBe("2023-03-05");
    const encode = (value: string) =>
      encodeURIComponent(value).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      );
    const signature = params.get("Signature");
    const entries = [...params.entries()]
      .filter(([key]) => key !== "Signature")
      .sort(([a], [b]) => a.localeCompare(b, "en"));
    const canonical = entries
      .map(([key, value]) => `${encode(key)}=${encode(value)}`)
      .join("&");
    expect(signature).toBe(
      createHmac("sha1", "test-secret&")
        .update(`POST&%2F&${encode(canonical)}`)
        .digest("base64"),
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    "",
    "not-json",
    "[]",
    "null",
    JSON.stringify({ sceneId: "other", certifyId: "certify-1" }),
    JSON.stringify({ sceneId: "scene-1" }),
    "x".repeat(17000),
  ])("rejects invalid/cross-scene input before provider I/O", async (param) => {
    const request = vi.fn<typeof fetch>();
    await expect(
      new AliyunCaptchaVerifier(OPTIONS, request).verify(param, "scene-1"),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    {},
    null,
    { ...PASS, Code: "Error" },
    { ...PASS, Success: "true" },
    { ...PASS, Result: { VerifyResult: "true", CertifyId: "certify-1" } },
    { ...PASS, Result: { VerifyResult: true, CertifyId: "other" } },
  ])("rejects malformed/false provider success responses", async (body) => {
    const request = vi.fn<typeof fetch>(async () => Response.json(body));
    await expect(
      new AliyunCaptchaVerifier(OPTIONS, request).verify(PARAM, "scene-1"),
    ).rejects.toMatchObject({ reason: "provider-rejected" });
  });

  it("does not leak upstream response text or credentials on HTTP/network failures", async () => {
    for (const request of [
      vi.fn<typeof fetch>(
        async () => new Response("secret body", { status: 503 }),
      ),
      vi.fn<typeof fetch>(async () => {
        throw new Error("test-secret");
      }),
    ]) {
      await expect(
        new AliyunCaptchaVerifier(OPTIONS, request).verify(PARAM, "scene-1"),
      ).rejects.toMatchObject({ message: "provider-unavailable" });
    }
  });

  it("uses the Singapore endpoint only for the explicit supported region", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json(PASS));
    await new AliyunCaptchaVerifier(
      { ...OPTIONS, region: "sgp" },
      request,
    ).verify(PARAM, "scene-1");
    expect(request.mock.calls[0]?.[0]).toBe(
      "https://captcha.ap-southeast-1.aliyuncs.com",
    );
  });
});
