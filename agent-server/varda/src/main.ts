/**
 * main.ts - Varda Server 入口
 * @package varda-server
 * @layer Application
 * @category Module
 *
 * @author AI-Generated
 * @date 2026-04-30
 */

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env["VARDA_SERVER_PORT"] ?? 3091);
  await app.listen(port);
}

void bootstrap();
