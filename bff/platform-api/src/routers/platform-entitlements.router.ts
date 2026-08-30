/**
 * platform-entitlements.router.ts — C2 entitlement resolution API (product_310
 * P2.1; contract = ADR-11 §11.7, channel spec = product_200 §3.1).
 *
 * Server-to-server only (PlatformAuthGuard — legacy AUTH_INTERNAL_TOKEN or a
 * T1 token-exchange S2S bearer token, either satisfies; product_210 T2). Not
 * part of the public /oidc/* surface; nginx does not route /platform/* (the
 * accounts vhost only forwards /oidc, /auth, /api/me, /avatar to auth-bff), so
 * products reach it over the internal network.
 *
 * Caching contract (product_310 D2): responses are point-in-time views meant
 * for a short product-side TTL (30–60s) with natural expiry — there is no
 * invalidate push in v1. Cache-Control advertises the 45s midpoint.
 */
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PlatformAuthGuard } from "../authn/platform-auth.guard";
import { S2sCaller, type S2sCallerCtx } from "../authn/s2s-caller";
import { scopeToS2sCaller } from "../authn/s2s-scope";
import { IntegrationSignalService } from "../platform/integration-signal.service";
import { PlatformEntitlementsService } from "../platform/platform-entitlements.service";
import {
  parseEntitlementQuery,
  type ProductEntitlementView,
} from "../platform/entitlement-view";

@Controller()
@UseGuards(PlatformAuthGuard)
export class PlatformEntitlementsRouter {
  constructor(
    @Inject(PlatformEntitlementsService)
    private readonly entitlements: PlatformEntitlementsService,
    @Inject(IntegrationSignalService)
    private readonly signals: IntegrationSignalService,
  ) {}

  /**
   * GET /platform/entitlements?workspace_id={W}&product={P}
   * GET /platform/entitlements?workspace_id={W}&products=a,b,c
   */
  @Get("platform/entitlements")
  @Header("Cache-Control", "private, max-age=45")
  async resolve(
    @Query()
    query: {
      workspace_id?: string;
      product?: string;
      products?: string;
    },
    @S2sCaller() s2sCaller: S2sCallerCtx | undefined,
  ): Promise<
    | ({ workspace_id: string; product: string } & ProductEntitlementView)
    | {
        workspace_id: string;
        entitlements: Record<string, ProductEntitlementView>;
      }
  > {
    let parsed;
    try {
      parsed = parseEntitlementQuery(query);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    // TD-035: an S2S caller can only ask about its own product(s), and its
    // own workspace_id (the token's, not the caller-declared one) is used.
    const { workspaceId } = scopeToS2sCaller(s2sCaller, parsed);

    const views = await this.entitlements.resolve(
      workspaceId,
      parsed.productCodes,
    );

    // C2 last-seen signal for opera's launch checklist (integration-signal
    // .service.ts). Fire-and-forget after the read succeeded: the recorder
    // throttles and swallows Redis failures, so this line cannot change the
    // response. Attribution: S2S = act.sub (already forced equal to the
    // requested code above); shared internal header carries no identity, so
    // each requested code is attributed as-is.
    const via = s2sCaller ? "s2s" : "internal-auth";
    for (const code of parsed.productCodes) {
      this.signals.recordEntitlementRead({
        productCode: code,
        via,
        workspaceId,
      });
    }

    if (parsed.single) {
      const code = parsed.productCodes[0]!;
      return {
        workspace_id: workspaceId,
        product: code,
        ...views[code]!,
      };
    }
    return { workspace_id: workspaceId, entitlements: views };
  }
}
