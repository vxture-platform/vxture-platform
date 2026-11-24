/**
 * Verify browser and desktop controllers coexist without accepting each other's credentials.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-23
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { get as getHttp } from "node:http";
import { afterEach, expect, it } from "vitest";
import { Fixture, USER, ORG, WORKSPACE } from "../auth/fixtures.spec-support";
import { AuthRouter } from "../auth/auth-router";
import { ApiRouter } from "../api-router";
import { SessionService } from "../auth/session-service";
import { SessionStore } from "../auth/session-store";
import { WorkbenchOidcClient } from "../auth/oidc-client";
import { ScopeService } from "../scope-service";
import { CatalogService } from "../catalog-service";
import { ResourceOverview } from "../resource-overview";
import { CONFIG, PRIMARY_POOL } from "../tokens";
import { configureHttp } from "../bootstrap";
import { DesktopRouter } from "./desktop.router";
import { DesktopSessionService } from "./desktop-session.service";
import { DesktopEnabledGuard } from "./enabled.guard";
import {
  createDesktopRuntime,
  DESKTOP_RUNTIME,
  desktopConfig,
} from "./runtime";
import { TestRedis } from "./test-redis";
import { createDesktopApp } from "./app";

let fixture: Fixture | undefined, app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  await fixture?.stop();
  fixture = undefined;
  app = undefined;
});

// ============================================================================
// Real controllers and shared RP verification, one HTTP listener
// ============================================================================
it("keeps native endpoints closed when the optional module is disabled", async () => {
  app = await createDesktopApp(null);
  await app.listen(0, "127.0.0.1");
  for (const path of [
    "/desktop/healthz",
    "/desktop/api/me",
    "/desktop/auth/login",
  ])
    expect((await fetch(new URL(path, await app.getUrl()))).status).toBe(404);
});

it("does not authenticate native headers as browser cookies or browser cookies as native sessions", async () => {
  fixture = new Fixture();
  await fixture.start();
  const browserCookie = await fixture.login();
  const rt = createDesktopRuntime(
    desktopConfig({
      RUYIN_BFF_BASE: "http://127.0.0.1",
      OIDC_ISSUER: fixture.issuer,
      RUYIN_DESKTOP_OIDC_CLIENT_SECRET: "native-fixture",
    }),
    new TestRedis(),
  );
  class BothSurfaces {}
  Module({
    controllers: [AuthRouter, ApiRouter, DesktopRouter],
    providers: [
      { provide: CONFIG, useValue: fixture.config },
      { provide: SessionService, useValue: fixture.auth },
      { provide: SessionStore, useValue: fixture.store },
      { provide: WorkbenchOidcClient, useValue: fixture.client },
      { provide: ScopeService, useValue: {} },
      { provide: CatalogService, useValue: {} },
      { provide: ResourceOverview, useValue: {} },
      {
        provide: PRIMARY_POOL,
        useValue: {
          query: async () => ({
            rows: [
              {
                account: "fixture",
                name: "Fixture",
                email: null,
                phone: null,
                avatar_hash: null,
              },
            ],
          }),
        },
      },
      DesktopSessionService,
      DesktopEnabledGuard,
      { provide: DESKTOP_RUNTIME, useValue: rt },
    ],
  })(BothSurfaces);
  app = await NestFactory.create(BothSurfaces, {
    logger: false,
    bodyParser: false,
    abortOnError: false,
  });
  configureHttp(app);
  await app.listen(0, "127.0.0.1");
  rt.config.base = await app.getUrl();
  const request = (path: string, headers: Record<string, string> = {}) =>
    fetch(new URL(path, rt.config.base), { headers, redirect: "manual" });
  const native = "native-session-fixture";
  const record = {
    sub: USER,
    sid: "native-central-session",
    activeOrg: ORG,
    accessToken: fixture.sign({
      aud: "ruyin-desktop",
      sub: USER,
      sid: "native-central-session",
      userType: "tenant_user",
      account_status: "active",
      active_org: ORG,
      active_workspace: WORKSPACE,
    }),
    idToken: "unused",
    refreshToken: "unused",
    accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    desktopScope: { tenantId: ORG, workspaceId: WORKSPACE },
  };
  await rt.store.create(native, record, 3600);
  expect((await request("/api/me", { cookie: browserCookie })).status).toBe(
    200,
  );
  expect(
    (await request("/desktop/api/me", { "x-vxture-session": native })).status,
  ).toBe(200);
  expect(
    (await request("/api/me", { "x-vxture-session": native })).status,
  ).toBe(401);
  expect(
    (await request("/desktop/api/me", { cookie: browserCookie })).status,
  ).toBe(400);
  const browserId = browserCookie
    .split("; ")
    .find((part) => part.startsWith(`${fixture!.config.cookieName}=`))!
    .slice(fixture.config.cookieName.length + 1);
  expect(
    (await request("/desktop/api/me", { "x-vxture-session": browserId }))
      .status,
  ).toBe(401);
  expect(
    (
      await request("/api/me", {
        cookie: `${fixture.config.cookieName}=${native}`,
      })
    ).status,
  ).toBe(401);
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    getHttp(
      new URL("/desktop/healthz", rt.config.base),
      { headers: { host: "ruyin.work" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    ).on("error", reject);
  });
  expect(wrongHost).toBe(404);
  expect(
    (
      await fetch(new URL("/desktop/auth/native/logout", rt.config.base), {
        method: "POST",
        headers: { "x-vxture-session": native },
      })
    ).status,
  ).toBe(204);
  expect(await rt.store.get(native)).toBeNull();
  expect((await request("/api/me", { cookie: browserCookie })).status).toBe(
    200,
  );
});
