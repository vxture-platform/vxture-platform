/**
 * Workforce MFA policy and enrollment regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, it, expect, vi } from "vitest";
import { generateTotp } from "@vxture/service-iam";
import type {
  OperatorMfaContext,
  PgOperatorRepository,
} from "@vxture/service-iam";
import type { VxConfigService } from "@vxture/core-config";
import { OperatorMfaService } from "./operator-mfa.service";
import type { OperatorTotpPending } from "../redis/redis.service";

// ============================================================================
// Fixtures
// ============================================================================

function redisStore() {
  const entries = new Map<
    string,
    { pending: OperatorTotpPending; attempts: number; expires: number }
  >();
  return {
    entries,
    storeOperatorTotpPending: vi.fn(
      async (id: string, context: string, pending: OperatorTotpPending) => {
        if (entries.has(`${id}:${context}`)) return false;
        entries.set(`${id}:${context}`, {
          pending,
          attempts: 0,
          expires: Date.now() + 300_000,
        });
        return true;
      },
    ),
    attemptOperatorTotpPending: vi.fn(async (id: string, context: string) => {
      const entry = entries.get(`${id}:${context}`);
      if (!entry || entry.expires <= Date.now() || entry.attempts >= 5)
        return null;
      entry.attempts++;
      return { pending: entry.pending, version: String(entry.attempts) };
    }),
    consumeOperatorTotpPending: vi.fn(
      async (id: string, context: string, version: string) => {
        const key = `${id}:${context}`;
        const entry = entries.get(key);
        if (
          !entry ||
          entry.expires <= Date.now() ||
          String(entry.attempts) !== version
        )
          return false;
        entries.delete(key);
        return true;
      },
    ),
  };
}

const ENC_KEY = "test-operator-totp-encryption-key-0123456789";

/** A VxConfigService stub exposing only the auth keys the service reads. */
function fakeConfig(encKey: string | undefined): VxConfigService {
  return {
    auth: { OPERATOR_TOTP_ENC_KEY: encKey },
  } as unknown as VxConfigService;
}

/** Build the service over a stub repo returning a fixed MFA context. */
function serviceWith(ctx: OperatorMfaContext | null): OperatorMfaService {
  const repo = {
    getMfaContext: async () => ctx,
  } as unknown as PgOperatorRepository;
  return new OperatorMfaService(
    repo,
    fakeConfig(ENC_KEY),
    redisStore() as never,
  );
}

const ctx = (over: Partial<OperatorMfaContext> = {}): OperatorMfaContext => ({
  platformDefault: "optional",
  roleFloor: "disabled",
  personalPolicy: null,
  totpEnabled: false,
  webauthnCredentialCount: 0,
  webauthnRequired: false,
  ...over,
});

describe("OperatorMfaService.resolveLoginMfa", () => {
  it("unknown operator fails closed", async () => {
    await expect(
      serviceWith(null).resolveLoginMfa("opr_missing"),
    ).rejects.toThrow("invalid_grant");
  });

  it("optional policy still requires first-login enrollment", async () => {
    const r = await serviceWith(
      ctx({ platformDefault: "optional" }),
    ).resolveLoginMfa("opr_1");
    expect(r.decision.mfaRequired).toBe(true);
    expect(r.decision.enrollRequired).toBe(true);
    expect(r.methods).toEqual([]);
  });

  it("optional + TOTP enrolled → second factor required, methods=[totp]", async () => {
    const r = await serviceWith(
      ctx({ platformDefault: "optional", totpEnabled: true }),
    ).resolveLoginMfa("opr_1");
    expect(r.decision.mfaRequired).toBe(true);
    expect(r.decision.enrollRequired).toBe(false);
    expect(r.methods).toEqual(["totp"]);
  });

  it("required + unenrolled → enroll-on-login, methods empty", async () => {
    const r = await serviceWith(ctx({ roleFloor: "required" })).resolveLoginMfa(
      "opr_1",
    );
    expect(r.decision).toEqual({
      effectivePolicy: "required",
      mfaRequired: true,
      enrollRequired: true,
      webauthnRequired: false,
      enrollFactor: "totp",
    });
    expect(r.methods).toEqual([]);
  });

  it("required + TOTP + WebAuthn enrolled → methods=[totp, webauthn]", async () => {
    const r = await serviceWith(
      ctx({
        roleFloor: "required",
        totpEnabled: true,
        webauthnCredentialCount: 2,
      }),
    ).resolveLoginMfa("opr_1");
    expect(r.decision.mfaRequired).toBe(true);
    expect(r.decision.enrollRequired).toBe(false);
    expect(r.methods).toEqual(["totp", "webauthn"]);
  });
});

