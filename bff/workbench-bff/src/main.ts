/**
 * Standalone workbench BFF entry point.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category bootstrap
 * @author AI-Generated
 * @date 2026-11-05
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureHttp } from "./bootstrap";
import { CONFIG } from "./tokens";
import type { WorkbenchConfig } from "./config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureHttp(app);
  if (process.env["BOOT_SMOKE"] === "1") {
    // Resolve the production bundle's real providers and Redis connection in CI.
    await app.init();
    await app.close();
    console.log("[boot-smoke] workbench-bff DI graph resolved OK");
    return;
  }
  app.enableShutdownHooks();
  const config = app.get<WorkbenchConfig>(CONFIG);
  await app.listen(config.port, config.port === 0 ? "127.0.0.1" : "0.0.0.0");
}
void bootstrap().catch(() => {
  console.error(
    "[workbench-bff] Startup failed; check required runtime configuration and dependencies",
  );
  process.exitCode = 1;
});
