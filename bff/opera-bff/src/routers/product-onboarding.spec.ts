/**
 * product-onboarding.spec.ts —— 产品接入合并保存（2026-09-14）。
 *
 * 钉三件事，每一件错了都不会有外在症状：
 *
 *  1. **step-up 按改动判。** 只改展示不要求二次验证；改登录回调 / 登出回跳白名单、
 *     scopes、PKCE，或签发新客户端，必须要——而且判定发生在**任何写之前**。判成
 *     「没触及」的表现是：不经二次验证改掉了回调白名单，接口回 200。
 *  2. **一个事务。** 任何一处被拒整笔回滚。此前详情页是两次串行 PUT，中间失败会留下
 *     「基本信息存上了、回调没存上」，而界面只报一次错。
 *  3. **密钥不从合并保存写。** 边缘写入的 SQL 里不出现密钥两列；密钥路由挂 step-up。
 */
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import type { OidcRpClient } from "@vxture/core-oidc-rp";
import { PRODUCT_TYPES } from "@vxture/core-utils";
import type { ApiError } from "../errors/api-error";
import type { RpRuntime } from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/request-context";

vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

import { REQUIRE_STEP_UP, stepUpCookieName } from "../auth/step-up.decorator";
import type {
  OidcClientRecord,
  ProductClientInput,
} from "./oidc-client.router";
import {
  planClients,
  ProductOnboardingRouter,
  type OnboardingBody,
} from "./product-onboarding.router";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-00000000000c";
const CALLBACK = "https://acme.vxture.com/api/auth/oidc/callback";
const LOGOUT = "https://acme.vxture.com/";

function record(over: Partial<OidcClientRecord> = {}): OidcClientRecord {
  return {
    id: "c-1",
    clientId: "acme",
    realm: "customer",
    productId: PRODUCT_ID,
    productCode: "acme",
    releaseChannel: "stable",
    name: "acme",
    displayName: "Acme",
    logoUrl: null,
    redirectUris: [CALLBACK],
    postLogoutRedirectUris: [LOGOUT],
    allowedScopes: ["openid", "profile"],
    pkceRequired: true,
    tokenEndpointAuthMethod: "client_secret_basic",
    state: "active",
    createdAt: "2026-09-14T00:00:00Z",
    updatedAt: "2026-09-14T00:00:00Z",
    ...over,
  };
}

/** 与 `record()` 同一个客户端的库行形状（snake_case），给 mock 的 SELECT 用。 */
function row(over: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    client_id: "acme",
    product_id: PRODUCT_ID,
    product_code: "acme",
    release_channel: "stable",
    name: "acme",
    display_name: "Acme",
    logo_url: null,
    redirect_uris: [CALLBACK],
    post_logout_redirect_uris: [LOGOUT],
    allowed_scopes: ["openid", "profile"],
    pkce_required: true,
    token_endpoint_auth_method: "client_secret_basic",
    status: "active",
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
    ...over,
  };
}

/** 保存里「原样送回」的那个客户端——与库里一致，不构成任何改动。 */
const UNCHANGED = {
  clientId: "acme",
  releaseChannel: "stable" as const,
  displayName: "Acme",
  logoUrl: null,
  redirectUris: [CALLBACK],
  postLogoutRedirectUris: [LOGOUT],
  allowedScopes: ["openid", "profile"],
  pkceRequired: true,
};

function envelope(error: unknown): {
  code?: string;
  field?: string;
  message?: string;
} {
  const res = (error as ApiError).getResponse?.();
  return (typeof res === "object" && res !== null ? res : {}) as {
    code?: string;
    field?: string;
    message?: string;
  };
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("预期抛出，但没有");
}

// ── planClients：判定本体 ────────────────────────────────────────────────────

