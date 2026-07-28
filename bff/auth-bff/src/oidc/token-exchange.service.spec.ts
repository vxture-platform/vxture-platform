import { describe, expect, it, vi, beforeEach } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
  TokenExchangeService,
  TOKEN_EXCHANGE_TTL_SECONDS,
  PLATFORM_S2S_AUDIENCE,
} from "./token-exchange.service";
import type { OidcKeyService } from "./oidc-key.service";

// Unit tests (product_310 D... / product_210 T1): pool + signer are mocked;
// the subject is the grant's request-shape validation, OBO context
// extraction, D2 coverage gate, and the exact claim shape signed.

interface Mocks {
  pool: { query: ReturnType<typeof vi.fn> };
  keys: { sign: ReturnType<typeof vi.fn>; verify: ReturnType<typeof vi.fn> };
  service: TokenExchangeService;
}

const build = (): Mocks => {
  const pool = { query: vi.fn() };
  const keys = {
    sign: vi.fn().mockReturnValue("signed.jwt.token"),
    verify: vi.fn(),
  };
  const service = new TokenExchangeService(
    pool as unknown as import("pg").Pool,
    keys as unknown as OidcKeyService,
  );
  return { pool, keys, service };
};

const CALLER_ARDA = { clientId: "arda", productCode: "arda" };
const CALLER_PLATFORM = { clientId: "console", productCode: null };
// A platform-level client NOT in PLATFORM_LEVEL_S2S_CALLERS — still hits the
// original invalid_client rejection (unlike CALLER_PLATFORM/"console", which
// is allowlisted, see the "platform-caller mode" describe block below).
const CALLER_PLATFORM_UNLISTED = { clientId: "website", productCode: null };

describe("TokenExchangeService.exchange — request validation", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("rejects a caller with no product identity and not on the platform-caller allowlist", async () => {
    await expect(
      m.service.exchange(CALLER_PLATFORM_UNLISTED, {
        audience: "arda",
        subjectToken: undefined,
        workspaceId: "ws-1",
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(m.pool.query).not.toHaveBeenCalled();
  });

  it("rejects a missing audience", async () => {
    await expect(
      m.service.exchange(CALLER_ARDA, {
        audience: undefined,
        subjectToken: undefined,
        workspaceId: "ws-1",
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an audience that doesn't resolve to an active product (invalid_target)", async () => {
    m.pool.query.mockResolvedValueOnce({ rows: [] }); // resolveTargetProductCode: no match
    await expect(
      m.service.exchange(CALLER_ARDA, {
        audience: "not-a-product",
        subjectToken: undefined,
        workspaceId: "ws-1",
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("TokenExchangeService.exchange — service mode (D2 coverage gate)", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("mints with no sub claim when the caller holds coverage of the workspace", async () => {
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "karda" }] }) // target resolves
      .mockResolvedValueOnce({ rows: [{ covered: true }] }) // D2 covered
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] }); // resolveTenantId

    const result = await m.service.exchange(CALLER_ARDA, {
      audience: "karda",
      subjectToken: undefined,
      workspaceId: "ws-1",
      orgId: "org-1",
    });

    expect(result).toEqual({
      accessToken: "signed.jwt.token",
      expiresIn: TOKEN_EXCHANGE_TTL_SECONDS,
    });
    expect(m.keys.sign).toHaveBeenCalledWith(
      {
        act: { sub: "arda" },
        org_id: "org-1",
        tenant_id: "tenant-1",
        workspace_id: "ws-1",
        mode: "service",
        scope: "tool:karda",
      },
      {
        audience: "karda",
        expiresInSec: TOKEN_EXCHANGE_TTL_SECONDS,
        jwtid: expect.any(String),
      },
    );
    // no `subject` key at all — service-mode tokens have no user behind them
    const signOpts = m.keys.sign.mock.calls[0]![1];
    expect(signOpts).not.toHaveProperty("subject");
  });

  it("rejects service mode with no workspace_id", async () => {
    m.pool.query.mockResolvedValueOnce({ rows: [{ product_code: "karda" }] });
    await expect(
      m.service.exchange(CALLER_ARDA, {
        audience: "karda",
        subjectToken: undefined,
        workspaceId: undefined,
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects (invalid_target) when the caller has no coverage of the declared workspace", async () => {
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "karda" }] })
      .mockResolvedValueOnce({ rows: [{ covered: false }] });
    await expect(
      m.service.exchange(CALLER_ARDA, {
        audience: "karda",
        subjectToken: undefined,
        workspaceId: "ws-not-mine",
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(m.keys.sign).not.toHaveBeenCalled();
  });

  it("defaults org_id to null when omitted", async () => {
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "karda" }] })
      .mockResolvedValueOnce({ rows: [{ covered: true }] })
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] });
    await m.service.exchange(CALLER_ARDA, {
      audience: "karda",
      subjectToken: undefined,
      workspaceId: "ws-1",
      orgId: undefined,
    });
    expect(m.keys.sign).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: null }),
      expect.anything(),
    );
  });
});

