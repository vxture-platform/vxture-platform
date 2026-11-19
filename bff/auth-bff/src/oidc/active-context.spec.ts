/**
 * Current customer context must survive cross-product SSO and workspace changes.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { describe, expect, it, vi } from "vitest";
// ⚠️ 跨层引用: Exercise membership validation through the public domain service.
import {
  ActiveContextService,
  type OrganizationReadRepository,
} from "@vxture/service-organization";
import { RedisService } from "../redis/redis.service";
import { OidcService } from "./oidc.service";

// ============================================================================
// Session readers and real membership selection with isolated persistence
// ============================================================================
function fixture() {
  const data = new Map<string, string>();
  const raw = {
    status: "ready",
    hget: vi.fn(
      async (key: string, field: string) => data.get(`${key}:${field}`) ?? null,
    ),
  };
  const store = Object.create(RedisService.prototype) as RedisService;
  Object.assign(store, {
    prefix: "test:",
    client: raw,
  });
  data.set("test:sess:sid:org:product", "personal");
  data.set("test:sess:sid:ws:product", "personal-space");
  const workspace = (id: string) => ({ id, name: id });
  const repo = {
    listOrgMembershipsForUser: vi.fn(async () => [
      {
        organizationId: "personal",
        role: "owner",
        isDefault: true,
        organization: { type: "personal" },
      },
      {
        organizationId: "team",
        role: "member",
        organization: { type: "organization" },
      },
    ]),
    resolveWorkspaceForSession: vi.fn(
      async (org: string, _user: string, hint?: string) => ({
        workspace: workspace(
          org === "team"
            ? hint === "second"
              ? "second"
              : "team-default"
            : "personal-space",
        ),
        membershipRole: "member",
      }),
    ),
  };
  const redis = {
    getOidcSession: vi.fn(async () => ({
      realm: "customer",
      sub: "usr_user",
      authMethod: "password",
    })),
    getOidcActiveOrg: store.getOidcActiveOrg.bind(store),
    getOidcActiveWorkspace: store.getOidcActiveWorkspace.bind(store),
    setOidcActiveOrg: vi.fn(
      async (_sid: string, client: string, org: string) => {
        data.set(`test:sess:sid:org:${client}`, org);
      },
    ),
    setOidcActiveWorkspace: vi.fn(
      async (_sid: string, client: string, ws: string) => {
        data.set(`test:sess:sid:ws:${client}`, ws);
      },
    ),
    setOidcActiveContext: vi.fn(
      async (
        _sid: string,
        context: { orgId: string; workspaceId: string | null },
      ) => {
        data.set("test:sess:sid:active_context", JSON.stringify(context));
      },
    ),
  };
  const issueAuthCode = vi.fn(async () => "code");
  const service = Object.create(OidcService.prototype) as OidcService;
  Object.assign(service, {
    redis,
    activeContext: new ActiveContextService(
      repo as unknown as OrganizationReadRepository,
    ),
    clients: {
      findEnabledByClientId: async (clientId: string) => ({
        clientId,
        realm: "customer",
        allowedScopes: ["openid"],
        redirectUris: ["https://app.example/callback"],
      }),
    },
    durableSession: { isRevoked: async () => false },
    customerMfa: { enabled: async () => false },
    issueAuthCode,
  });
  const authorize = (
    clientId: string,
    hints: { tenantHint?: string; workspaceHint?: string } = {},
  ) =>
    service.authorize(
      {
        clientId,
        redirectUri: "https://app.example/callback",
        responseType: "code",
        scope: "openid",
        codeChallenge: "proof",
        codeChallengeMethod: "S256",
        prompt: "none",
        ...hints,
      },
      { tenant: "sid" },
    );
  return { authorize, redis, repo, store, data, issueAuthCode };
}

// ============================================================================
// Explicit selection outranks application history and login defaults
// ============================================================================
describe("current customer context", () => {
  it("carries a Console tenant switch into a product with an old personal selection", async () => {
    const f = fixture();
    await f.authorize("console", { tenantHint: "team" });
    await f.authorize("product");
    expect(f.issueAuthCode).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeOrg: "team" }),
    );
    expect(await f.store.getOidcActiveWorkspace("sid", "product")).toBe(
      "team-default",
    );
    expect(f.redis.setOidcActiveContext).toHaveBeenLastCalledWith("sid", {
      orgId: "team",
      workspaceId: "team-default",
    });
  });

  it("keeps the selected non-default workspace across applications", async () => {
    const f = fixture();
    await f.authorize("console", {
      tenantHint: "team",
      workspaceHint: "second",
    });
    await f.authorize("product");
    expect(await f.store.getOidcActiveOrg("sid", "product")).toBe("team");
    expect(await f.store.getOidcActiveWorkspace("sid", "product")).toBe(
      "second",
    );
    expect(f.repo.resolveWorkspaceForSession).toHaveBeenLastCalledWith(
      "team",
      "user",
      "second",
    );
  });

  it("revalidates an invalid hint instead of persisting an inaccessible tenant", async () => {
    const f = fixture();
    await f.authorize("console", {
      tenantHint: "not-a-member",
      workspaceHint: "foreign",
    });
    expect(f.redis.setOidcActiveContext).toHaveBeenCalledWith("sid", {
      orgId: "personal",
      workspaceId: "personal-space",
    });
  });

  it("does not revive an old per-client workspace when the current workspace is null", async () => {
    const f = fixture();
    f.data.set(
      "test:sess:sid:active_context",
      JSON.stringify({ orgId: "team", workspaceId: null }),
    );
    expect(await f.store.getOidcActiveWorkspace("sid", "product")).toBeNull();
  });
});
