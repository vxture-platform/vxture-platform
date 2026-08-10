/**
 * token-exchange.itest.spec.ts — live-DB integration test for T1 (product_210
 * §3, product_310 D11): proves the D2 coverage gate's SQL against a real
 * schema (subscription coverage, provisioned-state coverage, no coverage),
 * and that PgOidcClientRepository's product_id join resolves the seeded
 * `arda` client to `act.sub = "arda"` end to end.
 *
 * Gated (needs a seeded platform DB):
 *   AUTH_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { JwtService } from "@nestjs/jwt";
import { generateKeyPairSync } from "node:crypto";
import { PgOidcClientRepository } from "@vxture/service-iam";
import { OidcKeyService } from "./oidc-key.service";
import { TokenExchangeService } from "./token-exchange.service";

const RUN = process.env.AUTH_ITEST === "1";

const TENANT = "00000000-0000-4000-8000-0000000f0001";
const WS_SUBSCRIBED = "00000000-0000-4000-8000-0000000f0002";
const WS_PROVISIONED_ONLY = "00000000-0000-4000-8000-0000000f0003";
const WS_UNCOVERED = "00000000-0000-4000-8000-0000000f0004";
const USER = "00000000-0000-4000-8000-0000000f0005";

function rsaPrivatePem(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return privateKey;
}

describe.runIf(RUN)("T1 token exchange — D2 coverage gate (live DB)", () => {
  let pool: Pool;
  let clients: PgOidcClientRepository;
  let service: TokenExchangeService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    clients = new PgOidcClientRepository(pool);
    const config = {
      auth: {
        OIDC_ALGORITHM: "RS256" as const,
        OIDC_ISSUER: "https://auth.itest.local",
        OIDC_ACTIVE_KID: "t1-itest-kid",
        OIDC_SIGNING_PRIVATE_KEY: rsaPrivatePem(),
      },
    } as unknown as ConstructorParameters<typeof OidcKeyService>[0];
    const keys = new OidcKeyService(config, new JwtService({}));
    service = new TokenExchangeService(pool, keys);

    await pool.query(
      `insert into account.users (id, account, phone, phone_verified_at, source)
       values ($1, 't1-itest', '+8613800000481', now(), 'web')
       on conflict (id) do nothing`,
      [USER],
    );
    await pool.query(
      `insert into tenancy.tenants (id, name, type, owner_user_id)
       values ($1, 'T1 Org', 'organization', $2) on conflict (id) do nothing`,
      [TENANT, USER],
    );
    for (const ws of [WS_SUBSCRIBED, WS_PROVISIONED_ONLY, WS_UNCOVERED]) {
      await pool.query(
        `insert into tenancy.workspaces (id, tenant_id, name, is_default)
         values ($1, $2, 'T1 WS', false) on conflict (id) do nothing`,
        [ws, TENANT],
      );
    }
    // clean prior-run state
    await pool.query(
      `update metering.subscriptions set deleted_at = now()
        where workspace_id = any($1::uuid[]) and deleted_at is null`,
      [[WS_SUBSCRIBED, WS_PROVISIONED_ONLY, WS_UNCOVERED]],
    );
    await pool.query(
      `delete from provisioning.provisionings where workspace_id = any($1::uuid[])`,
      [[WS_SUBSCRIBED, WS_PROVISIONED_ONLY, WS_UNCOVERED]],
    );

    // WS_SUBSCRIBED: a real active arda subscription (D2 leg 1).
    const pv = await pool.query<{ id: string }>(
      `select pv.id from product.plan_versions pv
         join product.plans p on p.id = pv.plan_id
        where p.plan_code = 'arda-pro' and pv.is_locked = true`,
    );
    await pool.query(
      `insert into metering.subscriptions
         (id, tenant_id, workspace_id, plan_version_id, subscription_kind, cycle_unit, cycle_count,
          status, auto_renew, start_at, currency, created_by_type, created_by_id)
       values (gen_random_uuid(), $1, $2, $3, 'paid', 'month', 1,
               'active', true, now(), 'CNY', 'customer', $4)`,
      [TENANT, WS_SUBSCRIBED, pv.rows[0]!.id, USER],
    );

    // WS_PROVISIONED_ONLY: a bare provisioned row, no subscription (D2 leg 2).
    const ardaProductId = await pool.query<{ id: string }>(
      `select id from product.products where product_code = 'arda'`,
    );
    await pool.query(
      `insert into provisioning.provisionings
         (id, workspace_id, tenant_id, product_id, status, provisioned_at)
       values (gen_random_uuid(), $1, $2, $3, 'provisioned', now())`,
      [WS_PROVISIONED_ONLY, TENANT, ardaProductId.rows[0]!.id],
    );

    // WS_UNCOVERED: intentionally left with neither.
  });

  afterAll(async () => {
    await pool.end();
  });

  it("resolves the seeded arda client's product_code via the product_id join", async () => {
    const client = await clients.findEnabledByClientId("arda");
    expect(client?.productCode).toBe("arda");
  });

  it("service mode: subscription coverage mints a token", async () => {
    const result = await service.exchange(
      { clientId: "arda", productCode: "arda" },
      {
        audience: "runos",
        subjectToken: undefined,
        workspaceId: WS_SUBSCRIBED,
        orgId: undefined,
      },
    );
    expect(result.accessToken.split(".")).toHaveLength(3);
    expect(result.expiresIn).toBe(300);
  });

  it("service mode: provisioned-only coverage (no subscription) also mints", async () => {
    const result = await service.exchange(
      { clientId: "arda", productCode: "arda" },
      {
        audience: "runos",
        subjectToken: undefined,
        workspaceId: WS_PROVISIONED_ONLY,
        orgId: undefined,
      },
    );
    expect(result.accessToken.split(".")).toHaveLength(3);
  });

  it("service mode: no coverage at all → invalid_target (rejected)", async () => {
    await expect(
      service.exchange(
        { clientId: "arda", productCode: "arda" },
        {
          audience: "runos",
          subjectToken: undefined,
          workspaceId: WS_UNCOVERED,
          orgId: undefined,
        },
      ),
    ).rejects.toThrow();
  });

  it("rejects an audience with no matching active product row", async () => {
    await expect(
      service.exchange(
        { clientId: "arda", productCode: "arda" },
        {
          audience: "not-a-real-product",
          subjectToken: undefined,
          workspaceId: WS_SUBSCRIBED,
          orgId: undefined,
        },
      ),
    ).rejects.toThrow();
  });
});
