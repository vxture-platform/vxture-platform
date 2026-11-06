/**
 * Loopback IdP and injectable storage for real HTTP authentication regressions.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import "reflect-metadata";
import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Redis } from "ioredis";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadConfig } from "../config";
import { configureHttp } from "../bootstrap";
import { CONFIG } from "../tokens";
import { ApiRouter } from "../api-router";
import { CatalogService } from "../catalog-service";
import { ScopeService } from "../scope-service";
import { AuthRouter } from "./auth-router";
import { SessionStore, type Session } from "./session-store";
import { SessionService } from "./session-service";
import { WorkbenchOidcClient } from "./oidc-client";

export const USER = "usr_00000000-0000-4000-8000-000000000001";
export const ORG = "00000000-0000-4000-8000-000000000002";
export const WORKSPACE = "00000000-0000-4000-8000-000000000003";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

// ============================================================================
// Test doubles model storage contracts, not Redis Lua execution.
// ============================================================================
class RequestStorage {
  readonly values = new Map<string, string>();
  async setex(key: string, _ttl: number, value: string): Promise<string> {
    this.values.set(key, value);
    return "OK";
  }
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async getdel(key: string): Promise<string | null> {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
}

export class MemoryStore extends SessionStore {
  readonly records = new Map<string, string>();
  readonly revokedSids = new Set<string>();
  readonly locks = new Map<string, string>();
  override async create(id: string, value: Session): Promise<void> {
    if (this.revokedSids.has(value.sid)) throw new Error("Revoked session");
    this.records.set(id, JSON.stringify(value));
  }
  override async read(
    id: string,
  ): Promise<{ raw: string; session: Session } | null> {
    const raw = this.records.get(id);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    return this.revokedSids.has(session.sid) ||
      session.expiresAt <= Date.now() / 1000
      ? null
      : { raw, session };
  }
  override async update(
    id: string,
    raw: string,
    value: Session,
  ): Promise<boolean> {
    if (this.records.get(id) !== raw || this.revokedSids.has(value.sid))
      return false;
    this.records.set(id, JSON.stringify(value));
    return true;
  }
  override async destroy(id: string): Promise<void> {
    this.records.delete(id);
  }
  override async revokeSid(sid: string): Promise<void> {
    this.revokedSids.add(sid);
    for (const [id, raw] of this.records) {
      if ((JSON.parse(raw) as Session).sid === sid) this.records.delete(id);
    }
  }
  override async lock(id: string, owner: string): Promise<boolean> {
    if (this.locks.has(id)) return false;
    this.locks.set(id, owner);
    return true;
  }
  override async unlock(id: string, owner: string): Promise<void> {
    if (this.locks.get(id) === owner) this.locks.delete(id);
  }
}

// ============================================================================
// Real RS256/JWKS/token/status transport on disposable loopback ports.
// ============================================================================
export class Fixture {
  issuer = "";
  base = "";
  config = loadConfig({
    WORKBENCH_BASE_URL: "http://127.0.0.1",
    WORKBENCH_BFF_PORT: "0",
    OIDC_ISSUER: "http://127.0.0.1",
    OIDC_CLIENT_ID: "workbench",
    OIDC_CLIENT_SECRET: "fixture-only",
    REDIS_URL: "redis://127.0.0.1",
    DATABASE_URL: "postgres://127.0.0.1/unused",
    RP_COOKIE_INSECURE: "true",
  });
  store!: MemoryStore;
  client!: WorkbenchOidcClient;
  auth!: SessionService;
  app!: INestApplication;
  idp!: Server;
  nonce = "";
  accessPatch: Record<string, unknown> = {};
  idPatch: Record<string, unknown> = {};
  tokenStatus = 200;
  central: unknown = {
    valid: true,
    next_check_at: Math.floor(Date.now() / 1000) + 120,
  };
  statusCode = 200;
  tokenCalls = 0;
  statusCalls = 0;
  statusBody: unknown;
  statusAuthorization: string | undefined;
  onToken: (() => Promise<void>) | undefined;
  allowedScope = true;
  readonly subscriptionScopes: string[][] = [];

  sign(patch: Record<string, unknown> = {}): string {
    const data = {
      iss: this.issuer,
      aud: "workbench",
      sub: USER,
      sid: "central-session",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      ...patch,
    };
    const input = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture" })).toString("base64url")}.${Buffer.from(JSON.stringify(data)).toString("base64url")}`;
    return `${input}.${createSign("RSA-SHA256").update(input).end().sign(privateKey).toString("base64url")}`;
  }
  tokens() {
    return {
      access_token: this.sign({
        userType: "tenant_user",
        account_status: "active",
        active_org: ORG,
        active_workspace: WORKSPACE,
        roles: ["workspace:member"],
        name: "验收用户",
        ...this.accessPatch,
      }),
      id_token: this.sign({ nonce: this.nonce, ...this.idPatch }),
      refresh_token: "private-refresh-token",
      expires_in: 3600,
    };
  }
  async start(): Promise<void> {
    this.idp = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/oidc/jwks") {
        res.end(
          JSON.stringify({
            keys: [
              {
                ...publicKey.export({ format: "jwk" }),
                kid: "fixture",
                alg: "RS256",
              },
            ],
          }),
        );
      } else if (req.url === "/oidc/token") {
        this.tokenCalls++;
        await this.onToken?.();
        res.statusCode = this.tokenStatus;
        res.end(
          JSON.stringify(
            this.tokenStatus === 200
              ? this.tokens()
              : { error: "invalid_grant" },
          ),
        );
      } else if (req.url === "/oidc/session/status") {
        this.statusCalls++;
        this.statusAuthorization = req.headers.authorization;
        let body = "";
        for await (const chunk of req) body += String(chunk);
        this.statusBody = JSON.parse(body);
        res.statusCode = this.statusCode;
        res.end(JSON.stringify(this.central));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    await new Promise<void>((resolve) =>
      this.idp.listen(0, "127.0.0.1", resolve),
    );
    this.issuer = `http://127.0.0.1:${(this.idp.address() as AddressInfo).port}`;
    this.config = {
      ...this.config,
      oidc: { ...this.config.oidc, issuer: this.issuer },
    };
    // Deliberately injected test transport; production always uses ioredis.
    this.store = new MemoryStore(
      new RequestStorage() as unknown as Redis,
      this.config,
    );
    this.client = new WorkbenchOidcClient(this.config);
    this.auth = new SessionService(this.store, this.client, this.config);
    const scopes = {
      assertCurrent: async () => {
        if (!this.allowedScope) throw new Error("Membership revoked");
      },
      canSwitch: async (_user: unknown, tenant?: string, workspace?: string) =>
        tenant
          ? tenant === ORG && (!workspace || workspace === WORKSPACE)
          : workspace === WORKSPACE,
      context: async () => ({
        id: ORG,
        name: "Updated organization",
        tenantType: "organization",
        workspace: WORKSPACE,
        workspaceName: "Updated workspace",
      }),
      organizations: async () => [{ id: ORG, name: "验收组织" }],
      workspaces: async () => [{ id: WORKSPACE, name: "default workspace" }],
    };
    const catalog = {
      catalog: async () => [],
      entries: async () => [],
      subscriptions: async (workspace: string, tenant: string) => {
        this.subscriptionScopes.push([workspace, tenant]);
        return [{ productCode: "test", status: "active", tier: "team" }];
      },
    };
    class TestModule {}
    Module({
      controllers: [AuthRouter, ApiRouter],
      providers: [
        { provide: CONFIG, useValue: this.config },
        { provide: SessionStore, useValue: this.store },
        { provide: SessionService, useValue: this.auth },
        { provide: WorkbenchOidcClient, useValue: this.client },
        { provide: ScopeService, useValue: scopes },
        { provide: CatalogService, useValue: catalog },
      ],
    })(TestModule);
    this.app = await NestFactory.create(TestModule, {
      logger: false,
      bodyParser: false,
    });
    configureHttp(this.app);
    await this.app.listen(0, "127.0.0.1");
    this.base = await this.app.getUrl();
  }
  async stop(): Promise<void> {
    await this.app?.close();
    await new Promise<void>((resolve, reject) =>
      this.idp?.close((error) => (error ? reject(error) : resolve())),
    );
  }
  async request(
    path: string,
    cookie?: string,
    init: RequestInit = {},
  ): Promise<Response> {
    return fetch(`${this.base}${path}`, {
      redirect: "manual",
      ...init,
      headers: { ...init.headers, ...(cookie ? { cookie } : {}) },
    });
  }
  async begin(path = "/auth/login") {
    const response = await this.request(path);
    const location = new URL(response.headers.get("location")!);
    this.nonce = location.searchParams.get("nonce")!;
    return {
      response,
      location,
      state: location.searchParams.get("state")!,
      cookie: cookies(response),
    };
  }
  async login(): Promise<string> {
    const start = await this.begin();
    return cookies(
      await this.request(
        `/auth/callback?state=${start.state}&code=fixture`,
        start.cookie,
      ),
    );
  }
}

/**
 * Project response cookies into a browser Cookie header without token access.
 * @param response - HTTP response from the test application.
 * @returns Cookie name/value pairs.
 */
export function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
