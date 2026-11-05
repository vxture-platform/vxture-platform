/**
 * HTTP configuration shared by production bootstrap and real-route regression tests.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category middleware
 * @author AI-Generated
 * @date 2026-11-05
 */
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import express from "express";
import { PublicErrorFilter } from "./errors";

/**
 * Configure bounded parsing and private, non-cacheable API responses.
 * @param app - Workbench Nest application.
 * @returns Nothing; installs middleware and the public error boundary.
 */
export function configureHttp(app: INestApplication): void {
  app.use(
    (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      next();
    },
  );
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use(express.json({ limit: "16kb" }));
  app.useGlobalFilters(new PublicErrorFilter());
}
