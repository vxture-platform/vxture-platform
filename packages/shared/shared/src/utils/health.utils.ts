/**
 * health.utils.ts - Service health / identity endpoint contract helper
 * @package @vxture-platform/shared
 * @description Single source for the health-endpoint identity block defined by
 *   docs/10-standards/025-service-health-endpoint-contract.md. Every liveness
 *   endpoint (Next `/api/health`, NestJS `/healthz`, …) builds its response
 *   from here so field names, provenance sourcing, and honest fallbacks stay
 *   uniform across services and repos. Provenance is injected at build time as
 *   ENV (APP_VERSION / GIT_SHA / BUILD_TIME / DEPLOY_STAGE); when absent, values
 *   fall back to honest placeholders ("dev" / "unknown") — never hardcode.
 */

/** Build-provenance + identity fields shared by liveness and readiness bodies. */
export interface ServiceIdentity {
  /** Service identifier — finest-grained deploy unit, e.g. "console", "console-bff". */
  service: string;
  /** Product line, optional (multi-service products), e.g. "vxture", "arda". */
  product?: string;
  /** Human release = deploy git tag (e.g. "v0.20.8"); "dev" for non-tag builds. */
  version: string;
  /** Build commit SHA (short/full, no "sha-" prefix); "unknown" if not injected. */
  gitSha: string;
  /** Runtime environment: "production" | "beta" | "dev" | "local". */
  stage: string;
  /** Image build timestamp (ISO 8601); "unknown" if not injected. */
  buildTime: string;
  /** Current server time (ISO 8601) — proves live response + clock sanity. */
  time: string;
}

/** Liveness response body: identity block with a fixed `status: "ok"`. */
export interface HealthLiveResponse extends ServiceIdentity {
  status: "ok";
}

/**
 * Resolve the identity/provenance block from build-time ENV, with honest
 * fallbacks. Used to compose both liveness and readiness responses.
 */
export function serviceIdentity(opts: {
  service: string;
  product?: string;
}): ServiceIdentity {
  return {
    service: opts.service,
    ...(opts.product ? { product: opts.product } : {}),
    version: process.env.APP_VERSION || "dev",
    gitSha: process.env.GIT_SHA || "unknown",
    stage: process.env.DEPLOY_STAGE || "dev",
    buildTime: process.env.BUILD_TIME || "unknown",
    time: new Date().toISOString(),
  };
}

/**
 * Build a standard liveness (`/api/health` · `/healthz`) response body.
 * Dependency-free: callers must not add DB/Redis/upstream checks here.
 */
export function buildHealthIdentity(opts: {
  service: string;
  product?: string;
}): HealthLiveResponse {
  return { status: "ok", ...serviceIdentity(opts) };
}