describe("planClients —— 这次保存触及安全边界了吗", () => {
  it("只改展示名与 logo：不触及", () => {
    const plan = planClients(
      [{ ...UNCHANGED, displayName: "新名字", logoUrl: "https://cdn/x.png" }],
      [record()],
    );
    expect(plan.touchesSecurity).toBe(false);
    expect(plan.changes).toEqual([
      {
        index: 0,
        clientId: "acme",
        patch: { displayName: "新名字", logoUrl: "https://cdn/x.png" },
      },
    ]);
  });

  it("白名单是集合：调顺序、带重复不算改动", () => {
    const plan = planClients(
      [
        {
          ...UNCHANGED,
          redirectUris: [CALLBACK, CALLBACK],
          allowedScopes: ["profile", "openid"],
        },
      ],
      [record()],
    );
    expect(plan.touchesSecurity).toBe(false);
    expect(plan.changes).toEqual([]);
  });

  it.each([
    ["登录回调", { redirectUris: [CALLBACK, "https://evil.example/cb"] }],
    ["登出回跳", { postLogoutRedirectUris: ["https://evil.example/"] }],
    ["scopes", { allowedScopes: ["openid", "profile", "email"] }],
    ["PKCE", { pkceRequired: false }],
  ])("改%s：触及", (_label, change) => {
    const plan = planClients([{ ...UNCHANGED, ...change }], [record()]);
    expect(plan.touchesSecurity).toBe(true);
  });

  it("新渠道客户端：是签发凭证，触及", () => {
    const plan = planClients(
      [
        UNCHANGED,
        {
          clientId: "acme-beta",
          releaseChannel: "beta",
          redirectUris: [CALLBACK],
        },
      ],
      [record()],
    );
    expect(plan.touchesSecurity).toBe(true);
    expect(plan.creates.map((c) => c.index)).toEqual([1]);
  });

  it("渠道建后不可改", () => {
    const e = envelope(
      thrownBy(() =>
        planClients([{ ...UNCHANGED, releaseChannel: "beta" }], [record()]),
      ),
    );
    expect(e.code).toBe("VALIDATION_IMMUTABLE");
    expect(e.field).toBe("clients[0].releaseChannel");
  });

  it("认证方式建后不可改", () => {
    const e = envelope(
      thrownBy(() =>
        planClients(
          [{ ...UNCHANGED, tokenEndpointAuthMethod: "none" }],
          [record()],
        ),
      ),
    );
    expect(e.code).toBe("VALIDATION_IMMUTABLE");
    expect(e.field).toBe("clients[0].tokenEndpointAuthMethod");
  });

  it("同一渠道已有客户端时不能再建一个", () => {
    const e = envelope(
      thrownBy(() =>
        planClients(
          [UNCHANGED, { clientId: "acme-2", redirectUris: [CALLBACK] }],
          [record()],
        ),
      ),
    );
    expect(e.code).toBe("VALIDATION_CONFLICT");
    expect(e.field).toBe("clients[1].releaseChannel");
  });

  it("公共客户端不许关 PKCE——按库里的认证方式判，页面没送认证方式也一样", () => {
    const e = envelope(
      thrownBy(() =>
        planClients(
          [{ ...UNCHANGED, pkceRequired: false }],
          [record({ tokenEndpointAuthMethod: "none" })],
        ),
      ),
    );
    expect(e.code).toBe("VALIDATION_CONFLICT");
    expect(e.field).toBe("clients[0].pkceRequired");
  });
});

// ── 路由：事务、step-up 的时机、密钥两列 ─────────────────────────────────────

