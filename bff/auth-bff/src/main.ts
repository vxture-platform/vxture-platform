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
import { VxConfigService } from "@vxture/core-config";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./filters/all-exceptions.filter";
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

    console.log("[boot-smoke] auth-bff DI graph resolved OK");
    process.exit(0);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 启动时点名内部面的钥匙。未配置 ⇒ /internal/*（运营账号 / 客户账号管理、step-up）
  // 全部 401 internal_auth_unavailable；admin / arche / opera 的对应动作 503。**不退出**：
  // auth-bff 是 IdP，退出等于全平台登录停摆；生产上的硬闸在部署层（30-deploy 缺文件 /
  // 占位即停，容器一个不换）。这条 warn 只在真实启动日志里看得见——BOOT_SMOKE 路径在
  // 上面已经 exit，而且那条路以 logger: ["error"] 建应用，warn 本来也打不出来；所以它
  // 不是任何守卫的断言物，只是给运维看的一行。
  if (!app.get(VxConfigService).auth.IDP_INTERNAL_TOKEN) {
    Logger.warn(
      "IDP_INTERNAL_TOKEN unset — /internal/* closed (401 internal_auth_unavailable)",
      "Bootstrap",
    );
  }

  // Log the real stack of every 5xx / unhandled throw (otherwise hidden behind
  // NestJS's generic 500), and return a clean error body.
  app.useGlobalFilters(new AllExceptionsFilter());

  // cookie 解析（用于读取跨域验证请求中的 cookie）
  const cookieParser = (await import("cookie-parser")).default;
  app.use(cookieParser());

  // Raw image body for the avatar upload (PUT /api/me/avatar). The content-type
  // is sniffed from the bytes in the controller, so accept any type here; the
  // 1MB limit mirrors AVATAR_MAX_BYTES.
  const express = (await import("express")).default;
  app.use("/api/me/avatar", express.raw({ type: () => true, limit: "1mb" }));

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
  // Dev-only route browser (non-production; see setupOpenApi). Nest's
  // decorators are the source, so the route list cannot drift from the code.
  setupOpenApi(app, {
    title: "auth-bff",
    description:
      "Identity provider: OIDC authorize/token/jwks, RP session, operator step-up, social login.",
    version: process.env["npm_package_version"] ?? "0.0.0",
  });

  await app.listen(port);
  Logger.log(`✅ auth-bff listening on http://localhost:${port}`, "Bootstrap");
}

void bootstrap();