describe("TokenExchangeService.exchange — OBO mode", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("derives sub/org/workspace from the presented (self-verified) subject_token", async () => {
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "karda" }] }) // target
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-9" }] }); // resolveTenantId
    m.keys.verify.mockReturnValue({
      aud: CALLER_ARDA.clientId,
      sub: "usr_123",
      active_org: "org-9",
      active_workspace: "ws-9",
    });

    const result = await m.service.exchange(CALLER_ARDA, {
      audience: "karda",
      subjectToken: "raw.user.token",
      workspaceId: undefined,
      orgId: undefined,
    });

    expect(m.keys.verify).toHaveBeenCalledWith("raw.user.token");
    expect(result.accessToken).toBe("signed.jwt.token");
    expect(m.keys.sign).toHaveBeenCalledWith(
      {
        act: { sub: "arda" },
        org_id: "org-9",
        tenant_id: "tenant-9",
        workspace_id: "ws-9",
        mode: "obo",
        scope: "tool:karda",
      },
      {
        audience: "karda",
        subject: "usr_123",
        expiresInSec: TOKEN_EXCHANGE_TTL_SECONDS,
        jwtid: expect.any(String),
      },
    );
    // OBO never touches the D2 coverage query — target lookup + tenantId lookup + audit insert
    expect(m.pool.query).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid/expired subject_token", async () => {
    m.pool.query.mockResolvedValueOnce({ rows: [{ product_code: "karda" }] });
    m.keys.verify.mockImplementation(() => {
      throw new Error("jwt expired");
    });
    await expect(
      m.service.exchange(CALLER_ARDA, {
        audience: "karda",
        subjectToken: "bad.token",
        workspaceId: undefined,
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a subject_token with no active_workspace (e.g. a service-mode S2S token)", async () => {
    m.pool.query.mockResolvedValueOnce({ rows: [{ product_code: "karda" }] });
    m.keys.verify.mockReturnValue({
      aud: CALLER_ARDA.clientId,
      sub: "arda",
      mode: "service",
    }); // no active_workspace
    await expect(
      m.service.exchange(CALLER_ARDA, {
        audience: "karda",
        subjectToken: "s2s.token",
        workspaceId: undefined,
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a subject_token with no sub claim", async () => {
    m.pool.query.mockResolvedValueOnce({ rows: [{ product_code: "karda" }] });
    m.keys.verify.mockReturnValue({
      aud: CALLER_ARDA.clientId,
      active_workspace: "ws-9",
    });
    await expect(
      m.service.exchange(CALLER_ARDA, {
        audience: "karda",
        subjectToken: "weird.token",
        workspaceId: undefined,
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a subject_token minted for a DIFFERENT client (cross-product OBO replay)", async () => {
    m.pool.query.mockResolvedValueOnce({ rows: [{ product_code: "karda" }] });
    // a real user token, validly signed, but aud='runa' — CALLER_ARDA (clientId
    // 'arda') presenting it must be rejected: this is exactly the single-
    // audience discipline product_210 §3.1 states ("A 的 token 到 B 必拒").
    m.keys.verify.mockReturnValue({
      aud: "runa",
      sub: "usr_1",
      active_workspace: "ws-9",
    });
    await expect(
      m.service.exchange(CALLER_ARDA, {
        audience: "karda",
        subjectToken: "runa-audienced.user.token",
        workspaceId: undefined,
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(m.keys.sign).not.toHaveBeenCalled();
  });
});

describe("TokenExchangeService.exchange — platform-face target (T2, aud=vxture)", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("resolves the vxture sentinel via a DB-first lookup that falls back when no real row matches", async () => {
    // target lookup runs FIRST now (DB stays authoritative — post-review
    // hardening) and returns no row for the literal 'vxture' string (no such
    // product exists), THEN the D2 coverage query runs.
    m.pool.query
      .mockResolvedValueOnce({ rows: [] }) // target lookup: no product named 'vxture'
      .mockResolvedValueOnce({ rows: [{ covered: true }] }) // D2
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] }); // resolveTenantId

    const result = await m.service.exchange(CALLER_ARDA, {
      audience: PLATFORM_S2S_AUDIENCE,
      subjectToken: undefined,
      workspaceId: "ws-1",
      orgId: undefined,
    });

    expect(result.accessToken).toBe("signed.jwt.token");
    expect(m.pool.query).toHaveBeenCalledTimes(4); // target lookup + D2 + tenantId lookup + audit insert
    expect(m.keys.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        act: { sub: "arda" },
        scope: `tool:${PLATFORM_S2S_AUDIENCE}`,
      }),
      expect.objectContaining({ audience: PLATFORM_S2S_AUDIENCE }),
    );
  });

  it("still enforces D2 coverage for platform-face self-service calls", async () => {
    m.pool.query.mockResolvedValueOnce({ rows: [{ covered: false }] });
    await expect(
      m.service.exchange(CALLER_ARDA, {
        audience: PLATFORM_S2S_AUDIENCE,
        subjectToken: undefined,
        workspaceId: "ws-not-mine",
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(m.keys.sign).not.toHaveBeenCalled();
  });

  it("OBO mode works against the vxture target too (target lookup only, no D2 query)", async () => {
    m.pool.query
      .mockResolvedValueOnce({ rows: [] }) // target lookup: no product named 'vxture'
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] }); // resolveTenantId
    m.keys.verify.mockReturnValue({
      aud: CALLER_ARDA.clientId,
      sub: "usr_1",
      active_org: "org-1",
      active_workspace: "ws-1",
    });
    const result = await m.service.exchange(CALLER_ARDA, {
      audience: PLATFORM_S2S_AUDIENCE,
      subjectToken: "user.access.token",
      workspaceId: undefined,
      orgId: undefined,
    });
    expect(result.accessToken).toBe("signed.jwt.token");
    // target lookup + tenantId lookup + audit insert — OBO skips D2
    expect(m.pool.query).toHaveBeenCalledTimes(3);
  });

  it("prefers a real product.products row over the sentinel when both could match (DB-first collision safety)", async () => {
    // Simulates the hypothetical future collision the sentinel-fallback
    // design guards against: a real active row happens to have
    // product_code='vxture'. The target lookup must be consulted (and its
    // result used) rather than short-circuited by the literal string check.
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "vxture" }] }) // a REAL row
      .mockResolvedValueOnce({ rows: [{ covered: true }] }) // D2
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] }); // resolveTenantId

    await m.service.exchange(CALLER_ARDA, {
      audience: PLATFORM_S2S_AUDIENCE,
      subjectToken: undefined,
      workspaceId: "ws-1",
      orgId: undefined,
    });

    // proves the DB was actually consulted for the target (not skipped via
    // an early sentinel return) — the defense this test guards. (+1 each for
    // the tenantId lookup and the audit insert that follow a successful mint.)
    expect(m.pool.query).toHaveBeenCalledTimes(4);
  });
});

