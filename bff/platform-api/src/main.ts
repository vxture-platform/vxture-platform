/**
 * main.ts - platform-api bootstrap (product-facing S2S host).
 * @package @vxture/bff-platform-api
 *
 * Split out of auth-bff/admin-bff (product_310 D13): hosts the C2/C3 product
 * self-service endpoints (/platform/entitlements, /platform/sharing/visible-set,
 * /usage/consume, /usage/gauge) and the commerce background jobs (provisioning
 * dispatch, sharing expiry, trial expiry). Internal-network only — the public
 * nginx does not route here; products reach it via the internal alias.
 */

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { setupOpenApi } from "@vxture/core-config/openapi";
import { AllExceptionsFilter } from "./filters/all-exceptions.filter";

async function bootstrap() {
  // TD-024 boot-smoke: resolve the full DI graph from the real esbuild bundle
  // with fake env, without listening, then exit (surfaces the esbuild
  // implicit-constructor-injection trap that tsc and unit tests miss).
  if (process.env["BOOT_SMOKE"] === "1") {
    const app = await NestFactory.create(AppModule, { logger: ["error"] });
    await app.init();
    await app.close();

    console.log("[boot-smoke] platform-api DI graph resolved OK");
    process.exit(0);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Log the real stack of every 5xx / unhandled throw (otherwise hidden behind
  // NestJS's generic 500), and return a clean error body.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Machine-readable contract for the product repos that consume this service
  // (C2 entitlements, C3 usage, sharing visible-set). `serveSpec` is on here and
  // nowhere else: consumers are other repos rather than browsers, the surface is
  // tailnet-only, and a fetchable spec is what stops a product transcribing our
  // field names out of prose (liaison #226 had `active_workspace` for
  // `workspace_id`). The /docs UI stays non-production, as everywhere.
  setupOpenApi(app, {
    title: "platform-api",
    description:
      "Platform S2S surface for product repos: C2 entitlements, C3 usage (consume/gauge), sharing visible-set. Internal network only — see product_200 §3/§4.",
    version: process.env["npm_package_version"] ?? "0.0.0",
    serveSpec: true,
  });

  // S2S-only surface: no cookies, no CORS, no browser callers.
  const port = Number(process.env.PLATFORM_API_PORT ?? 8080);
  await app.listen(port);
  Logger.log(
    `✅ platform-api listening on http://localhost:${port}`,
    "Bootstrap",
  );
}

void bootstrap();
