/**
 * atlas-health.client.ts - Bounded, validated Atlas health reads.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category client
 * @author AI-Generated
 * @date 2026-10-19
 */
import { Inject, Injectable } from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";

import type { ServiceHealthView } from "./model-health-notice";

// ============================================================================
// Wire validation (additive fields are allowed; consumed fields must be valid)
// ============================================================================

const MODEL_STATES = [
  "ok",
  "rate_limited",
  "account_refused",
  "unavailable",
  "unreachable",
  "model_missing",
  "unknown",
  "degraded",
];
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_CACHE_MAX_MS = 240_000;
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const member = (v: unknown, values: readonly string[]): boolean =>
  typeof v === "string" && values.includes(v);
const optionalText = (v: unknown): boolean =>
  v === undefined || typeof v === "string";
const optionalNumber = (v: unknown): boolean =>
  v === undefined || (typeof v === "number" && Number.isFinite(v));
const modelRef = (v: unknown): boolean =>
  object(v) && text(v.modelCode) && member(v.state, MODEL_STATES);
const metadata = (v: Record<string, unknown>): boolean =>
  optionalText(v.since) && optionalText(v.detail);
const entries = (v: unknown, check: (entry: unknown) => boolean): boolean =>
  Array.isArray(v) && v.every(check);

function isHealthView(v: unknown): v is ServiceHealthView {
  return (
    object(v) &&
    text(v.generatedAt) &&
    Number.isFinite(Date.parse(v.generatedAt)) &&
    entries(
      v.models,
      (m) =>
        object(m) &&
        modelRef(m) &&
        text(m.providerCode) &&
        metadata(m) &&
        optionalNumber(m.upstreamStatus),
    ) &&
    entries(
      v.routes,
      (r) =>
        object(r) &&
        text(r.code) &&
        member(r.state, ["ok", "degraded", "down"]) &&
        (r.severity === null ||
          member(r.severity, ["info", "warning", "critical"])) &&
        modelRef(r.primary) &&
        (r.fallback === null || modelRef(r.fallback)) &&
        entries(
          r.configIssues,
          (i) =>
            object(i) &&
            member(i.role, ["primary", "fallback"]) &&
            text(i.modelCode) &&
            member(i.code, [
              "model_missing",
              "model_inactive",
              "wrong_type",
              "no_key",
            ]) &&
            typeof i.detail === "string",
        ),
    ) &&
    entries(
      v.vendors,
      (x) =>
        object(x) &&
        text(x.providerCode) &&
        member(x.state, ["ok", "balance_low", "not_supported", "unknown"]) &&
        metadata(x) &&
        optionalText(x.currency) &&
        optionalNumber(x.balance) &&
        optionalNumber(x.daysLeft),
    ) &&
    entries(
      v.atlas,
      (c) =>
        object(c) &&
        member(c.component, ["usage_reporting", "request_log", "partitions"]) &&
        member(c.state, ["ok", "failing", "at_risk", "unknown"]) &&
        metadata(c),
    )
  );
}

// ============================================================================
// Client
// ============================================================================

@Injectable()
export class AtlasHealthClient {
  private cached: { token: string; expiresAtMs: number } | undefined;
  private minting: Promise<string> | undefined;

  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** @returns Whether the watchdog has nonblank client credentials. */
  isConfigured(): boolean {
    return Boolean(
      this.config.platform.OIDC_CLIENT_ID.trim() &&
      this.config.platform.OIDC_CLIENT_SECRET.trim(),
    );
  }

  /** Bound headers and body decoding together; never include upstream bodies or credentials in errors.
   * @throws Error on transport, timeout, HTTP or invalid JSON failures.
   */
  private async readJson(
    url: string,
    init: RequestInit,
    label: string,
    rejected?: () => void,
  ): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = async (): Promise<unknown> => {
        const res = await fetch(url, {
          ...init,
          redirect: "error",
          signal: controller.signal,
        });
        if (res.status === 401) rejected?.();
        if (!res.ok) throw new Error("HTTP failure");
        return await res.json();
      };
      return await Promise.race([
        request(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("timeout"));
          }, REQUEST_TIMEOUT_MS);
        }),
      ]);
    } catch {
      controller.abort();
      throw new Error(
        `${label} failed (HTTP, transport, timeout or invalid JSON)`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async mintToken(): Promise<string> {
    if (this.cached && this.cached.expiresAtMs > Date.now())
      return this.cached.token;
    if (this.minting) return this.minting;
    this.minting = this.exchangeToken();
    try {
      return await this.minting;
    } finally {
      this.minting = undefined;
    }
  }

  /** @throws Error when the exchange cannot provide a usable Bearer ticket. */
  private async exchangeToken(): Promise<string> {
    // Measure TTL from request start, so network latency cannot extend token validity.
    const startedAt = Date.now();
    const params = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: this.config.platform.OIDC_CLIENT_ID,
      client_secret: this.config.platform.OIDC_CLIENT_SECRET,
      audience: "atlas",
    });
    const body = await this.readJson(
      `${this.config.platform.AUTH_BFF_URL.replace(/\/+$/, "")}/oidc/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
      "Atlas health token exchange",
    );
    if (
      !object(body) ||
      !text(body.access_token) ||
      !member(body.token_type, ["Bearer", "bearer"]) ||
      typeof body.expires_in !== "number" ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0
    ) {
      throw new Error("Atlas health token exchange returned an invalid ticket");
    }
    const lifetimeMs = Math.min(TOKEN_CACHE_MAX_MS, body.expires_in * 1000);
    const expiresAtMs =
      startedAt + lifetimeMs - Math.min(30_000, lifetimeMs * 0.1);
    if (expiresAtMs <= Date.now())
      throw new Error("Atlas health token expired during exchange");
    this.cached = { token: body.access_token, expiresAtMs };
    return body.access_token;
  }

  /** Read a snapshot; failure is visible to the job heartbeat, including missing credentials.
   * @returns A runtime-validated Atlas health snapshot.
   * @throws Error on configuration, token, HTTP or payload failure.
   */
  async getHealth(): Promise<ServiceHealthView> {
    if (!this.isConfigured())
      throw new Error("Atlas health monitoring credentials are not configured");
    const token = await this.mintToken();
    const body = await this.readJson(
      `${this.config.platform.ATLAS_API_URL.replace(/\/+$/, "")}/s2s/health`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
      "Atlas health read",
      () => {
        if (this.cached?.token === token) this.cached = undefined;
      },
    );
    if (!isHealthView(body))
      throw new Error("Atlas health read returned an invalid snapshot");
    return body;
  }
}
