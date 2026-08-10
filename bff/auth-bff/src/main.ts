/**
 * main.ts - Auth BFF 启动入口
 * @package @vxture/bff-auth
 * @description 统一认证服务，唯一有权签发 JWT 的 NestJS 应用
 * @author AI-Generated
 * @date 2026-05-07
 * @version 1.0
 */

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./filters/all-exceptions.filter";

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

    console.log("[boot-smoke] auth-bff DI graph resolved OK");
    process.exit(0);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Log the real stack of every 5xx / unhandled throw (otherwise hidden behind
  // NestJS's generic 500), and return a clean error body.
  app.useGlobalFilters(new AllExceptionsFilter());

  // cookie 解析（用于读取跨域验证请求中的 cookie）
  const cookieParser = (await import("cookie-parser")).default;
  app.use(cookieParser());

  // Raw image body for the avatar upload (PUT /api/me/avatar). The content-type
  // is sniffed from the bytes in the controller, so accept any type here; the
  // 5MB limit mirrors AVATAR_MAX_BYTES.
  const express = (await import("express")).default;
  app.use("/api/me/avatar", express.raw({ type: () => true, limit: "5mb" }));

  // CORS for credentialed browser calls (the accounts login UI POSTs
  // /oidc/authorize/login with credentials). Prod: accounts is same-origin with
  // the OIDC endpoints (accounts.vxture.com via reverse proxy) so this is moot;
  // dev: accounts (:3080) → auth-bff (:3081) is cross-port and needs it. Mirrors
  // the other BFFs: explicit ALLOWED_ORIGIN allowlist, else reflect (dev).
  const allowedOrigins =
    process.env["ALLOWED_ORIGIN"]
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  });

  const port = Number(process.env.AUTH_BFF_PORT ?? 3081);
  await app.listen(port);
  Logger.log(`✅ auth-bff listening on http://localhost:${port}`, "Bootstrap");
}

void bootstrap();
