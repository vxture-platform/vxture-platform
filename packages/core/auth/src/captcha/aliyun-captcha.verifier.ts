/**
 * Aliyun Captcha 2.0 RPC verification adapter.
 * @package @vxture/core-auth
 * @layer Infrastructure
 * @category client
 * @author AI-Generated
 * @date 2026-11-07
 */
import { createHmac, randomUUID } from "node:crypto";

export interface AliyunCaptchaOptions {
  accessKeyId: string;
  accessKeySecret: string;
  region: "cn" | "sgp";
  timeoutMs?: number;
}

export class AliyunCaptchaError extends Error {
  constructor(
    readonly reason:
      | "invalid-param"
      | "scene-mismatch"
      | "configuration"
      | "provider-rejected"
      | "provider-unavailable",
  ) {
    super(reason);
    this.name = "AliyunCaptchaError";
  }
}

// ============================================================================
// RPC encoding and verification
// ============================================================================

function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export class AliyunCaptchaVerifier {
  constructor(
    private readonly options: AliyunCaptchaOptions,
    private readonly request: typeof fetch = fetch,
  ) {}

  /**
   * Validate the opaque SDK payload before making provider requests.
   * @param param - Browser SDK verification parameter.
   * @param sceneId - Server-selected scene.
   * @returns Provider ceremony identifier for replay protection.
   * @throws {AliyunCaptchaError} On malformed or crossed-scene input.
   */
  static identify(param: unknown, sceneId: string): string {
    if (typeof param !== "string" || param.length > 16384 || !param.length)
      throw new AliyunCaptchaError("invalid-param");
    let parsed: unknown;
    try {
      parsed = JSON.parse(param);
    } catch {
      throw new AliyunCaptchaError("invalid-param");
    }
    if (!parsed || typeof parsed !== "object")
      throw new AliyunCaptchaError("invalid-param");
    const record = parsed as Record<string, unknown>;
    if (record.sceneId !== sceneId)
      throw new AliyunCaptchaError("scene-mismatch");
    if (
      typeof record.certifyId !== "string" ||
      !/^[a-zA-Z0-9_.:-]{1,256}$/.test(record.certifyId)
    )
      throw new AliyunCaptchaError("invalid-param");
    return record.certifyId;
  }

  /**
   * Call VerifyIntelligentCaptcha using Alibaba Cloud RPC Signature Version 1.0.
   * @param param - Browser SDK verification parameter.
   * @param sceneId - Server-selected scene, independent of the payload.
   * @returns The verified provider ceremony identifier.
   * @throws {AliyunCaptchaError} On configuration, rejection, timeout or malformed response.
   */
  async verify(param: string, sceneId: string): Promise<string> {
    const certifyId = AliyunCaptchaVerifier.identify(param, sceneId);
    if (
      !this.options.accessKeyId ||
      !this.options.accessKeySecret ||
      !["cn", "sgp"].includes(this.options.region)
    )
      throw new AliyunCaptchaError("configuration");
    const params: Record<string, string> = {
      Action: "VerifyIntelligentCaptcha",
      Version: "2023-03-05",
      Format: "JSON",
      AccessKeyId: this.options.accessKeyId,
      SignatureMethod: "HMAC-SHA1",
      SignatureVersion: "1.0",
      SignatureNonce: randomUUID(),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      CaptchaVerifyParam: param,
      SceneId: sceneId,
    };
    const canonical = Object.keys(params)
      .sort()
      .map((key) => `${encode(key)}=${encode(params[key]!)}`)
      .join("&");
    params.Signature = createHmac("sha1", `${this.options.accessKeySecret}&`)
      .update(`POST&%2F&${encode(canonical)}`)
      .digest("base64");
    const endpoint =
      this.options.region === "sgp"
        ? "https://captcha.ap-southeast-1.aliyuncs.com"
        : "https://captcha.cn-shanghai.aliyuncs.com";
    let body: unknown;
    try {
      const response = await this.request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
      });
      if (!response.ok) throw new Error("http_error");
      body = await response.json();
    } catch {
      throw new AliyunCaptchaError("provider-unavailable");
    }
    if (!body || typeof body !== "object")
      throw new AliyunCaptchaError("provider-rejected");
    const result = body as {
      Code?: unknown;
      Success?: unknown;
      Result?: { VerifyResult?: unknown; CertifyId?: unknown };
    };
    if (
      result.Code !== "Success" ||
      result.Success !== true ||
      result.Result?.VerifyResult !== true ||
      result.Result.CertifyId !== certifyId
    )
      throw new AliyunCaptchaError("provider-rejected");
    return certifyId;
  }
}
