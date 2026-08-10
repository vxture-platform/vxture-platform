import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import express from "express";
import { AppModule } from "./app.module";
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

    console.log("[boot-smoke] console-bff DI graph resolved OK");
    process.exit(0);
  }

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  // Raw image body for avatar / org-logo uploads; content-type is sniffed from
  // the bytes in the router, so accept any type here. 5MB ceiling.
  app.use("/api/me/avatar", express.raw({ type: () => true, limit: "5mb" }));
  app.use(
    "/api/me/organization/logo",
    express.raw({ type: () => true, limit: "5mb" }),
  );
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
    title: "console-bff",
    description:
      "Tenant console BFF: workspace/member/subscription self-service, quota views.",
    version: process.env["npm_package_version"] ?? "0.0.0",
  });

  await app.listen(Number(process.env.CONSOLE_BFF_PORT ?? 3021));
}

void bootstrap();
