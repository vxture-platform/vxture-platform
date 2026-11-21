/**
 * claim-credentials.ts - Versioned, one-time delivery of keyed claim credentials.
 * @package @vxture/service-promotion
 * @layer Domain
 * @category security
 * @author AI-Generated
 * @date 2026-11-19
 */
import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHmac, randomBytes } from "node:crypto";

export interface VoucherClaimKeyConfiguration {
  VOUCHER_CLAIM_ACTIVE_KEY?: string | undefined;
  /** JSON object mapping versions to 32-byte hex keys. */
  VOUCHER_CLAIM_KEYS?: string | undefined;
}

// ===========================================================================
// Credentials are case-sensitive and never derived from visible voucher codes.
// ===========================================================================
export class VoucherClaimCredentials {
  private readonly keys = new Map<string, Buffer>();
  private readonly active: string;
  constructor(config: VoucherClaimKeyConfiguration = {}) {
    try {
      this.active = config.VOUCHER_CLAIM_ACTIVE_KEY ?? "";
      const parsed: unknown = JSON.parse(config.VOUCHER_CLAIM_KEYS ?? "null");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error();
      for (const [version, key] of Object.entries(parsed)) {
        if (
          !/^[A-Za-z0-9_-]{1,32}$/.test(version) ||
          typeof key !== "string" ||
          !/^[0-9a-fA-F]{64}$/.test(key)
        )
          throw new Error();
        this.keys.set(version, Buffer.from(key, "hex"));
      }
      if (!this.keys.has(this.active)) throw new Error();
    } catch {
      throw new ServiceUnavailableException("卡券领取凭证配置不可用");
    }
  }

  /** Generate a 256-bit credential. @returns A one-time secret and storage digest. */
  generate(): { secret: string; digest: string; version: string } {
    const secret = `vx1.${this.active}.${randomBytes(32).toString("base64url")}`;
    return { secret, ...this.digest(secret) };
  }

  /** Resolve a canonical credential. @param input - Case-sensitive secret. @returns Keyed digest and version. @throws {BadRequestException} For invalid or retired credentials. */
  digest(input: unknown): { digest: string; version: string } {
    const token = typeof input === "string" ? input.trim() : "";
    const parts = /^vx1\.([A-Za-z0-9_-]{1,32})\.([A-Za-z0-9_-]{43})$/.exec(
      token,
    );
    const version = parts?.[1] ?? "",
      random = parts?.[2] ?? "";
    const key = this.keys.get(version);
    if (
      !key ||
      Buffer.from(random, "base64url").toString("base64url") !== random
    )
      throw new BadRequestException("领取凭证不可用，请核对凭证或联系发放方");
    return {
      version,
      digest: createHmac("sha256", key)
        .update(`voucher-claim:${version}:${random}`)
        .digest("hex"),
    };
  }
}