function makeRouter(
  opts: {
    readonly existing?: ReturnType<typeof row>[];
    readonly takenIds?: readonly string[];
    readonly failOn?: RegExp;
  } = {},
) {
  const statements: { text: string; args: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (text: string, args: unknown[] = []) => {
      statements.push({ text, args });
      if (opts.failOn?.test(text)) {
        throw Object.assign(new Error("boom"), { code: "XX000" });
      }
      if (/SELECT product_code FROM product\.products/.test(text)) {
        return { rows: [{ product_code: "acme" }], rowCount: 1 };
      }
      if (/SELECT product_code, status FROM product\.products/.test(text)) {
        return {
          rows: [{ product_code: "acme", status: "draft" }],
          rowCount: 1,
        };
      }
      if (/FROM appoidc\.oidc_clients c LEFT JOIN/.test(text)) {
        const rows = opts.existing ?? [row()];
        return { rows, rowCount: rows.length };
      }
      if (/SELECT client_id FROM appoidc\.oidc_clients/.test(text)) {
        const rows = (opts.takenIds ?? []).map((id) => ({ client_id: id }));
        return { rows, rowCount: rows.length };
      }
      if (/(UPDATE|INSERT INTO) product\.products/.test(text)) {
        return {
          rows: [{ id: PRODUCT_ID, product_code: "acme", surfaces: [] }],
          rowCount: 1,
        };
      }
      if (/INSERT INTO product\.product_webhooks/.test(text)) {
        return { rows: [{ has_secret: false }], rowCount: 1 };
      }
      if (/UPDATE appoidc\.oidc_clients c/.test(text)) {
        return { rows: [row()], rowCount: 1 };
      }
      if (/INSERT INTO appoidc\.oidc_clients/.test(text)) {
        return { rows: [row({ client_id: args[0] })], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client as unknown as PoolClient),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Pool;
  const oidcClient = {
    verifyAccessToken: vi.fn(async () => ({ stepup: true, sub: "opr_op-1" })),
  };
  const router = new ProductOnboardingRouter(
    pool,
    oidcClient as unknown as OidcRpClient,
    { cookieSecure: true } as unknown as RpRuntime,
  );
  const wrote = () =>
    statements.some((s) => /^\s*(UPDATE|INSERT)\b/.test(s.text));
  const said = (word: string) =>
    statements.some((s) => s.text.trim().toLowerCase() === word);
  return { router, statements, oidcClient, wrote, said };
}

function makeReq(withStepUp: boolean): Request & RequestContext {
  return {
    operator: { id: "op-1", displayName: null },
    capabilities: ["platform:product.manage"],
    operatorAccessToken: "operator-access-token",
    headers: {},
    cookies: withStepUp ? { [stepUpCookieName(true)]: "step-up-token" } : {},
  } as unknown as Request & RequestContext;
}

function body(clients: ProductClientInput[]): OnboardingBody {
  return {
    product: { productType: PRODUCT_TYPES[0], productName: "Acme" },
    edge: {
      edgeDomain: "acme.vxture.com",
      webhookUrl: "https://acme.vxture.com/api/webhooks/vxture",
    },
    clients,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("预期被拒，但成功了");
}

describe("PUT :id/onboarding —— 合并保存", () => {
  it("只改展示名：不要求二次验证，照常写入并提交", async () => {
    const t = makeRouter();
    await t.router.update(
      makeReq(false),
      PRODUCT_ID,
      body([{ ...UNCHANGED, displayName: "新名字" }]),
    );
    expect(t.oidcClient.verifyAccessToken).not.toHaveBeenCalled();
    expect(
      t.statements.some((s) => /UPDATE appoidc\.oidc_clients c/.test(s.text)),
    ).toBe(true);
    expect(t.said("commit")).toBe(true);
  });

  it("改登录回调却没有 step-up 凭证：在写任何东西之前被拒，整笔回滚", async () => {
    const t = makeRouter();
    const error = await rejection(
      t.router.update(
        makeReq(false),
        PRODUCT_ID,
        body([{ ...UNCHANGED, redirectUris: ["https://evil.example/cb"] }]),
      ),
    );
    expect(envelope(error).code).toBe("AUTH_STEP_UP_REQUIRED");
    expect(t.wrote(), "判定必须发生在任何写之前").toBe(false);
    expect(t.said("rollback")).toBe(true);
    expect(t.said("commit")).toBe(false);
  });

  it("改登录回调且凭证有效：写入", async () => {
    const t = makeRouter();
    await t.router.update(
      makeReq(true),
      PRODUCT_ID,
      body([{ ...UNCHANGED, redirectUris: [CALLBACK, `${CALLBACK}2`] }]),
    );
    expect(t.oidcClient.verifyAccessToken).toHaveBeenCalledTimes(1);
    expect(t.said("commit")).toBe(true);
  });

  it("新渠道客户端：client_secret 只回一次，库里只有哈希", async () => {
    const t = makeRouter();
    const result = await t.router.update(
      makeReq(true),
      PRODUCT_ID,
      body([
        UNCHANGED,
        {
          clientId: "acme-beta",
          releaseChannel: "beta",
          redirectUris: [CALLBACK],
        },
      ]),
    );
    expect(result.issuedSecrets).toHaveLength(1);
    const issued = result.issuedSecrets[0]!;
    expect(issued.clientId).toBe("acme-beta");
    expect(issued.clientSecret.length).toBeGreaterThanOrEqual(40);
    const insert = t.statements.find((s) =>
      /INSERT INTO appoidc\.oidc_clients/.test(s.text),
    )!;
    expect(insert.args[1]).not.toBe(issued.clientSecret);
    expect(String(insert.args[1])).toMatch(/^\$2[aby]\$/);
  });

  it("公共客户端不签发 secret", async () => {
    const t = makeRouter();
    const result = await t.router.update(
      makeReq(true),
      PRODUCT_ID,
      body([
        UNCHANGED,
        {
          clientId: "acme-desktop",
          releaseChannel: "canary",
          redirectUris: ["http://127.0.0.1/oauth/callback"],
          tokenEndpointAuthMethod: "none",
        },
      ]),
    );
    expect(result.issuedSecrets).toEqual([]);
    const insert = t.statements.find((s) =>
      /INSERT INTO appoidc\.oidc_clients/.test(s.text),
    )!;
    expect(insert.args[1]).toBeNull();
  });

  it("client_id 被占用：在 step-up 之前就按字段拒", async () => {
    const t = makeRouter({ takenIds: ["acme-beta"] });
    const error = await rejection(
      t.router.update(
        makeReq(false),
        PRODUCT_ID,
        body([
          UNCHANGED,
          {
            clientId: "acme-beta",
            releaseChannel: "beta",
            redirectUris: [CALLBACK],
          },
        ]),
      ),
    );
    expect(envelope(error).code).toBe("VALIDATION_CONFLICT");
    expect(envelope(error).field).toBe("clients[1].clientId");
    expect(t.oidcClient.verifyAccessToken).not.toHaveBeenCalled();
  });

  it("写到一半失败：整笔回滚，不提交", async () => {
    const t = makeRouter({ failOn: /INSERT INTO product\.product_webhooks/ });
    await rejection(
      t.router.update(
        makeReq(false),
        PRODUCT_ID,
        body([{ ...UNCHANGED, displayName: "新名字" }]),
      ),
    );
    expect(t.said("rollback")).toBe(true);
    expect(t.said("commit")).toBe(false);
  });

  it("边缘写入不碰密钥两列", async () => {
    const t = makeRouter();
    await t.router.update(makeReq(false), PRODUCT_ID, body([UNCHANGED]));
    const upsert = t.statements.find((s) =>
      /INSERT INTO product\.product_webhooks/.test(s.text),
    )!;
    const written = upsert.text.split("RETURNING")[0]!;
    expect(written).not.toMatch(/webhook_secret/);
  });
});

describe("路由上的 step-up 标注", () => {
  const reflector = new Reflector();

  it("密钥路由挂 step-up", () => {
    expect(
      reflector.get(
        REQUIRE_STEP_UP,
        ProductOnboardingRouter.prototype.setWebhookSecret,
      ),
    ).toBe(true);
  });

  it("合并保存不在路由上挂——按改动判，由 planClients 决定", () => {
    expect(
      reflector.get(REQUIRE_STEP_UP, ProductOnboardingRouter.prototype.update),
    ).toBeUndefined();
    expect(
      reflector.get(REQUIRE_STEP_UP, ProductOnboardingRouter.prototype.create),
    ).toBeUndefined();
  });
});
