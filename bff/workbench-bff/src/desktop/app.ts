/**
 * Test-only composition for desktop HTTP contracts.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-23
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DesktopRouter } from "./desktop.router";
import { DesktopSessionService } from "./desktop-session.service";
import { DesktopEnabledGuard } from "./enabled.guard";
import { DESKTOP_RUNTIME, type DesktopRuntime } from "./runtime";
import { configureHttp } from "../bootstrap";
export async function createDesktopApp(
  runtime: DesktopRuntime | null,
): Promise<INestApplication> {
  @Module({
    controllers: [DesktopRouter],
    providers: [
      DesktopSessionService,
      DesktopEnabledGuard,
      { provide: DESKTOP_RUNTIME, useValue: runtime },
    ],
  })
  class DesktopTestModule {}
  const app = await NestFactory.create(DesktopTestModule, {
    logger: false,
    bodyParser: false,
  });
  configureHttp(app);
  return app;
}
