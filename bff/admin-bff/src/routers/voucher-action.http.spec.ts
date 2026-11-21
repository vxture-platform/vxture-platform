/**
 * voucher-action.http.spec.ts - Single-action HTTP writes and durable replay on disposable PostgreSQL.
 * @package @vxture/bff-admin
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import "reflect-metadata";
import { execFileSync } from "node:child_process";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// ⚠️ 跨层引用: Exercise the public RP verifier and cookie contract.
import { HttpOidcRpClient, rpSessionCookieName } from "@vxture/core-oidc-rp";
// ⚠️ 跨层引用: Supply isolated internal credentials and voucher claim keys.
import { VxConfigService } from "@vxture/core-config";
import { OperatorStepUpService } from "../auth/operator-stepup.service";
import { OperatorStepUpGuard } from "../auth/step-up.guard";
import { AuthMiddleware } from "../middleware/auth.middleware";
import { RP_OIDC_CLIENT, RP_RUNTIME } from "../oidc/oidc-rp.tokens";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import { CommercialRouter } from "./commercial.router";
import { OperatorStepUpRouter } from "./operator-stepup.router";

// ===========================================================================
// The local IdP fixture signs real JWTs; it does not assert production login/MFA.
// Auth's separate Redis suite tests the real shared grant implementation.
// ===========================================================================
describe.skipIf(process.env["VOUCHER_ACTION_ITEST"] !== "1")(
  "S03 single-action HTTP",
  () => {
    const runId = randomUUID(),
      container = `codex-voucher-s07-r3b-action-${runId.slice(0, 12)}`;
    const operator = "11111111-1111-4111-8111-111111111111",
      reviewer = "22222222-2222-4222-8222-222222222222";
    const internalToken = `isolated-${runId}`;
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const grants = new Map<string, { token: string; used: boolean }>();
    const apps: INestApplication[] = [],
      bases: string[] = [];
    let owner: Pool | undefined,
      runtime: Pool | undefined,
      server: Server | undefined;
    let containerId = "",
      issuer = "",
      tenant = "",
      abortNextConsumption = false,
      unavailable = false;
    const docker = (args: string[]) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }).trim();
    const sessionCookie = (session = "session-one") =>
      `${rpSessionCookieName(true, "admin")}=${session}`;
    function sign(payload: Record<string, unknown>) {
      const encode = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
      const data = `${encode({ alg: "RS256", kid: "s03" })}.${encode(payload)}`;
      return `${data}.${createSign("RSA-SHA256").update(data).end().sign(privateKey).toString("base64url")}`;
    }
    const command = () => ({
      idempotencyKey: randomUUID(),
      reason: "S03 verified action",
    });
    function batchInput() {
      return {
        ...command(),
        tenantId: tenant,
        kind: "credit_voucher",
        name: `S03 ${randomUUID()}`,
        effect: { amount_cents: 1000 },
        totalCount: 30,
        perUserLimit: 30,
        validFrom: new Date(Date.now() - 86400000).toISOString(),
        validUntil: new Date(Date.now() + 86400000).toISOString(),
      };
    }
    async function post(
      path: string,
      body: object,
      proof = "",
      session = "session-one",
      instance = 0,
    ) {
      return fetch(`${bases[instance]}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${sessionCookie(session)}${proof ? `; ${proof}` : ""}`,
        },
        body: JSON.stringify(body),
      });
    }
    async function authorize(
      path: string,
      body: object,
      session = "session-one",
    ) {
      const gate = await post(path, body, "", session);
      expect(gate.status).toBe(403);
      const rejected = (await gate.json()) as { stepUpAction: object };
      const response = await post(
        "/api/operator/step-up/totp",
        { code: "123456", action: rejected.stepUpAction },
        "",
        session,
      );
      expect(response.status).toBe(200);
      await response.json();
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toContain("__Host-vx_op_action=");
      return cookie!;
    }
    async function execute(
      path: string,
      body: object,
      session = "session-one",
    ) {
      const proof = await authorize(path, body, session);
      const response = await post(path, body, proof, session);
      expect(response.status).toBe(201);
      return {
        proof,
        result: (await response.json()) as Record<string, unknown>,
      };
    }
    async function reviewedBatch() {
      const input = batchInput(),
        path = "/api/commercial/voucher-batches";
      const created = await execute(path, input),
        id = String(created.result.batchId);
      const row = await owner!.query<{ revision: string }>(
        "select extract(epoch from updated_at)::text revision from promotion.voucher_batches where id=$1",
        [id],
      );
      const reviewPath = `${path}/${id}/actions`;
      const reviewBody = {
        ...command(),
        action: "review",
        expectedRevision: row.rows[0]!.revision,
      };
      const reviewed = await execute(reviewPath, reviewBody, "review-session");
      const replayed = await post(
        reviewPath,
        reviewBody,
        reviewed.proof,
        "review-session",
        1,
      );
      expect(replayed.status).toBe(201);
      expect(await replayed.json()).toEqual(reviewed.result);
      return id;
    }

    beforeAll(async () => {
      containerId = docker([
        "run",
        "--detach",
        "--pull=never",
        "--name",
        container,
        "--label",
        `codex.run=${runId}`,
        "--env",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "--publish",
        "127.0.0.1::5432",
        "postgres:18-alpine",
      ]);
      expect(containerId).toMatch(/^[a-f0-9]{64}$/);
      console.log(
        "S07_R3B_CONTAINER_OWNERSHIP=" +
          JSON.stringify({ id: containerId, name: container, runId }),
      );
      const owned = JSON.parse(docker(["inspect", containerId]))[0];
      expect(owned.Id).toBe(containerId);
      expect(owned.Config.Labels["codex.run"]).toBe(runId);
      expect(owned.HostConfig.PortBindings["5432/tcp"][0].HostIp).toBe(
        "127.0.0.1",
      );
      for (let attempt = 0; ; attempt++) {
        try {
          docker([
            "exec",
            container,
            "pg_isready",
            "-h",
            "127.0.0.1",
            "-U",
            "postgres",
          ]);
          break;
        } catch (error) {
          if (attempt === 40) throw error;
          await setTimeout(250);
        }
      }
      const connection = {
        host: "127.0.0.1",
        port: Number(docker(["port", container, "5432/tcp"]).split(":").at(-1)),
        database: "postgres",
      };
      owner = new Pool({ ...connection, user: "postgres" });
      const directory = fileURLToPath(
        new URL("../../../../deploy/database/ddl/", import.meta.url),
      );
      for (const file of readdirSync(directory)
        .filter((name) => /^\d.*\.sql$/.test(name))
        .sort())
        await owner.query(readFileSync(`${directory}/${file}`, "utf8"));
      await owner.query("alter role svc_admin_bff login");
      runtime = new Pool({ ...connection, user: "svc_admin_bff" });
      const user = randomUUID();
      tenant = randomUUID();
      await owner.query(
        "insert into account.users(id,account,phone,phone_verified_at) values ($1::uuid,$1::text,$2,now())",
        [user, `+${Date.now()}`],
      );
      await owner.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values ($1,'S03','organization',$2)",
        [tenant, user],
      );

      server = createServer(async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/oidc/jwks") {
          res.end(
            JSON.stringify({
              keys: [
                {
                  ...publicKey.export({ format: "jwk" }),
                  kid: "s03",
                  alg: "RS256",
                },
              ],
            }),
          );
          return;
        }
        if (req.headers["x-vxture-internal-auth"] !== internalToken) {
          res.statusCode = 401;
          res.end("{}");
          return;
        }
        let data = "";
        for await (const chunk of req) data += String(chunk);
        const body = JSON.parse(data) as {
          operatorId: string;
          action: object;
          stepUpToken: string;
        };
        if (req.url === "/internal/operator/stepup/totp") {
          const id = randomUUID(),
            now = Math.floor(Date.now() / 1000);
          const token = sign({
            iss: issuer,
            aud: "admin",
            sub: `opr_${body.operatorId}`,
            stepup: true,
            userType: "operator",
            amr: ["otp"],
            exp: now + 300,
            iat: now,
            jti: id,
            stepup_action: body.action,
          });
          grants.set(token, { token, used: false });
          res.end(JSON.stringify({ stepUpToken: token, expiresIn: 300 }));
          return;
        }
        if (req.url === "/internal/operator/stepup/consume") {
          if (unavailable) {
            res.statusCode = 503;
            res.end("{}");
            return;
          }
          const grant = grants.get(body.stepUpToken);
          if (!grant) {
            res.statusCode = 403;
            res.end("{}");
            return;
          }
          const mode = grant.used ? "replay" : "execute";
          grant.used = true;
          if (abortNextConsumption) {
            abortNextConsumption = false;
            res.destroy();
            return;
          }
          res.end(JSON.stringify({ mode }));
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      });
      await new Promise<void>((resolve) =>
        server!.listen(0, "127.0.0.1", resolve),
      );
      issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      vi.stubEnv("OIDC_BACKCHANNEL_ISSUER", issuer);
      const config = {
        issuer,
        clientId: "admin",
        clientSecret: "isolated",
        redirectUri: "https://admin.invalid/callback",
        scopes: ["openid"],
        sessionTtlSec: 3600,
      };
      const rt = { cookieSecure: true, config },
        verifier = new HttpOidcRpClient(config);
      const auth = {
        getCurrentUser: async (id: string) => ({
          id,
          name: "S03",
          email: "",
          roleLabel: "",
          roleCode: "",
          roleI18nKey: "",
          roleNameEn: "",
        }),
        getCapabilities: async () => [
          "admin.plane",
          "promotion:campaign.manage",
        ],
      };
      const rp = {
        resolve: async (rpsid: string) =>
          rpsid
            ? {
                status: "ok",
                rpsid,
                accessToken: "isolated-session-token",
                claims: {
                  sub: `opr_${rpsid === "review-session" ? reviewer : operator}`,
                  userType: "operator",
                },
              }
            : { status: "expired" },
      };
      @Module({
        controllers: [CommercialRouter, OperatorStepUpRouter],
        providers: [
          { provide: ADMIN_BFF_RO_POOL, useValue: runtime },
          { provide: ADMIN_BFF_RW_POOL, useValue: runtime },
          { provide: RP_OIDC_CLIENT, useValue: verifier },
          { provide: RP_RUNTIME, useValue: rt },
          {
            provide: VxConfigService,
            useValue: {
              auth: {
                IDP_INTERNAL_TOKEN: internalToken,
                VOUCHER_CLAIM_ACTIVE_KEY: "s03",
                VOUCHER_CLAIM_KEYS: JSON.stringify({ s03: "03".repeat(32) }),
              },
            },
          },
          OperatorStepUpService,
          { provide: APP_GUARD, useClass: OperatorStepUpGuard },
        ],
      })
      class TestModule {}
      for (let index = 0; index < 2; index++) {
        const app = await NestFactory.create(TestModule, { logger: false });
        apps.push(app);
        app.use(cookieParser());
        const middleware = new AuthMiddleware(
          auth as never,
          rp as never,
          rt as never,
        );
        app.use(middleware.use.bind(middleware));
        await app.listen(0, "127.0.0.1");
        bases.push(
          `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`,
        );
      }
    }, 60000);

    afterAll(async () => {
      try {
        await Promise.all(apps.map((app) => app.close()));
        if (server)
          await new Promise<void>((resolve, reject) =>
            server!.close((error) => (error ? reject(error) : resolve())),
          );
        await runtime?.end();
        await owner?.end();
      } finally {
        vi.unstubAllEnvs();
        if (containerId) {
          const info = JSON.parse(docker(["inspect", container])) as Array<{
            Id: string;
            Config: { Labels: Record<string, string> };
          }>;
          expect(info[0]!.Id).toBe(containerId);
          expect(info[0]!.Config.Labels["codex.run"]).toBe(runId);
          docker(["rm", "--force", "--volumes", containerId]);
          expect(
            docker([
              "ps",
              "-aq",
              "--no-trunc",
              "--filter",
              "name=^/" + container + "$",
            ]),
          ).toBe("");
          console.log("S07_R3B_CONTAINER_CLEANED=" + container);
        }
      }
    }, 60000);

    // ===========================================================================
    // Real guards, signatures, two RP instances and domain transactions.
    // ===========================================================================
    it("returns valid JSON null for a missing authenticated operation receipt", async () => {
      const response = await fetch(
        bases[0] +
          "/api/commercial/voucher-operations/" +
          randomUUID() +
          "?type=batch_create",
        {
          headers: { Cookie: sessionCookie() },
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toBeNull();
    });

    it("recovers creation after a lost response without creating another batch", async () => {
      const path = "/api/commercial/voucher-batches",
        body = batchInput();
      const first = await execute(path, body);
      const replay = await post(path, body, first.proof, "session-one", 1);
      expect(replay.status).toBe(201);
      expect(await replay.json()).toEqual(first.result);
      const rows = await owner!.query(
        "select id from promotion.voucher_operations where actor_id=$1 and idempotency_key=$2",
        [operator, body.idempotencyKey],
      );
      expect(rows.rows).toHaveLength(1);
    });

    it("rejects changing the session, parameters, target or request key", async () => {
      const path = "/api/commercial/voucher-batches",
        body = batchInput(),
        proof = await authorize(path, body);
      for (const changed of [
        { ...body, reason: "changed" },
        { ...body, idempotencyKey: randomUUID() },
        { ...body, totalCount: 31 },
        { ...body, tenantId: randomUUID() },
      ]) {
        const response = await post(path, changed, proof);
        expect(response.status).toBe(403);
        await response.json();
      }
      const otherSession = await post(path, body, proof, "session-two");
      expect(otherSession.status).toBe(403);
      await otherSession.json();
      const wrongRoute = await post(
        "/api/commercial/vouchers/assign",
        { ...body, batchId: randomUUID(), count: 1 },
        proof,
      );
      expect(wrongRoute.status).toBe(403);
      await wrongRoute.json();
      const accepted = await post(path, body, proof);
      expect(accepted.status).toBe(201);
      await accepted.json();
    });

    it("requires a new authorization for review and safely retries all five write routes", async () => {
      const id = await reviewedBatch(),
        issuePath = `/api/commercial/voucher-batches/${id}/issue`,
        issueBody = { ...command(), count: 2 };
      const issued = await execute(issuePath, issueBody);
      expect(issued.result.credentials).toHaveLength(2);
      const retry = await post(issuePath, issueBody, issued.proof);
      expect(retry.status).toBe(201);
      expect(await retry.json()).toMatchObject({
        credentials: [],
        replayed: true,
        voucherIds: issued.result.voucherIds,
      });
      const assignPath = "/api/commercial/vouchers/assign",
        assignBody = {
          ...command(),
          batchId: id,
          targetTenantId: tenant,
          count: 1,
        };
      const assigned = await execute(assignPath, assignBody);
      const assignRetry = await post(assignPath, assignBody, assigned.proof);
      expect(assignRetry.status).toBe(201);
      expect(await assignRetry.json()).toEqual(assigned.result);
      const revokePath = `/api/commercial/vouchers/${(issued.result.voucherIds as string[])[0]}/revoke`,
        revokeBody = command();
      const revoked = await execute(revokePath, revokeBody);
      const revokeRetry = await post(revokePath, revokeBody, revoked.proof);
      expect(revokeRetry.status).toBe(201);
      expect(await revokeRetry.json()).toEqual(revoked.result);
      const counts = await owner!.query(
        "select count(*)::int n from promotion.vouchers where batch_id=$1",
        [id],
      );
      expect(counts.rows[0].n).toBe(3);
    });

    it("concurrent retries across RP instances do not issue more vouchers", async () => {
      const id = await reviewedBatch(),
        path = `/api/commercial/voucher-batches/${id}/issue`,
        body = { ...command(), count: 2 },
        proof = await authorize(path, body);
      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          post(path, body, proof, "session-one", index % 2),
        ),
      );
      expect(responses.some((response) => response.status === 201)).toBe(true);
      for (const response of responses) {
        expect([201, 403]).toContain(response.status);
        await response.json();
      }
      const retry = await post(path, body, proof);
      expect(retry.status).toBe(201);
      expect(await retry.json()).toMatchObject({
        credentials: [],
        replayed: true,
      });
      const rows = await owner!.query(
        "select count(*)::int n from promotion.vouchers where batch_id=$1",
        [id],
      );
      expect(rows.rows[0].n).toBe(2);
    });

    it("does not execute when consumption is unavailable or its response is lost", async () => {
      const path = "/api/commercial/voucher-batches",
        body = batchInput(),
        proof = await authorize(path, body);
      unavailable = true;
      const denied = await post(path, body, proof);
      expect(denied.status).toBe(503);
      await denied.json();
      unavailable = false;
      abortNextConsumption = true;
      const lost = await post(path, body, proof);
      expect(lost.status).toBe(503);
      await lost.json();
      const replay = await post(path, body, proof);
      expect(replay.status).toBe(403);
      expect(await replay.json()).toMatchObject({
        message: "step_up_required",
        stepUpAction: expect.any(Object),
      });
      const rows = await owner!.query(
        "select id from promotion.voucher_operations where actor_id=$1 and idempotency_key=$2",
        [operator, body.idempotencyKey],
      );
      expect(rows.rows).toHaveLength(0);
      const fresh = await execute(path, body);
      expect(fresh.result.batchId).toEqual(expect.any(String));
    });
  },
);