describe("TokenExchangeService.exchange — audit trail (TD-034)", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("appends a support.audit_logs row citing the exact jti the issued token carries", async () => {
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "karda" }] }) // target
      .mockResolvedValueOnce({ rows: [{ covered: true }] }) // D2
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] }) // resolveTenantId
      .mockResolvedValueOnce({ rows: [] }); // audit insert

    await m.service.exchange(CALLER_ARDA, {
      audience: "karda",
      subjectToken: undefined,
      workspaceId: "ws-1",
      orgId: "org-1",
    });

    const signedJti = (m.keys.sign.mock.calls[0]![1] as { jwtid: string })
      .jwtid;
    const [sql, params] = m.pool.query.mock.calls[3]!;
    expect(sql).toContain("insert into support.audit_logs");
    expect(sql).toContain("'system'");
    expect(sql).toContain("'oidc.token_exchange.issued'");
    expect(params[0]).toBe("00000000-0000-0000-0000-000000000000");
    expect(params[1]).toBe(signedJti);
    expect(JSON.parse(params[2])).toEqual({
      caller_product: "arda",
      target_product: "karda",
      mode: "service",
      workspace_id: "ws-1",
      org_id: "org-1",
      tenant_id: "tenant-1",
    });
  });

  it("does not fail the exchange when the audit write itself throws (best-effort)", async () => {
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "karda" }] })
      .mockResolvedValueOnce({ rows: [{ covered: true }] })
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] })
      .mockRejectedValueOnce(new Error("db unavailable"));

    const result = await m.service.exchange(CALLER_ARDA, {
      audience: "karda",
      subjectToken: undefined,
      workspaceId: "ws-1",
      orgId: undefined,
    });

    expect(result.accessToken).toBe("signed.jwt.token");
  });
});