describe("OperatorMfaService.resolveLoginMfa — webauthn_required (high-privilege)", () => {
  it("with a passkey → only webauthn offered (TOTP/recovery dropped)", async () => {
    const r = await serviceWith(
      ctx({
        webauthnRequired: true,
        totpEnabled: true, // present but must NOT be offered
        webauthnCredentialCount: 1,
      }),
    ).resolveLoginMfa("opr_1");
    expect(r.decision.webauthnRequired).toBe(true);
    expect(r.decision.mfaRequired).toBe(true);
    expect(r.decision.enrollRequired).toBe(false);
    expect(r.methods).toEqual(["webauthn"]);
  });

  it("without a passkey → forced webauthn enroll (methods empty, enrollFactor webauthn)", async () => {
    const r = await serviceWith(
      ctx({ webauthnRequired: true, webauthnCredentialCount: 0 }),
    ).resolveLoginMfa("opr_1");
    expect(r.decision.enrollRequired).toBe(true);
    expect(r.decision.enrollFactor).toBe("webauthn");
    expect(r.methods).toEqual([]);
  });
});

describe("OperatorMfaService.verifySecondFactor (dispatch seam)", () => {
  it("rejects not-yet-implemented methods with unsupported_mfa_method", async () => {
    const svc = serviceWith(ctx());
    for (const method of ["webauthn", "bogus"]) {
      await expect(
        svc.verifySecondFactor({ operatorId: "opr_1", method, code: "000000" }),
      ).rejects.toThrow("unsupported_mfa_method");
    }
  });
});

/** Stateful fake operator repo for the TOTP enroll→verify round-trip. */
function totpRepo(username = "superadmin") {
  let secret: string | null = null;
  let enabled = false;
  let recovery: Array<{ hash: string; used: boolean }> = [];
  return {
    state: () => ({ secret, enabled, recovery }),
    findById: async () => ({
      id: "opr_1",
      username,
      status: "active",
      roleCode: "super_admin",
      email: null,
    }),
    getTotpEnrollment: async () => (secret ? { secret, enabled } : null),
    getMfaContext: async () => ctx({ totpEnabled: enabled }),
    activateTotpEnrollment: async (
      _id: string,
      input: {
        secret: string;
        previousSecret: string | null;
        previousEnabled: boolean;
        recoveryHashes: string[];
      },
    ) => {
      if (secret !== input.previousSecret || enabled !== input.previousEnabled)
        return false;
      secret = input.secret;
      enabled = true;
      recovery = input.recoveryHashes.map((hash) => ({ hash, used: false }));
      return true;
    },
    upsertPendingTotpSecret: async (_id: string, enc: string) => {
      secret = enc;
      enabled = false;
    },
    enableTotp: async () => {
      enabled = true;
    },
    replaceRecoveryCodes: async (_id: string, hashes: string[]) => {
      recovery = hashes.map((hash) => ({ hash, used: false }));
    },
    consumeRecoveryCode: async (_id: string, hash: string) => {
      const row = recovery.find((r) => r.hash === hash && !r.used);
      if (!row) return false;
      row.used = true;
      return true;
    },
  } as unknown as PgOperatorRepository & { state: () => unknown };
}

