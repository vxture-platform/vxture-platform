/**
 * Independent runtime composition for customer portal routes.
 * @package @vxture/bff-tenant
 * @layer Application
 * @category bootstrap
 * @author AI-Generated
 * @date 2026-11-15
 */
import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Redis } from "ioredis";
import { Pool } from "pg";
import {
  CustomerPortalService,
  PortalAccessService,
} from "@vxture/service-customer-portal"; // ⚠️ 跨层引用: inject dedicated database connections into portal domain readers.
import { configureHttp } from "./bootstrap";
import { loadConfig } from "./config";
import { PortalGateway } from "./gateway";
import { AuthRouter } from "./auth/auth-router";
import { PortalRouter } from "./portal-router";

async function start(): Promise<void> {
  const config = loadConfig(process.env);
  const pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    commandTimeout: 5000,
  });
  pool.on("error", () => undefined);
  redis.on("error", () => undefined);
  await redis.connect();
  await pool.query("select 1 from tenancy.customer_portals limit 0");

  @Controller("healthz")
  class HealthRouter {
    @Get()
    async readiness() {
      await Promise.all([
        pool.query("select 1 from tenancy.customer_portals limit 0"),
        redis.ping(),
      ]);
      return { status: "ok" };
    }
  }
  @Module({
    controllers: [AuthRouter, PortalRouter, HealthRouter],
    providers: [
      {
        provide: PortalGateway,
        useValue: new PortalGateway(
          config,
          redis,
          new CustomerPortalService(pool),
          new PortalAccessService(pool),
        ),
      },
    ],
  })
  class AppModule {}
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ["log", "warn", "error"],
  });
  configureHttp(app);
  await app.listen(config.port, "0.0.0.0");
}
void start().catch(() => {
  process.stderr.write(
    "Tenant BFF startup failed; check required runtime configuration and connectivity.\n",
  );
  process.exit(1);
});
