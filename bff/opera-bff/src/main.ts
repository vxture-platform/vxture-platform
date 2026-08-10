import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { setupOpenApi } from "@vxture/core-config/openapi";

async function bootstrap() {
  // TD-024 boot-smoke: resolve the full DI graph from the real esbuild bundle
  // with fake env (no listen), surfacing the esbuild implicit-constructor
  // injection trap that tsc and unit tests are blind to.
  if (process.env["BOOT_SMOKE"] === "1") {
    const app = await NestFactory.create(AppModule, { logger: ["error"] });
    await app.init();
    await app.close();

    console.log("[boot-smoke] opera-bff DI graph resolved OK");
    process.exit(0);
  }

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  // Same-origin only (portal + BFF share the console vhost through nginx);
  // no CORS surface is opened on purpose — the shell never calls cross-origin.
  // Dev-only route browser (non-production; see setupOpenApi). Nest's
  // decorators are the source, so the route list cannot drift from the code.
  setupOpenApi(app, {
    title: "opera-bff",
    description:
      "Capability console BFF (product_250 M-4): operator shell for the L1 admin modules.",
    version: process.env["npm_package_version"] ?? "0.0.0",
  });

  await app.listen(Number(process.env.OPERA_BFF_PORT ?? 3041));
}

void bootstrap();
