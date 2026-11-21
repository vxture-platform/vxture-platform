/**
 * operator-stepup.itest.spec.ts - Shared failure budgets and OTP races on disposable Redis.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import "reflect-metadata";
import { execFileSync } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { AddressInfo } from "node:net";
import { setTimeout } from "node:timers/promises";
import {
  Module,
  ServiceUnavailableException,
  type INestApplication,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// ⚠️ 跨层引用: Use public MFA primitives with isolated encrypted factor fixtures.
import { generateTotp } from "@vxture/service-iam";
// ⚠️ 跨层引用: Inject isolated configuration into the real internal HTTP guard.
import { VxConfigService } from "@vxture/core-config";
import { OperatorMfaService } from "../oidc/operator-mfa.service";
import { deriveSecretKey, encryptSecret } from "../oidc/operator-secret-cipher";
import { OidcService } from "../oidc/oidc.service";
import { OidcKeyService } from "../oidc/oidc-key.service";
import { OperatorStepUpRouter } from "../routers/operator-stepup.router";
import { RedisService } from "./redis.service";

// ===========================================================================
// Never accept a configured Redis URL: this suite creates and verifies its target.
// ===========================================================================
describe.skipIf(process.env["OPERATOR_STEPUP_ITEST"] !== "1")(
  "S07-R3a disposable Redis protection",
  () => {
    const runId = randomUUID();
    const container = `codex-voucher-s07-r3a-${runId.slice(0, 12)}`;
    const prefix = `s07-r3a:${runId}:`;
    const encKey = randomBytes(32).toString("hex");
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptSecret(secret, deriveSecretKey(encKey));
    const internalToken = `isolated-internal-${runId}`;
    const stores: RedisService[] = [];
    const httpOperator = randomUUID();
    let containerId = "",
      raw: Redis | undefined;
    let primary: RedisService, replica: RedisService;
    let app: INestApplication | undefined, base: string;
    let connection: { host: string; port: number };
    let signingKey: string;
    const docker = (args: string[]) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }).trim();
    const budgetKey = (operator: string) =>
      `${prefix}operator:stepup:budget:${createHash("sha256").update(operator.toLowerCase()).digest("hex")}`;
    const digest = () =>
      createHash("sha256").update(randomUUID()).digest("hex");

    async function store() {
      const result = new RedisService({
        redis: {
          REDIS_HOST: connection.host,
          REDIS_PORT: connection.port,
          REDIS_KEY_PREFIX: prefix,
        },
      } as never);
      await result.onModuleInit();
      stores.push(result);
      return result;
    }
    function issuer(redis: RedisService) {
      const config = { auth: { OPERATOR_TOTP_ENC_KEY: encKey } };
      const mfa = new OperatorMfaService(
        {
          getTotpEnrollment: async () => ({ enabled: true, secret: encrypted }),
          getMfaContext: async () => ({
            platformDefault: "required",
            personalPolicy: "required",
            totpEnabled: true,
            webauthnCredentialCount: 0,
            webauthnRequired: false,
          }),
        } as never,
        config as never,
        redis,
      );
      const verify = vi.spyOn(mfa, "verifySecondFactor");
      const keys = new OidcKeyService(
        {
          auth: {
            OIDC_ALGORITHM: "RS256",
            OIDC_ISSUER: "https://isolated-issuer.example.test",
            OIDC_ACTIVE_KID: "isolated-stepup",
            OIDC_SIGNING_PRIVATE_KEY: signingKey,
          },
        } as never,
        new JwtService({}),
      );
      const sign = vi.spyOn(keys, "sign");
      const service = Object.create(OidcService.prototype) as OidcService;
      Object.assign(service, {
        config,
        redis,
        operatorMfa: mfa,
        keys,
        operatorAudit: {
          recordLoginAttempt: async () => {},
          recordAuditEvent: async () => {},
        },
        logger: { warn: vi.fn() },
      });
      return { service, sign, verify, keys };
    }
    function wrongCode() {
      const now = Math.floor(Date.now() / 1000);
      const accepted = new Set(
        [-30, 0, 30].map((offset) =>
          generateTotp(secret, { timestamp: now + offset }),
        ),
      );
      let candidate = 0;
      while (accepted.has(String(candidate).padStart(6, "0"))) candidate++;
      return String(candidate).padStart(6, "0");
    }

    beforeAll(async () => {
      signingKey = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      }).privateKey;
      expect(container).toMatch(/^codex-voucher-s07-r3a-[a-f0-9-]{12}$/);
      containerId = docker([
        "run",
        "--detach",
        "--pull=never",
        "--name",
        container,
        "--label",
        `codex.run=${runId}`,
        "--publish",
        "127.0.0.1::6379",
        "--tmpfs",
        "/data",
        "redis:7-alpine",
      ]);
      expect(containerId).toMatch(/^[a-f0-9]{64}$/);
      console.log(
        "S07_R3A_CONTAINER_OWNERSHIP=" +
          JSON.stringify({
            id: containerId,
            name: container,
            runId,
          }),
      );
      const info = JSON.parse(docker(["inspect", containerId]))[0];
      expect(info.Id).toBe(containerId);
      expect(info.Config.Labels["codex.run"]).toBe(runId);
      expect(info.HostConfig.PortBindings["6379/tcp"][0].HostIp).toBe(
        "127.0.0.1",
      );
      for (let attempt = 0; ; attempt++) {
        try {
          if (docker(["exec", container, "redis-cli", "ping"]) !== "PONG")
            throw new Error("Redis not ready");
          break;
        } catch (error) {
          if (attempt === 40) throw error;
          await setTimeout(250);
        }
      }
      connection = {
        host: "127.0.0.1",
        port: Number(docker(["port", container, "6379/tcp"]).split(":").at(-1)),
      };
      expect(connection.port).toBeGreaterThan(0);
      raw = new Redis({
        ...connection,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
      await raw.connect();
      primary = await store();
      replica = await store();
      const protectedIssuer = issuer(primary);
      @Module({
        controllers: [OperatorStepUpRouter],
        providers: [
          { provide: OidcService, useValue: protectedIssuer.service },
          {
            provide: VxConfigService,
            useValue: { auth: { IDP_INTERNAL_TOKEN: internalToken } },
          },
        ],
      })
      class TestModule {}
      app = await NestFactory.create(TestModule, { logger: false });
      await app.listen(0, "127.0.0.1");
      base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    }, 60000);

    afterAll(async () => {
      try {
        await app?.close();
        await Promise.all(stores.map((entry) => entry.onModuleDestroy()));
        raw?.disconnect();
      } finally {
        if (containerId) {
          // Re-check both immutable ID and ownership label before removing our target.
          expect(docker(["inspect", "--format", "{{.Id}}", container])).toBe(
            containerId,
          );
          expect(
            docker([
              "inspect",
              "--format",
              '{{ index .Config.Labels "codex.run" }}',
              container,
            ]),
          ).toBe(runId);
          docker(["rm", "--force", "--volumes", containerId]);
          expect(
            docker([
              "ps",
              "-aq",
              "--no-trunc",
              "--filter",
              `name=^/${container}$`,
            ]),
          ).toBe("");
          console.log(`S07_R3A_CONTAINER_CLEANED=${container}`);
        }
      }
    }, 60000);

    // ===========================================================================
    // Shared fixed-window accounting, including stale and duplicate completions.
    // ===========================================================================
    it("admits exactly five concurrent reservations across service instances", async () => {
      const operator = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          (index % 2 ? primary : replica).reserveOperatorStepUpAttempt(
            operator,
          ),
        ),
      );
      const admitted = results.filter((entry) => entry.attemptId);
      expect(admitted).toHaveLength(5);
      expect(new Set(admitted.map((entry) => entry.attemptId)).size).toBe(5);
      expect(
        results
          .filter((entry) => !entry.attemptId)
          .every((entry) => entry.retryAfter >= 1 && entry.retryAfter <= 900),
      ).toBe(true);
      expect(
        (await primary.reserveOperatorStepUpAttempt(operator.toUpperCase()))
          .attemptId,
      ).toBeNull();
    });

    it("success releases only its own slot and preserves previous failures and TTL", async () => {
      const operator = randomUUID();
      for (let index = 0; index < 4; index++) {
        const entry = await primary.reserveOperatorStepUpAttempt(operator);
        expect(
          await primary.finishOperatorStepUpAttempt(
            operator,
            entry.attemptId!,
            false,
          ),
        ).toBe(true);
      }
      await raw!.pexpire(budgetKey(operator), 2500);
      const entry = await primary.reserveOperatorStepUpAttempt(operator);
      expect(
        await replica.finishOperatorStepUpAttempt(
          operator,
          entry.attemptId!,
          true,
        ),
      ).toBe(true);
      expect(await raw!.hget(budgetKey(operator), "attempts")).toBe("4");
      expect(await raw!.pttl(budgetKey(operator))).toBeLessThanOrEqual(2500);
      expect(
        await primary.finishOperatorStepUpAttempt(
          operator,
          entry.attemptId!,
          true,
        ),
      ).toBe(false);
      expect(await raw!.hget(budgetKey(operator), "attempts")).toBe("4");
    });

    it("a stale completion cannot alter a new window or recreate an expired budget", async () => {
      const operator = randomUUID();
      const old = await primary.reserveOperatorStepUpAttempt(operator);
      await raw!.del(budgetKey(operator));
      expect(
        await primary.finishOperatorStepUpAttempt(
          operator,
          old.attemptId!,
          true,
        ),
      ).toBe(false);
      expect(await raw!.exists(budgetKey(operator))).toBe(0);
      const fresh = await replica.reserveOperatorStepUpAttempt(operator);
      expect(
        await primary.finishOperatorStepUpAttempt(
          operator,
          old.attemptId!,
          true,
        ),
      ).toBe(false);
      expect(await raw!.hget(budgetKey(operator), "attempts")).toBe("1");
      expect(
        await primary.finishOperatorStepUpAttempt(
          operator,
          fresh.attemptId!,
          true,
        ),
      ).toBe(true);
      expect(await raw!.exists(budgetKey(operator))).toBe(0);
    });

    it("does not clear another pending verification after success", async () => {
      const operator = randomUUID();
      const one = await primary.reserveOperatorStepUpAttempt(operator);
      const two = await replica.reserveOperatorStepUpAttempt(operator);
      expect(
        await primary.finishOperatorStepUpAttempt(
          operator,
          one.attemptId!,
          true,
        ),
      ).toBe(true);
      expect(await raw!.hget(budgetKey(operator), "attempts")).toBe("1");
      expect(
        await replica.finishOperatorStepUpAttempt(
          operator,
          two.attemptId!,
          false,
        ),
      ).toBe(true);
      expect(await raw!.hget(budgetKey(operator), "attempts")).toBe("1");
    });

    it("unlocks a later window and keeps another operator independent", async () => {
      const operator = randomUUID();
      await Promise.all(
        Array.from({ length: 5 }, () =>
          primary.reserveOperatorStepUpAttempt(operator),
        ),
      );
      expect(
        (await primary.reserveOperatorStepUpAttempt(operator)).attemptId,
      ).toBeNull();
      expect(
        (await replica.reserveOperatorStepUpAttempt(randomUUID())).attemptId,
      ).not.toBeNull();
      await raw!.pexpire(budgetKey(operator), 1);
      await setTimeout(20);
      expect(
        (await replica.reserveOperatorStepUpAttempt(operator)).attemptId,
      ).not.toBeNull();
    });

    it("rejects a budget without an expiry instead of silently repairing it", async () => {
      const operator = randomUUID();
      await raw!.hset(budgetKey(operator), "attempts", "1");
      await expect(
        primary.reserveOperatorStepUpAttempt(operator),
      ).rejects.toThrow("operator_stepup_unavailable");
      expect(await raw!.hget(budgetKey(operator), "attempts")).toBe("1");
    });

    it.each(["not-a-number", "-1", "1.5"])(
      "rejects a corrupted budget count %s without changing it",
      async (count) => {
        const operator = randomUUID();
        await raw!.hset(budgetKey(operator), "attempts", count);
        await raw!.expire(budgetKey(operator), 900);
        await expect(
          primary.reserveOperatorStepUpAttempt(operator),
        ).rejects.toThrow("operator_stepup_unavailable");
        expect(await raw!.hget(budgetKey(operator), "attempts")).toBe(count);
      },
    );

    it("refuses to complete a reservation after its count or expiry is corrupted", async () => {
      const operator = randomUUID();
      const { attemptId } =
        await primary.reserveOperatorStepUpAttempt(operator);
      await raw!.hset(budgetKey(operator), "attempts", "0");
      await expect(
        primary.finishOperatorStepUpAttempt(operator, attemptId!, true),
      ).rejects.toThrow("operator_stepup_unavailable");
      expect(await raw!.hget(budgetKey(operator), `pending:${attemptId}`)).toBe(
        "1",
      );
      await raw!.hset(budgetKey(operator), "attempts", "1");
      await raw!.persist(budgetKey(operator));
      await expect(
        primary.finishOperatorStepUpAttempt(operator, attemptId!, true),
      ).rejects.toThrow("operator_stepup_unavailable");
      expect(await raw!.hget(budgetKey(operator), `pending:${attemptId}`)).toBe(
        "1",
      );
    });

    it("consumes a fingerprint once across replicas without refreshing its deadline", async () => {
      const proof = digest();
      const results = await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
          (index % 2 ? primary : replica).consumeOperatorStepUpTotp(proof),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const key = `${prefix}operator:stepup:used:${proof}`;
      expect(await raw!.ttl(key)).toBeGreaterThanOrEqual(89);
      expect(await raw!.ttl(key)).toBeLessThanOrEqual(90);
      await raw!.pexpire(key, 2500);
      expect(await primary.consumeOperatorStepUpTotp(proof)).toBe(false);
      expect(await raw!.pttl(key)).toBeLessThanOrEqual(2500);
      expect(await raw!.get(key)).toBe("1");
    });

    it("consumes an action exactly once across replicas and preserves its expiry", async () => {
      const id = randomUUID(),
        binding = digest();
      await primary.storeOperatorStepUpAction(id, binding);
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          (i % 2 ? primary : replica).consumeOperatorStepUpAction(id, binding),
        ),
      );
      expect(results.filter((mode) => mode === "execute")).toHaveLength(1);
      expect(results.filter((mode) => mode === "replay")).toHaveLength(39);
      const key = `${prefix}operator:stepup:action:${id}`;
      await raw!.pexpire(key, 2500);
      expect(await replica.consumeOperatorStepUpAction(id, binding)).toBe(
        "replay",
      );
      expect(await raw!.pttl(key)).toBeLessThanOrEqual(2500);
      expect(
        await primary.consumeOperatorStepUpAction(id, digest()),
      ).toBeNull();
      await raw!.del(key);
      expect(await primary.consumeOperatorStepUpAction(id, binding)).toBeNull();
      expect(await raw!.exists(key)).toBe(0);
    });

    it("rejects a non-expiring or expired positive action grant", async () => {
      const id = randomUUID(),
        binding = digest(),
        key = `${prefix}operator:stepup:action:${id}`;
      await raw!.set(key, `issued:${binding}`);
      expect(await primary.consumeOperatorStepUpAction(id, binding)).toBeNull();
      await raw!.pexpire(key, 1);
      await setTimeout(20);
      expect(await primary.consumeOperatorStepUpAction(id, binding)).toBeNull();
    });

    // ===========================================================================
    // Real TOTP verification followed by shared protection and signing boundary.
    // ===========================================================================
    it("runs real TOTP issuance and shared single-action consumption together", async () => {
      const one = issuer(primary),
        operatorId = randomUUID();
      const action = { sessionHash: digest(), requestHash: digest() };
      const result = await one.service.issueOperatorStepUp({
        operatorId,
        method: "totp",
        code: generateTotp(secret),
        action,
      });
      expect(result).not.toBeNull();
      const input = {
        operatorId,
        stepUpToken: result!.stepUpToken,
        action,
        audience: "admin",
      };
      expect(await one.service.consumeOperatorStepUp(input)).toEqual({
        mode: "execute",
      });
      expect(await one.service.consumeOperatorStepUp(input)).toEqual({
        mode: "replay",
      });
      const tokenId = one.sign.mock.calls[0]![1].jwtid;
      await raw!.del(`${prefix}operator:stepup:action:${tokenId}`);
      await expect(one.service.consumeOperatorStepUp(input)).rejects.toThrow(
        "step_up_required",
      );
    });

    it("mints exactly one proof when the same valid code races across RPs", async () => {
      const operatorId = randomUUID(),
        code = generateTotp(secret);
      const one = issuer(primary),
        two = issuer(replica);
      const results = await Promise.allSettled(
        Array.from({ length: 16 }, (_, index) =>
          (index % 2 ? one : two).service.issueOperatorStepUp({
            operatorId,
            code,
            method: "totp",
            audience: index % 2 ? "admin" : "opera",
          }),
        ),
      );
      expect(
        results.filter(
          (entry) => entry.status === "fulfilled" && entry.value !== null,
        ),
      ).toHaveLength(1);
      expect(one.sign.mock.calls.length + two.sign.mock.calls.length).toBe(1);
    });

    it("does not remint after response loss, case changes or switching RPs", async () => {
      const operatorId = randomUUID(),
        code = generateTotp(secret);
      const one = issuer(primary),
        two = issuer(replica);
      expect(
        await one.service.issueOperatorStepUp({
          operatorId,
          code,
          method: "totp",
        }),
      ).not.toBeNull();
      expect(
        await two.service.issueOperatorStepUp({
          operatorId: operatorId.toUpperCase(),
          code: `${code.slice(0, 3)} ${code.slice(3)}`,
          method: "totp",
          audience: "opera",
        }),
      ).toBeNull();
      expect(two.sign).not.toHaveBeenCalled();
    });

    it("keeps codes belonging to different operators independent", async () => {
      const one = issuer(primary),
        code = generateTotp(secret);
      expect(
        await one.service.issueOperatorStepUp({
          operatorId: randomUUID(),
          code,
          method: "totp",
        }),
      ).not.toBeNull();
      expect(
        await one.service.issueOperatorStepUp({
          operatorId: randomUUID(),
          code,
          method: "totp",
        }),
      ).not.toBeNull();
      expect(one.sign).toHaveBeenCalledTimes(2);
    });

    it("counts five incorrect codes and blocks the correct sixth before factor verification", async () => {
      const operatorId = randomUUID(),
        one = issuer(primary);
      for (let index = 0; index < 5; index++)
        expect(
          await one.service.issueOperatorStepUp({
            operatorId,
            code: wrongCode(),
            method: "totp",
          }),
        ).toBeNull();
      await expect(
        one.service.issueOperatorStepUp({
          operatorId,
          code: generateTotp(secret),
          method: "totp",
        }),
      ).rejects.toThrow("too_many_attempts");
      expect(one.verify).toHaveBeenCalledTimes(5);
      expect(one.sign).not.toHaveBeenCalled();
    });

    it("fails closed after a real protection connection is closed", async () => {
      const closed = await store();
      await closed.onModuleDestroy();
      stores.splice(stores.indexOf(closed), 1);
      const one = issuer(closed);
      await expect(
        one.service.issueOperatorStepUp({
          operatorId: randomUUID(),
          code: generateTotp(secret),
          method: "totp",
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(one.verify).not.toHaveBeenCalled();
      expect(one.sign).not.toHaveBeenCalled();
      await expect(
        closed.consumeOperatorStepUpTotp(digest()),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        closed.storeOperatorStepUpAction(randomUUID(), digest()),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        closed.consumeOperatorStepUpAction(randomUUID(), digest()),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it("enforces the lockout over real internal HTTP", async () => {
      const post = (code: string) =>
        fetch(`${base}/internal/operator/stepup/totp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-vxture-internal-auth": internalToken,
          },
          body: JSON.stringify({ operatorId: httpOperator, code }),
        });
      for (let index = 0; index < 5; index++) {
        const response = await post(wrongCode());
        expect(response.status).toBe(401);
        await response.json();
      }
      const response = await post(generateTotp(secret));
      expect(response.status).toBe(429);
      const body = (await response.json()) as {
        message: string;
        retryAfter: number;
      };
      expect(body.retryAfter).toBeGreaterThanOrEqual(1);
      expect(body.retryAfter).toBeLessThanOrEqual(900);
      expect(body.message).toContain("too_many_attempts");
    });

    // ===========================================================================
    // Real signatures, protected HTTP, and caller binding before Redis consumption.
    // ===========================================================================
    it("guards both internal endpoints before accepting proof data", async () => {
      for (const endpoint of ["totp", "consume"]) {
        for (const token of [undefined, "isolated-product-face-key"]) {
          const response = await fetch(
            `${base}/internal/operator/stepup/${endpoint}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { "x-vxture-internal-auth": token } : {}),
              },
              body: JSON.stringify({}),
            },
          );
          expect(response.status).toBe(401);
          await response.json();
        }
      }
    });

    it("executes exactly once over real HTTP and rejects changed bindings or signatures", async () => {
      const post = (endpoint: string, body: unknown) =>
        fetch(`${base}/internal/operator/stepup/${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-vxture-internal-auth": internalToken,
          },
          body: JSON.stringify(body),
        });
      const operatorId = randomUUID(),
        action = { sessionHash: digest(), requestHash: digest() };
      const issued = await post("totp", {
        operatorId,
        code: generateTotp(secret),
        action,
      });
      expect(issued.status).toBe(200);
      const { stepUpToken, expiresIn } = (await issued.json()) as {
        stepUpToken: string;
        expiresIn: number;
      };
      expect(expiresIn).toBe(300);
      expect(stepUpToken.split(".")).toHaveLength(3);
      const request = { operatorId, stepUpToken, action, audience: "admin" };
      for (const override of [
        { operatorId: randomUUID() },
        { audience: "opera" },
        { action: { ...action, sessionHash: digest() } },
        { action: { ...action, requestHash: digest() } },
        { stepUpToken: stepUpToken.slice(0, -10) + "tamperedXX" },
        { stepUpToken: 42 },
      ]) {
        const response = await post("consume", { ...request, ...override });
        expect(response.status).toBe(403);
        await response.json();
      }
      const results = await Promise.all(
        Array.from({ length: 24 }, async () => {
          const response = await post("consume", request);
          expect(response.status).toBe(200);
          return ((await response.json()) as { mode: string }).mode;
        }),
      );
      expect(results.filter((mode) => mode === "execute")).toHaveLength(1);
      expect(results.filter((mode) => mode === "replay")).toHaveLength(23);
    });

    it("rejects expired real signatures without spending a positive grant", async () => {
      const one = issuer(primary),
        operatorId = randomUUID(),
        id = randomUUID();
      const action = { sessionHash: digest(), requestHash: digest() };
      const proof = one.keys.sign(
        { stepup: true, userType: "operator", stepup_action: action },
        {
          subject: `opr_${operatorId}`,
          audience: "admin",
          jwtid: id,
          expiresInSec: -1,
        },
      );
      await primary.storeOperatorStepUpAction(id, digest());
      await expect(
        one.service.consumeOperatorStepUp({
          operatorId,
          audience: "admin",
          action,
          stepUpToken: proof,
        }),
      ).rejects.toThrow("step_up_required");
      expect(await raw!.get(`${prefix}operator:stepup:action:${id}`)).toMatch(
        /^issued:/,
      );
    });
  },
);