describe("OperatorMfaService — TOTP enroll + verify", () => {
  it("begin → confirm first code → verify subsequent codes; encrypts at rest", async () => {
    const repo = totpRepo();
    const redis = redisStore();
    const svc = new OperatorMfaService(
      repo,
      fakeConfig(ENC_KEY),
      redis as never,
    );

    const { secret, otpauthUri } = await svc.beginTotpEnrollment(
      "opr_1",
      "self:session:ceremony",
    );
    expect(otpauthUri).toContain("otpauth://totp/Vxture%3Asuperadmin");
    // Stored secret is ciphertext (v1.<iv>.<tag>.<ct>), never the base32 plaintext.
    const stored = redis.entries.get("opr_1:self:session:ceremony")!.pending
      .secret;
    expect((repo.state() as { secret: string | null }).secret).toBeNull();
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain(secret);

    // Wrong first code does not enable TOTP.
    expect(
      (
        await svc.confirmTotpEnrollment(
          "opr_1",
          "invalid",
          "self:session:ceremony",
        )
      ).ok,
    ).toBe(false);
    expect((repo.state() as { enabled: boolean }).enabled).toBe(false);

    // Correct first code (current time) confirms + enables + issues recovery codes.
    const first = generateTotp(secret);
    const confirmed = await svc.confirmTotpEnrollment(
      "opr_1",
      first,
      "self:session:ceremony",
    );
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.recoveryCodes).toHaveLength(10);
    expect((repo.state() as { enabled: boolean }).enabled).toBe(true);

    // Now a valid TOTP verifies, a wrong one fails.
    const live = generateTotp(secret);
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "totp",
        code: live,
      }),
    ).toBe(true);
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "totp",
        code: "000000",
      }),
    ).toBe(false);
  });

  it("verifySecondFactor(totp) is false when TOTP is not enabled", async () => {
    const repo = totpRepo();
    const svc = new OperatorMfaService(
      repo,
      fakeConfig(ENC_KEY),
      redisStore() as never,
    );
    await svc.beginTotpEnrollment("opr_1", "login:token", true);
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "totp",
        code: "000000",
      }),
    ).toBe(false);
  });

  it("fails closed when OPERATOR_TOTP_ENC_KEY is unconfigured", async () => {
    const repo = totpRepo();
    const svc = new OperatorMfaService(
      repo,
      fakeConfig(undefined),
      redisStore() as never,
    );
    await expect(
      svc.beginTotpEnrollment("opr_1", "login:token", true),
    ).rejects.toThrow("operator_totp_unavailable");
  });
});

// ============================================================================
// Rebinding, replay and isolation
// ============================================================================