describe("TokenExchangeService.exchange — platform-caller mode (console→atlas wiring)", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("mints a service-mode token for an allowlisted platform-level caller, act.sub = caller clientId", async () => {
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "atlas" }] }) // target lookup — no D2 query
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] }); // resolveTenantId

    const result = await m.service.exchange(CALLER_PLATFORM, {
      audience: "atlas",
      subjectToken: undefined,
      workspaceId: "ws-1",
      orgId: "org-1",
    });

    expect(result).toEqual({
      accessToken: "signed.jwt.token",
      expiresIn: TOKEN_EXCHANGE_TTL_SECONDS,
    });
    expect(m.keys.sign).toHaveBeenCalledWith(
      {
        act: { sub: "console" },
        org_id: "org-1",
        tenant_id: "tenant-1",
        workspace_id: "ws-1",
        mode: "service",
        scope: "tool:atlas",
      },
      {
        audience: "atlas",
        expiresInSec: TOKEN_EXCHANGE_TTL_SECONDS,
        jwtid: expect.any(String),
      },
    );
    // target lookup + tenantId lookup + audit insert — no D2 coverage query (no caller product to check)
    expect(m.pool.query).toHaveBeenCalledTimes(3);
  });

  it("rejects a non-allowlisted platform-level caller (unchanged invalid_client behavior)", async () => {
    await expect(
      m.service.exchange(CALLER_PLATFORM_UNLISTED, {
        audience: "atlas",
        subjectToken: undefined,
        workspaceId: "ws-1",
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(m.keys.sign).not.toHaveBeenCalled();
  });

  it("rejects an allowlisted caller with no workspace_id declared", async () => {
    m.pool.query.mockResolvedValueOnce({ rows: [{ product_code: "atlas" }] });
    await expect(
      m.service.exchange(CALLER_PLATFORM, {
        audience: "atlas",
        subjectToken: undefined,
        workspaceId: undefined,
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(m.keys.sign).not.toHaveBeenCalled();
  });

  it("rejects an allowlisted caller with a missing audience", async () => {
    await expect(
      m.service.exchange(CALLER_PLATFORM, {
        audience: undefined,
        subjectToken: undefined,
        workspaceId: "ws-1",
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(m.pool.query).not.toHaveBeenCalled();
  });

  it("writes the audit row with the caller clientId (not a product code) and mode=service", async () => {
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "atlas" }] })
      .mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] }) // resolveTenantId
      .mockResolvedValueOnce({ rows: [] }); // audit insert

    await m.service.exchange(CALLER_PLATFORM, {
      audience: "atlas",
      subjectToken: undefined,
      workspaceId: "ws-1",
      orgId: undefined,
    });

    const audit = m.pool.query.mock.calls[2]!;
    expect(String(audit[0])).toContain("insert into support.audit_logs");
    expect(JSON.parse(audit[1][2])).toEqual({
      caller_product: "console",
      target_product: "atlas",
      mode: "service",
      workspace_id: "ws-1",
      org_id: null,
      tenant_id: "tenant-1",
    });
  });
});

