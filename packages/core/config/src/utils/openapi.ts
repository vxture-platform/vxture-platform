/**
 * openapi.ts — one-call OpenAPI bootstrap for the platform's NestJS services.
 *
 * Two surfaces with deliberately different exposure rules:
 *
 *   /docs         Swagger UI, a human page. **Non-production only.** In
 *                 production it would hand an unauthenticated visitor a map of
 *                 every route, parameter shape and error code — an attack
 *                 surface index, published by us, for free.
 *   /openapi.json The machine-readable spec. Served in every environment ONLY
 *                 when a service opts in with `serveSpec`, which today means
 *                 platform-api: its consumers are other product repos, it is
 *                 tailnet-only, and a spec they can fetch is what stops them
 *                 transcribing our claim names by hand out of prose docs
 *                 (`active_workspace` vs `workspace_id`, liaison #226).
 *
 * Route/method coverage is automatic — Nest's decorators are the source, so the
 * document cannot drift from the code the way a hand-written contract does.
 * Request/response *shapes* only appear where DTOs carry `@ApiProperty`; adding
 * those is incremental and does not block this being useful today.
 */
import type { INestApplication } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export interface OpenApiOptions {
  /** Shown as the document title, e.g. "platform-api". */
  title: string;
  /** One line on what this service is for. */
  description: string;
  /** Service version — package version is the usual source. */
  version: string;
  /**
   * Serve `/openapi.json` in ALL environments (default false = dev only).
   * Turn on for services whose consumers are other repos rather than browsers.
   */
  serveSpec?: boolean;
}

export function setupOpenApi(
  app: INestApplication,
  { title, description, version, serveSpec = false }: OpenApiOptions,
): void {
  const isProduction = process.env["NODE_ENV"] === "production";
  if (isProduction && !serveSpec) return;

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(title)
      .setDescription(description)
      .setVersion(version)
      .build(),
  );

  // `raw: false` keeps Swagger from also mounting its own JSON route; the spec
  // route below is mounted explicitly so its exposure follows serveSpec rather
  // than the UI's.
  if (!isProduction) {
    SwaggerModule.setup("docs", app, document, { raw: false });
  }
  if (serveSpec || !isProduction) {
    app
      .getHttpAdapter()
      .get(
        "/openapi.json",
        (_req: unknown, res: { json: (b: unknown) => void }) => {
          res.json(document);
        },
      );
  }

  Logger.log(
    `OpenAPI ready — ${isProduction ? "" : "UI /docs, "}spec /openapi.json`,
    "OpenAPI",
  );
}
