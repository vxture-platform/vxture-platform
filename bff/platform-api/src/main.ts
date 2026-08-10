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

  // S2S-only surface: no cookies, no CORS, no browser callers.
  const port = Number(process.env.PLATFORM_API_PORT ?? 8080);
  await app.listen(port);
  Logger.log(
    `✅ platform-api listening on http://localhost:${port}`,
    "Bootstrap",
  );
}

void bootstrap();
