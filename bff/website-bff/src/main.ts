/**
 * main.ts - Website BFF Entry Point
 * @package @vxture/bff-website
 * @description Application bootstrap for the website BFF server
 * @author AI-Generated
 * @date 2026-03-15
 * @version 1.0
 * @copyright Vxture Team
 * @layer Application
 * @category Infrastructure
 */

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./filters/all-exceptions.filter";
import cookieParser from "cookie-parser";
import { setupOpenApi } from "@vxture/core-config/openapi";

async function bootstrap() {
  // TD-024 boot-smoke: build the REAL esbuild bundle and resolve the full DI graph
  // with fake env, without listening or serving traffic, then exit. This surfaces
  // the esbuild implicit-constructor-injection trap (a bundled service whose deps
  // silently become undefined) that tsc and unit tests are blind to. Run in CI as:
  //   BOOT_SMOKE=1 node dist/main.cjs   (with a fake but schema-valid env)
  if (process.env["BOOT_SMOKE"] === "1") {
    const app = await NestFactory.create(AppModule, { logger: ["error"] });
    await app.init();
    await app.close();

    console.log("[boot-smoke] website-bff DI graph resolved OK");
    process.exit(0);
  }

  const app = await NestFactory.create(AppModule);
  // Log the real stack of every 5xx / unhandled throw (otherwise hidden behind
  // NestJS's generic 500), and return a clean error body.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  const allowedOrigins =
    process.env["ALLOWED_ORIGIN"]
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  });
  // Dev-only route browser (non-production; see setupOpenApi). Nest's
  // decorators are the source, so the route list cannot drift from the code.
  setupOpenApi(app, {
    title: "website-bff",
    description:
      "Public website BFF: marketing surface, signup, public catalog reads.",
    version: process.env["npm_package_version"] ?? "0.0.0",
  });

  await app.listen(Number(process.env.WEBSITE_BFF_PORT ?? 3001));
}

void bootstrap();
