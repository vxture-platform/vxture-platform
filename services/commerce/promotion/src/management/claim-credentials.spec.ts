/**
 * claim-credentials.spec.ts - Credential entropy, canonicalization and key retirement.
 * @package @vxture/service-promotion
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { describe, it, expect } from "vitest";
import { VoucherClaimCredentials } from "./claim-credentials";

const config = {
  VOUCHER_CLAIM_ACTIVE_KEY: "k1",
  VOUCHER_CLAIM_KEYS: JSON.stringify({ k1: "01".repeat(32) }),
};
describe("confidential claim credentials", () => {
  it("generates distinct 256-bit secrets and reproducible keyed digests", () => {
    const ring = new VoucherClaimCredentials(config),
      a = ring.generate(),
      b = ring.generate();
    expect(a.secret).not.toBe(b.secret);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(ring.digest(a.secret)).toEqual({ digest: a.digest, version: "k1" });
    const other = new VoucherClaimCredentials({
      ...config,
      VOUCHER_CLAIM_KEYS: JSON.stringify({ k1: "02".repeat(32) }),
    });
    expect(other.digest(a.secret).digest).not.toBe(a.digest);
  });
  it.each([
    undefined,
    "",
    "VX-123456",
    "vx1.k1.abc",
    "VX1.k1." + "A".repeat(43),
    "vx1.old." + "A".repeat(43),
  ])("rejects invalid credentials without echoing input", (input) => {
    expect(() => new VoucherClaimCredentials(config).digest(input)).toThrow(
      "领取凭证不可用",
    );
  });
  it("rejects base64 aliases whose unused bits are noncanonical", () => {
    const ring = new VoucherClaimCredentials(config);
    expect(() => ring.digest("vx1.k1." + "A".repeat(42) + "B")).toThrow();
    expect(ring.digest("vx1.k1." + "A".repeat(43))).toHaveProperty("digest");
  });
  it.each([
    {},
    { VOUCHER_CLAIM_ACTIVE_KEY: "k1", VOUCHER_CLAIM_KEYS: "{" },
    {
      VOUCHER_CLAIM_ACTIVE_KEY: "k2",
      VOUCHER_CLAIM_KEYS: config.VOUCHER_CLAIM_KEYS,
    },
    {
      VOUCHER_CLAIM_ACTIVE_KEY: "k1",
      VOUCHER_CLAIM_KEYS: JSON.stringify({ k1: "short" }),
    },
  ])("fails closed for missing or invalid key rings", (value) => {
    expect(() => new VoucherClaimCredentials(value)).toThrow("配置不可用");
  });
});
