/**
 * Atomic session status against real Redis, including expiry and logout races.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-21
 */
import "reflect-metadata";
import Redis from "ioredis";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VxConfigService } from "@vxture/core-config";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisService } from "./redis.service";
import { OidcService } from "../oidc/oidc.service";
import { OidcRouter } from "../routers/oidc.router";

// ── Isolated synthetic sessions; no production identifiers or data ──

const run = process.env.AUTH_ITEST === "1" && !!process.env.REDIS_ITEST_URL;
describe.runIf(run)("central session status (live Redis)", () => {
  const prefix = `vxtest-status-${randomUUID()}:`;
  const url = process.env.REDIS_ITEST_URL ?? "";
  const service = new RedisService({
    redis: { REDIS_URL: url, REDIS_KEY_PREFIX: prefix },
  } as unknown as ConstructorParameters<typeof RedisService>[0]);
  const raw = new Redis(url);
  const oidc = Object.assign(
    Object.create(OidcService.prototype) as OidcService,
    {
      redis: service,
      clients: {
        findEnabledByClientId: async (clientId: string) => ({
          clientId,
          realm: "customer",
          tokenEndpointAuthMethod: "client_secret_basic",
        }),
        authenticateClient: async (clientId: string, secret: string) =>
          secret === "synthetic-secret"
            ? {
                clientId,
                realm: "customer",
                tokenEndpointAuthMethod: "client_secret_basic",
              }
            : null,
      },
    },
  );
  @Module({
    controllers: [OidcRouter],
    providers: [
      { provide: OidcService, useValue: oidc },
      { provide: VxConfigService, useValue: {} },
    ],
  })
  class LiveStatusModule {}
  let app: INestApplication;
  let base: string;
  const key = (sid: string) => `${prefix}sess:${sid}`;
  const current = async () => Number((await raw.time())[0]);
  const seed = async (
    overrides: {
      realm?: string;
      absExpiresAt?: number;
      ttl?: number;
      client?: string;
    } = {},
  ) => {
    const sid = randomUUID();
    const now = await current();
    await service.createOidcSession(
      sid,
      {
        sub: "synthetic-user",
        realm: overrides.realm ?? "customer",
        authMethod: "password",
        createdAt: now - 60,
        lastActiveAt: now - 60,
        absExpiresAt: overrides.absExpiresAt ?? now + 3600,
      },
      overrides.ttl ?? 3600,
    );
    await service.addOidcSessionClient(sid, overrides.client ?? "yucer");
    return sid;
  };
  const check = (
    sid: string,
    active = false,
    client = "yucer",
    realm = "customer",
  ) => service.checkOidcSessionStatus(sid, client, realm, active);

  beforeAll(async () => {
    await service.onModuleInit();
    app = await NestFactory.create(LiveStatusModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app?.close();
    const keys = await raw.keys(`${prefix}*`);
    if (keys.length) await raw.del(...keys);
    await service.onModuleDestroy();
    await raw.quit();
  });

  // ── Client/realm binding and deadline semantics ──

  it("returns no identity and a server deadline within five minutes", async () => {
    const sid = await seed();
    const before = await current();
    const result = await check(sid);
    expect(result).toEqual({ valid: true, next_check_at: expect.any(Number) });
    if (!result.valid) throw new Error("Expected live session");
    expect(result.next_check_at).toBeGreaterThan(before);
    expect(result.next_check_at).toBeLessThanOrEqual((await current()) + 300);
  });

  it("rejects another client, cross-realm use and missing binding without writing activity", async () => {
    const sid = await seed();
    const before = await raw.hgetall(key(sid));
    expect(await check(sid, true, "another")).toEqual({ valid: false });
    expect(await check(sid, true, "yucer", "workforce")).toEqual({
      valid: false,
    });
    await raw.del(`${key(sid)}:clients`);
    expect(await check(sid, true)).toEqual({ valid: false });
    expect(await raw.hgetall(key(sid))).toEqual(before);
  });

  it("supports a bound workforce client without customer-context maps", async () => {
    const sid = await seed({ realm: "workforce", client: "admin" });
    expect((await check(sid, false, "admin", "workforce")).valid).toBe(true);
    expect(await raw.exists(`${key(sid)}:org`)).toBe(0);
  });

  it("caps the deadline at absolute expiry or the shorter existing TTL", async () => {
    const expiry = (await current()) + 50;
    const absolute = await seed({ absExpiresAt: expiry });
    expect(await check(absolute)).toEqual({
      valid: true,
      next_check_at: expiry,
    });
    const short = await seed({ ttl: 20 });
    const result = await check(short);
    if (!result.valid) throw new Error("Expected live session");
    expect(result.next_check_at).toBeLessThanOrEqual((await current()) + 20);
  });

  it("leaves both activity and TTL unchanged on background reads", async () => {
    const sid = await seed();
    const before = await raw.hgetall(key(sid));
    const expires = await raw.pexpiretime(key(sid));
    await check(sid, false);
    expect(await raw.hgetall(key(sid))).toEqual(before);
    expect(await raw.pexpiretime(key(sid))).toBe(expires);
  });

  it("records activity monotonically without extending either expiry", async () => {
    const sid = await seed();
    const absolute = await raw.hget(key(sid), "absExpiresAt");
    const expires = await raw.pexpiretime(key(sid));
    const before = await current();
    await check(sid, true);
    expect(
      Number(await raw.hget(key(sid), "lastActiveAt")),
    ).toBeGreaterThanOrEqual(before);
    expect(await raw.pexpiretime(key(sid))).toBe(expires);
    expect(await raw.hget(key(sid), "absExpiresAt")).toBe(absolute);
    await raw.hset(key(sid), "lastActiveAt", before + 10);
    await check(sid, true);
    expect(Number(await raw.hget(key(sid), "lastActiveAt"))).toBe(before + 10);
  });

  // ── Expiry, corruption and concurrent logout ──

  it("does not resurrect unknown, revoked, physically expired or absolutely expired sessions", async () => {
    expect(await check(randomUUID(), true)).toEqual({ valid: false });
    const revoked = await seed();
    await service.deleteOidcSession(revoked);
    expect(await check(revoked, true)).toEqual({ valid: false });
    expect(await raw.exists(key(revoked))).toBe(0);
    const expired = await seed();
    await raw.pexpireat(key(expired), Date.now() - 1000);
    expect(await check(expired, true)).toEqual({ valid: false });
    const absolute = await seed({ absExpiresAt: (await current()) - 1 });
    const before = await raw.hget(key(absolute), "lastActiveAt");
    expect(await check(absolute, true)).toEqual({ valid: false });
    expect(await raw.hget(key(absolute), "lastActiveAt")).toBe(before);
  });

  it.each(["absExpiresAt", "lastActiveAt", "sub", "realm", "ttl"])(
    "reports corrupt %s as unavailable, not ended",
    async (field) => {
      const sid = await seed();
      if (field === "ttl") await raw.persist(key(sid));
      else if (field === "sub") await raw.hdel(key(sid), field);
      else await raw.hset(key(sid), field, "corrupt");
      await expect(check(sid, true)).rejects.toMatchObject({ status: 503 });
    },
  );

  it("cannot recreate a session when activity checks race logout", async () => {
    const sid = await seed();
    await Promise.all([
      ...Array.from({ length: 15 }, () => check(sid, true)),
      service.deleteOidcSession(sid),
      ...Array.from({ length: 15 }, () => check(sid, true)),
    ]);
    expect(await raw.exists(key(sid))).toBe(0);
    expect(await check(sid, true)).toEqual({ valid: false });
  });

  it("does not infer central-session death from refresh-chain failure", async () => {
    const sid = await seed();
    // No refresh token is required or consulted by the central-session query.
    expect((await check(sid)).valid).toBe(true);
  });

  it("reports a disconnected store as unavailable instead of valid:false", async () => {
    const disconnected = new RedisService({
      redis: { REDIS_URL: url, REDIS_KEY_PREFIX: prefix },
    } as unknown as ConstructorParameters<typeof RedisService>[0]);
    await disconnected.onModuleInit();
    await disconnected.onModuleDestroy();
    await expect(
      disconnected.checkOidcSessionStatus(
        randomUUID(),
        "yucer",
        "customer",
        false,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("serves the existing product request shape through real HTTP and Redis", async () => {
    const sid = await seed();
    const expires = await raw.pexpiretime(key(sid));
    const query = (client: string) =>
      fetch(`${base}/oidc/session/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${client}:synthetic-secret`).toString("base64")}`,
        },
        body: JSON.stringify({ sid, active: true }),
      });
    const first = await query("yucer");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      valid: true,
      next_check_at: expect.any(Number),
    });
    expect(await raw.pexpiretime(key(sid))).toBe(expires);
    expect(await (await query("other-product")).json()).toEqual({
      valid: false,
    });
    await service.deleteOidcSession(sid);
    expect(await (await query("yucer")).json()).toEqual({ valid: false });
    expect(await raw.exists(key(sid))).toBe(0);
  });
});
