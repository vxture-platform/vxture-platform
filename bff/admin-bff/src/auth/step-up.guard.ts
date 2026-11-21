/**
 * step-up.guard.ts — enforce a fresh step-up credential on high-risk routes.
 * @package @vxture/bff-admin
 * @layer Application
 * @category auth
 *
 * Global guard, gated by the @RequireStepUp() metadata (operator-identity-
 * security.md §2.3). On a decorated route it requires a valid, unexpired step-up
 * credential (cookie), IdP-signed and bound to the current session operator: the JWT is
 * verified via the RP's JWKS client and its `sub` must equal the session
 * operator's `opr_<id>` — the request body is never trusted. Missing/expired/
 * mismatched → 403 step_up_required (the portal then runs the step-up ceremony).
 * A signed expiry must be an integer in the future; high-risk writes do not use
 * the general RP verifier's expiry clock-skew allowance.
 * Voucher writes additionally require an exact request/session binding and an
 * IdP-confirmed single execution permit; used permits allow receipt replay only.
 * @author AI-Generated
 * @date 2026-11-19
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { ModuleRef, Reflector } from "@nestjs/core";
import type { OidcRpClient } from "@vxture/core-oidc-rp";
import type { Request } from "express";
import {
  RP_OIDC_CLIENT,
  RP_RUNTIME,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/console.types";
import {
  REQUIRE_STEP_UP,
  REQUIRE_VOUCHER_STEP_UP,
  stepUpCookieName,
  stepUpActionCookieName,
} from "./step-up.decorator";
import { assertAnyCapability } from "./capability";
import { OperatorStepUpService } from "./operator-stepup.service";
import { voucherStepUpIntent, voucherStepUpRequired } from "./voucher-step-up";

// ===========================================================================
// Only decorated handlers require a signed, operator-bound and unexpired proof.
// ===========================================================================
@Injectable()
export class OperatorStepUpGuard implements CanActivate {
  // RP deps (RP_OIDC_CLIENT / RP_RUNTIME) are NOT constructor-injected: a global
  // APP_GUARD whose constructor injects another module's useFactory providers
  // deadlocks Nest's instance loader at bootstrap (silent hang, no error). They
  // are resolved lazily via ModuleRef on first use instead — canActivate only
  // runs on @RequireStepUp routes, so this is off the hot path.
  private oidcClient?: OidcRpClient;
  private rpRuntime?: RpRuntime;

  // Explicit @Inject tokens: the bundle is built with esbuild, which does not
  // emit `design:paramtypes` metadata, so type-based DI does not work — every
  // constructor param must name its provider token or it is injected undefined.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  private resolveDeps(): { oidcClient: OidcRpClient; rpRuntime: RpRuntime } {
    this.oidcClient ??= this.moduleRef.get<OidcRpClient>(RP_OIDC_CLIENT, {
      strict: false,
    });
    this.rpRuntime ??= this.moduleRef.get<RpRuntime>(RP_RUNTIME, {
      strict: false,
    });
    return { oidcClient: this.oidcClient, rpRuntime: this.rpRuntime };
  }

  /**
   * Validate a decorated write before its handler runs.
   * @param context - Current handler and authenticated HTTP request.
   * @returns Whether the request can continue.
   * @throws {ForbiddenException} When the operator or step-up proof is invalid.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_STEP_UP,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const { oidcClient, rpRuntime } = this.resolveDeps();

    const req = context.switchToHttp().getRequest<Request & RequestContext>();
    const sessionOperatorId = req.user?.id;
    if (!sessionOperatorId) {
      // AuthMiddleware should have populated this; absence = no session.
      throw new ForbiddenException("step_up_required");
    }

    const singleAction =
      this.reflector.getAllAndOverride<boolean>(REQUIRE_VOUCHER_STEP_UP, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    if (singleAction) assertAnyCapability(req, ["promotion:campaign.manage"]);
    const intent = singleAction ? voucherStepUpIntent(req) : undefined;
    const rejection = () =>
      singleAction
        ? voucherStepUpRequired(req)
        : new ForbiddenException("step_up_required");
    const token =
      req.cookies?.[
        (singleAction ? stepUpActionCookieName : stepUpCookieName)(
          rpRuntime.cookieSecure,
        )
      ];
    if (!token || typeof token !== "string") {
      throw rejection();
    }

    let claims: Record<string, unknown>;
    try {
      // Verify RS256/JWKS, issuer and audience before trusting any claim.
      claims = await oidcClient.verifyAccessToken(token);
    } catch {
      throw rejection();
    }

    const boundToOperator = claims.sub === `opr_${sessionOperatorId}`;
    const expiresAt = claims.exp;
    if (
      claims.stepup !== true ||
      !boundToOperator ||
      typeof expiresAt !== "number" ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      throw rejection();
    }
    if (singleAction && intent) {
      const action = claims.stepup_action;
      if (
        claims.userType !== "operator" ||
        !action ||
        typeof action !== "object" ||
        !("sessionHash" in action) ||
        action.sessionHash !== req.operatorSessionHash ||
        !("requestHash" in action) ||
        action.requestHash !== intent.requestHash
      )
        throw rejection();
      const client = this.moduleRef.get<OperatorStepUpService>(
        OperatorStepUpService,
        { strict: false },
      );
      try {
        const result = await client.consumeAction(sessionOperatorId, token, {
          requestHash: intent.requestHash,
          sessionHash: req.operatorSessionHash!,
        });
        req.voucherReplayOnly = result.mode === "replay";
      } catch (error) {
        if (error instanceof ForbiddenException) throw rejection();
        throw error;
      }
    } else if (claims.stepup_action !== undefined) throw rejection();
    return true;
  }
}
