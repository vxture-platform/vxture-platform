/**
 * Bounded, authenticated reads of Accounts-owned tenant observations.
 * @package @vxture/bff-console
 * @layer Application
 * @category client
 * @author AI-Generated
 * @date 2026-11-19
 */
import { Inject, Injectable } from "@nestjs/common";
import { RP_RUNTIME, type RpRuntime } from "../oidc/oidc-rp.tokens";

// ===== Additive observation shapes =====
export interface AccountObservation {
  id: string;
  presence?: "online" | "offline" | "unknown";
  location?: {
    kind: "public" | "private" | "unknown";
    country: string | null;
    region: string | null;
    city: string | null;
    countryCode: string | null;
  };
}

@Injectable()
export class AccountInsightsClient {
  constructor(@Inject(RP_RUNTIME) private readonly runtime: RpRuntime) {}

  /**
   * Read only records already authorized by the Console request.
   * @param kind Observation category.
   * @param tenantId Resolved request tenant.
   * @param sid Verified central session identifier, never a browser parameter.
   * @param ids Stored record identifiers.
   * @returns Observations, or no assertion when the upstream is unavailable.
   */
  async read(
    kind: "members" | "audit",
    tenantId: string,
    sid: string | undefined,
    ids: string[],
  ): Promise<AccountObservation[]> {
    if (!sid || ids.length === 0) return [];
    const cfg = this.runtime.config;
    const basic = Buffer.from(
      `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret ?? "")}`,
    ).toString("base64");
    const rows: AccountObservation[] = [];
    // Bound total request time as well as each chunk; no background polling.
    const signal = AbortSignal.timeout(2500);
    try {
      for (let offset = 0; offset < ids.length; offset += 100) {
        const response = await fetch(
          `${(cfg.backchannelIssuer ?? cfg.issuer).replace(/\/+$/, "")}/oidc/console-insights`,
          {
            method: "POST",
            headers: {
              authorization: `Basic ${basic}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              kind,
              tenantId,
              sid,
              ids: ids.slice(offset, offset + 100),
            }),
            signal,
          },
        );
        if (!response.ok) return [];
        const data = (await response.json()) as {
          items?: AccountObservation[];
        };
        if (!Array.isArray(data.items)) return [];
        rows.push(...data.items);
      }
      return rows;
    } catch {
      return [];
    }
  }
}
