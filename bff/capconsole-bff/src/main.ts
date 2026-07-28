import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  // TD-024 boot-smoke: resolve the full DI graph from the real esbuild bundle
  // with fake env (no listen), surfacing the esbuild implicit-constructor
  // injection trap that tsc and unit tests are blind to.
  if (process.env["BOOT_SMOKE"] === "1") {
    const app = await NestFactory.create(AppModule, { logger: ["error"] });
    await app.init();
    await app.close();

    console.log("[boot-smoke] capconsole-bff DI graph resolved OK");
    process.exit(0);
  }

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  // Same-origin only (portal + BFF share the console vhost through nginx);
  // no CORS surface is opened on purpose — the shell never calls cross-origin.
  await app.listen(Number(process.env.CAPCONSOLE_BFF_PORT ?? 3051));
}

void bootstrap();