describe("OperatorMfaService — safe rebinding", () => {
  async function enrolled() {
    const repo = totpRepo();
    const redis = redisStore();
    const svc = new OperatorMfaService(
      repo,
      fakeConfig(ENC_KEY),
      redis as never,
    );
    const original = await svc.beginTotpEnrollment(
      "opr_1",
      "login:first",
      true,
    );
    const completed = await svc.confirmTotpEnrollment(
      "opr_1",
      generateTotp(original.secret),
      "login:first",
    );
    if (!completed.ok) throw new Error("fixture enrollment failed");
    return { repo, redis, svc, original, recovery: completed.recoveryCodes };
  }

  it("keeps the old authenticator and recovery codes valid while setup is abandoned", async () => {
    const { svc, original, recovery } = await enrolled();
    await svc.beginTotpEnrollment("opr_1", "self:session:new");
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "totp",
        code: generateTotp(original.secret),
      }),
    ).toBe(true);
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "recovery",
        code: recovery[0]!,
      }),
    ).toBe(true);
  });

  it("switches factors and recovery codes only after confirming the new authenticator", async () => {
    const { svc, repo, original, recovery } = await enrolled();
    const oldCiphertext = (repo.state() as { secret: string }).secret;
    const next = await svc.beginTotpEnrollment("opr_1", "self:session:new");
    const result = await svc.confirmTotpEnrollment(
      "opr_1",
      generateTotp(next.secret),
      "self:session:new",
    );
    expect(result.ok).toBe(true);
    expect((repo.state() as { secret: string }).secret).not.toBe(oldCiphertext);
    expect(next.secret).not.toBe(original.secret);
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "totp",
        code: generateTotp(next.secret),
      }),
    ).toBe(true);
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "recovery",
        code: recovery[0]!,
      }),
    ).toBe(false);
  });

  it("binds pending setup to both account and ceremony context", async () => {
    const { svc } = await enrolled();
    const next = await svc.beginTotpEnrollment("opr_1", "self:session-a:token");
    const code = generateTotp(next.secret);
    for (const [id, context] of [
      ["opr_2", "self:session-a:token"],
      ["opr_1", "self:session-b:token"],
      ["opr_1", "login:token"],
    ]) {
      expect((await svc.confirmTotpEnrollment(id!, code, context!)).ok).toBe(
        false,
      );
    }
    expect(
      (await svc.confirmTotpEnrollment("opr_1", code, "self:session-a:token"))
        .ok,
    ).toBe(true);
  });

  it("does not revive expired setup or disable the original factor", async () => {
    const { svc, redis, original } = await enrolled();
    const next = await svc.beginTotpEnrollment("opr_1", "self:expired");
    redis.entries.get("opr_1:self:expired")!.expires = Date.now() - 1;
    expect(
      (
        await svc.confirmTotpEnrollment(
          "opr_1",
          generateTotp(next.secret),
          "self:expired",
        )
      ).ok,
    ).toBe(false);
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "totp",
        code: generateTotp(original.secret),
      }),
    ).toBe(true);
  });

  it("caps wrong-code attempts and rejects restaging the same context", async () => {
    const { svc } = await enrolled();
    const next = await svc.beginTotpEnrollment("opr_1", "self:limited");
    for (let i = 0; i < 5; i++) {
      expect(
        (await svc.confirmTotpEnrollment("opr_1", "invalid", "self:limited"))
          .ok,
      ).toBe(false);
    }
    await expect(
      svc.beginTotpEnrollment("opr_1", "self:limited"),
    ).rejects.toThrow("mfa_enrollment_in_progress");
    expect(
      (
        await svc.confirmTotpEnrollment(
          "opr_1",
          generateTotp(next.secret),
          "self:limited",
        )
      ).ok,
    ).toBe(false);
  });

  it("consumes confirmation once even for concurrent requests", async () => {
    const { svc } = await enrolled();
    const next = await svc.beginTotpEnrollment("opr_1", "self:concurrent");
    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        svc.confirmTotpEnrollment(
          "opr_1",
          generateTotp(next.secret),
          "self:concurrent",
        ),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      (
        await svc.confirmTotpEnrollment(
          "opr_1",
          generateTotp(next.secret),
          "self:concurrent",
        )
      ).ok,
    ).toBe(false);
  });

  it("rejects a stale ceremony after a different session completed rebinding", async () => {
    const { svc } = await enrolled();
    const first = await svc.beginTotpEnrollment("opr_1", "self:a");
    const second = await svc.beginTotpEnrollment("opr_1", "self:b");
    expect(
      (
        await svc.confirmTotpEnrollment(
          "opr_1",
          generateTotp(first.secret),
          "self:a",
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await svc.confirmTotpEnrollment(
          "opr_1",
          generateTotp(second.secret),
          "self:b",
        )
      ).ok,
    ).toBe(false);
  });

  it("prevents enrollment-on-login from replacing an existing factor", async () => {
    const { svc } = await enrolled();
    await expect(
      svc.beginTotpEnrollment("opr_1", "login:other", true),
    ).rejects.toThrow("mfa_already_enrolled");
  });

  it("does not stage a secret if the factor changed after step-up verification", async () => {
    const { svc, redis } = await enrolled();
    await expect(
      svc.beginTotpEnrollment("opr_1", "self:stale", false, {
        secret: null,
        enabled: false,
      }),
    ).rejects.toThrow("mfa_state_changed");
    expect(redis.entries.has("opr_1:self:stale")).toBe(false);
  });
});

describe("OperatorMfaService — recovery codes", () => {
  it("issues 10 codes; a code logs in once then is rejected on reuse", async () => {
    const repo = totpRepo();
    const svc = new OperatorMfaService(
      repo,
      fakeConfig(ENC_KEY),
      redisStore() as never,
    );

    const codes = await svc.issueRecoveryCodes("opr_1");
    expect(codes).toHaveLength(10);
    // Stored as hashes, never plaintext.
    const stored = (repo.state() as { recovery: Array<{ hash: string }> })
      .recovery;
    expect(stored).toHaveLength(10);
    expect(stored.every((r) => /^[0-9a-f]{64}$/.test(r.hash))).toBe(true);
    expect(stored.some((r) => codes.includes(r.hash))).toBe(false);

    const code = codes[0]!;
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "recovery",
        code,
      }),
    ).toBe(true);
    // Single-use: the same code is rejected the second time.
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "recovery",
        code,
      }),
    ).toBe(false);
    // A different unused code still works (accepts display formatting/case).
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "recovery",
        code: codes[1]!.toLowerCase(),
      }),
    ).toBe(true);
  });

  it("rejects an unknown recovery code", async () => {
    const repo = totpRepo();
    const svc = new OperatorMfaService(
      repo,
      fakeConfig(ENC_KEY),
      redisStore() as never,
    );
    await svc.issueRecoveryCodes("opr_1");
    expect(
      await svc.verifySecondFactor({
        operatorId: "opr_1",
        method: "recovery",
        code: "ZZZZ-ZZZZ-ZZZZ",
      }),
    ).toBe(false);
  });
});
