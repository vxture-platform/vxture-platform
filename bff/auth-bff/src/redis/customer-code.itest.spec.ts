/**
 * Purpose isolation, delivery failure and atomic consumption regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { createHash, randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VerifyCodeService } from "@vxture/service-mail";
import { RedisService } from "./redis.service";

const RUN = process.env.AUTH_ITEST === "1" && !!process.env.REDIS_ITEST_URL;
const PREFIX = `vxtest-customer-code-${randomUUID()}:`;

// ============================================================================
// Isolated real Redis; no provider calls
// ============================================================================
describe.runIf(RUN)("customer verification atomicity", () => {
  let raw: Redis;
  let store: RedisService;
  const emailHashes: string[] = [];
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const phone = "13800138000";
  beforeAll(async () => {
    const url = process.env.REDIS_ITEST_URL!;
    raw = new Redis(url);
    store = new RedisService({
      redis: { REDIS_URL: url, REDIS_KEY_PREFIX: PREFIX },
    } as never);
    await store.onModuleInit();
  });
  afterAll(async () => {
    const keys = await raw.keys(`${PREFIX}*`);
    for (const emailHash of emailHashes)
      keys.push(
        `vc:v2:code:customer-login:${emailHash}`,
        `vc:v2:rl:1m:${emailHash}`,
        `vc:v2:rl:1h:${emailHash}`,
        `vc:v2:rl:1d:${emailHash}`,
      );
    if (keys.length) await raw.del(...keys);
    await store.onModuleDestroy();
    await raw.quit();
  });
  async function begin(purpose: string, context = "", number = phone) {
    const owner = randomUUID();
    await raw.del(`${PREFIX}customer-code:rl:1m:${hash(number)}`);
    expect(await store.beginCustomerCode(purpose, number, context, owner)).toBe(
      true,
    );
    expect(
      await store.finishCustomerCodeSend(purpose, number, context, owner, true),
    ).toBe(true);
    return owner;
  }

  // ============================================================================
  // SMS purpose/owner isolation, attempts, concurrency, expiry and stale results
  // ============================================================================
  it("requires matching purpose and social owner", async () => {
    await begin("customer-social-bind", "binding-1");
    expect(
      await store.acquireCustomerCode("customer-login", phone, ""),
    ).toBeNull();
    expect(
      await store.acquireCustomerCode(
        "customer-social-bind",
        phone,
        "binding-2",
      ),
    ).toBeNull();
    expect(
      await store.acquireCustomerCode(
        "customer-social-bind",
        phone,
        "binding-1",
      ),
    ).toBeTruthy();
  });
  it("allows only one concurrent verifier and consumes only once", async () => {
    const owner = await begin("customer-login");
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        store.acquireCustomerCode("customer-login", phone, ""),
      ),
    );
    expect(results.filter(Boolean)).toEqual([owner]);
    expect(
      await store.finishCustomerCodeCheck(
        "customer-login",
        phone,
        "",
        owner,
        true,
      ),
    ).toBe(true);
    expect(
      await store.finishCustomerCodeCheck(
        "customer-login",
        phone,
        "",
        owner,
        true,
      ),
    ).toBe(false);
  });
  it("expires after five failed checks", async () => {
    const owner = await begin("customer-register");
    for (let i = 0; i < 5; i++) {
      expect(
        await store.acquireCustomerCode("customer-register", phone, ""),
      ).toBe(owner);
      await store.finishCustomerCodeCheck(
        "customer-register",
        phone,
        "",
        owner,
        false,
      );
    }
    expect(
      await store.acquireCustomerCode("customer-register", phone, ""),
    ).toBeNull();
  });
  it("a new binding dispatch invalidates an older provider check", async () => {
    const old = await begin("customer-social-bind", "old");
    expect(
      await store.acquireCustomerCode("customer-social-bind", phone, "old"),
    ).toBe(old);
    await begin("customer-social-bind", "new");
    expect(
      await store.finishCustomerCodeCheck(
        "customer-social-bind",
        phone,
        "old",
        old,
        true,
      ),
    ).toBe(false);
    expect(
      await store.acquireCustomerCode("customer-social-bind", phone, "old"),
    ).toBeNull();
    expect(
      await store.acquireCustomerCode("customer-social-bind", phone, "new"),
    ).toBeTruthy();
  });
  it("reserves one send across concurrent purposes and enforces TTL", async () => {
    const number = "13900139000";
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        store.beginCustomerCode(
          i % 2 ? "customer-login" : "customer-register",
          number,
          "",
          randomUUID(),
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const codeKeys = (await raw.keys(`${PREFIX}customer-code:*`)).filter(
      (k) => !k.includes(":rl:"),
    );
    for (const key of codeKeys) {
      expect(await raw.ttl(key)).toBeLessThanOrEqual(300);
      await raw.pexpire(key, 0);
    }
    expect(
      await store.acquireCustomerCode("customer-login", number, ""),
    ).toBeNull();
  });

  // ============================================================================
  // Email consumption, lockout, delivery failure and send reservation
  // ============================================================================
  function emailFixture(fail = false) {
    const address = `${randomUUID()}@example.com`;
    emailHashes.push(hash(address));
    let delivered = "";
    const mail = {
      sendVerifyCode: async (_email: string, code: string) => {
        delivered = code;
        if (fail) throw new Error("delivery failed");
      },
    };
    return {
      address,
      service: new VerifyCodeService(raw, mail as never),
      code: () => delivered,
    };
  }
  it("permits one concurrent email OTP consumer", async () => {
    const f = emailFixture();
    await f.service.sendCode(f.address, "customer-login");
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        f.service.verifyCode(f.address, f.code(), "customer-login"),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("locks out an email OTP after five wrong guesses", async () => {
    const f = emailFixture();
    await f.service.sendCode(f.address, "customer-login");
    const wrong = f.code() === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++)
      expect(
        await f.service.verifyCode(f.address, wrong, "customer-login"),
      ).toBe(false);
    expect(
      await f.service.verifyCode(f.address, f.code(), "customer-login"),
    ).toBe(false);
  });
  it("does not activate failed deliveries", async () => {
    const f = emailFixture(true);
    await expect(
      f.service.sendCode(f.address, "customer-login"),
    ).rejects.toThrow("delivery failed");
    expect(
      await f.service.verifyCode(f.address, f.code(), "customer-login"),
    ).toBe(false);
    expect(
      await raw.exists(`vc:v2:code:customer-login:${hash(f.address)}`),
    ).toBe(0);
  });
  it("reserves only one email dispatch across concurrent send requests", async () => {
    const f = emailFixture();
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, () =>
        f.service.sendCode(f.address, "customer-login"),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("does not use legacy codes and rejects expired purpose-scoped codes", async () => {
    const f = emailFixture();
    const legacy = `vc:code:${f.address}`;
    await raw.set(legacy, "123456", "EX", 60);
    try {
      expect(
        await f.service.verifyCode(f.address, "123456", "customer-login"),
      ).toBe(false);
    } finally {
      await raw.del(legacy);
    }
    await f.service.sendCode(f.address, "customer-login");
    const key = `vc:v2:code:customer-login:${hash(f.address)}`;
    expect(await raw.ttl(key)).toBeLessThanOrEqual(600);
    await raw.pexpire(key, 0);
    expect(
      await f.service.verifyCode(f.address, f.code(), "customer-login"),
    ).toBe(false);
  });
});