describe("TokenExchangeService.exchange — operator-OBO mode (product_250 M-1)", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  const CALLER_ADMIN = { clientId: "admin", productCode: null };
  const operatorClaims = (over: Record<string, unknown> = {}) => ({
    sub: "opr_11111111-1111-1111-1111-111111111111",
    aud: "admin",
    userType: "operator",
    operator_role: "superadmin",
    amr: ["pwd", "otp"],
    ...over,
  });

  it("mints an operator management token for a platform-level workforce client", async () => {
    m.keys.verify.mockReturnValue(operatorClaims());
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "atlas" }] }) // resolveTargetProductCode
      .mockResolvedValueOnce({ rows: [] }); // audit insert

    const result = await m.service.exchange(CALLER_ADMIN, {
      audience: "atlas",
      subjectToken: "operator.subject.jwt",
      workspaceId: undefined,
      orgId: undefined,
    });

    expect(result.accessToken).toBe("signed.jwt.token");
    expect(result.expiresIn).toBe(TOKEN_EXCHANGE_TTL_SECONDS);
    const [claims, opts] = m.keys.sign.mock.calls[0]!;
    expect(claims).toMatchObject({
      act: { sub: "admin" },
      mode: "operator",
      userType: "operator",
      realm: "workforce",
      scope: "mgmt:atlas",
      operator_role: "superadmin",
      amr: ["pwd", "otp"],
    });
    expect(claims.org_id).toBeUndefined();
    expect(claims.workspace_id).toBeUndefined();
    expect(opts).toMatchObject({
      audience: "atlas",
      subject: "opr_11111111-1111-1111-1111-111111111111",
      expiresInSec: TOKEN_EXCHANGE_TTL_SECONDS,
    });
  });

  it("omits amr/operator_role claims when the subject token has none", async () => {
    m.keys.verify.mockReturnValue(
      operatorClaims({ amr: undefined, operator_role: undefined }),
    );
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "atlas" }] })
      .mockResolvedValueOnce({ rows: [] });

    await m.service.exchange(CALLER_ADMIN, {
      audience: "atlas",
      subjectToken: "operator.subject.jwt",
      workspaceId: undefined,
      orgId: undefined,
    });

    const [claims] = m.keys.sign.mock.calls[0]!;
    expect("amr" in claims).toBe(false);
    expect("operator_role" in claims).toBe(false);
  });

  it("enforces single-audience discipline: subject token minted for another client is refused", async () => {
    m.keys.verify.mockReturnValue(operatorClaims({ aud: "some-other-rp" }));
    await expect(
      m.service.exchange(CALLER_ADMIN, {
        audience: "atlas",
        subjectToken: "operator.subject.jwt",
        workspaceId: undefined,
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(m.keys.sign).not.toHaveBeenCalled();
  });

  it("refuses the platform sentinel audience for operator tokens", async () => {
    m.keys.verify.mockReturnValue(operatorClaims());
    await expect(
      m.service.exchange(CALLER_ADMIN, {
        audience: PLATFORM_S2S_AUDIENCE,
        subjectToken: "operator.subject.jwt",
        workspaceId: undefined,
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(m.keys.sign).not.toHaveBeenCalled();
  });

  it("a customer user token via a platform-level client still fails invalid_client (T1 unchanged)", async () => {
    m.keys.verify.mockReturnValue({
      sub: "usr_2",
      aud: "console",
      userType: "tenant_user",
      active_workspace: "ws-1",
    });
    await expect(
      m.service.exchange(CALLER_PLATFORM, {
        audience: "arda",
        subjectToken: "customer.subject.jwt",
        workspaceId: undefined,
        orgId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(m.keys.sign).not.toHaveBeenCalled();
  });

  it("writes the audit row with the workforce client as caller and mode=operator", async () => {
    m.keys.verify.mockReturnValue(operatorClaims());
    m.keys.sign.mockImplementation(
      (_claims: Record<string, unknown>, opts: { jwtid: string }) => {
        void opts.jwtid;
        return "signed.jwt.token";
      },
    );
    m.pool.query
      .mockResolvedValueOnce({ rows: [{ product_code: "atlas" }] })
      .mockResolvedValueOnce({ rows: [] });

    await m.service.exchange(CALLER_ADMIN, {
      audience: "atlas",
      subjectToken: "operator.subject.jwt",
      workspaceId: undefined,
      orgId: undefined,
    });

    const audit = m.pool.query.mock.calls[1]!;
    expect(String(audit[0])).toContain("insert into support.audit_logs");
    expect(JSON.parse(audit[1][2])).toMatchObject({
      caller_product: "admin",
      target_product: "atlas",
      mode: "operator",
    });
  });
});
