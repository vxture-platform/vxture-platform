/**
 * step-up.guard.ts — 在高危路由上强制一枚新鲜的 step-up 凭证。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * 全局守卫，由 `@RequireStepUp()` 元数据触发（`product_250` v0.4：step-up 的执行位
 * 在 console）。被标注的路由要求一枚有效、未过期、**且绑定当前会话 operator** 的
 * step-up 凭证（cookie）：JWT 经 RP 的 JWKS 验签，其 `sub` 必须等于会话 operator 的
 * `opr_<id>`——**请求体永不被信任**。缺失/过期/不匹配一律 `403 step_up_required`，
 * 门户据此发起仪式（见 `StepUpProvider`）。
 *
 * 三条不变量：
 *   - **只 gate 写路由**。读路由永不 gate。
 *   - **绑会话**。凭证签给 A，A 的浏览器里，只对 A 的会话有效；拿别人的凭证无效。
 *   - **fail-closed**。验不出来就是没过——不因为 JWKS 抖动而放行。
 */
import {
  CanActivate,
  ExecutionContext,
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
import type { RequestContext } from "../types/request-context";
import { stepUpRequired } from "../errors/api-error";
import { REQUIRE_STEP_UP, stepUpCookieName } from "./step-up.decorator";

@Injectable()
export class OperatorStepUpGuard implements CanActivate {
  // RP 依赖**不走构造器注入**：全局 APP_GUARD 的构造器若注入别的模块的 useFactory
  // provider，会在 bootstrap 时把 Nest 的实例加载器锁死（静默挂起、无报错）。这里
  // 改用 ModuleRef 懒解析——canActivate 只在被标注的路由上跑，不在热路径。
  // （这条坑是 admin-bff 先踩到的，同构实现照抄结论、不重踩。）
  private oidcClient?: OidcRpClient;
  private rpRuntime?: RpRuntime;

  // 显式 @Inject：产物走 esbuild 打包，不产出 `design:paramtypes` 元数据，
  // 基于类型的 DI 失效——每个构造器参数必须点名 provider token，否则注入 undefined。
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

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_STEP_UP,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const { oidcClient, rpRuntime } = this.resolveDeps();
    const req = context.switchToHttp().getRequest<Request & RequestContext>();

    const sessionOperatorId = req.operator?.id;
    if (!sessionOperatorId) {
      // OperatorAuthMiddleware 本该填好；缺失即无会话。
      throw stepUpRequired();
    }

    const token = req.cookies?.[stepUpCookieName(rpRuntime.cookieSecure)];
    if (!token || typeof token !== "string") {
      throw stepUpRequired();
    }

    let claims: Record<string, unknown>;
    try {
      // RS256/JWKS + iss + exp + aud=opera（与 access token 同一签发方）。
      claims = await oidcClient.verifyAccessToken(token);
    } catch {
      throw stepUpRequired();
    }

    const boundToSession = claims.sub === `opr_${sessionOperatorId}`;
    if (claims.stepup !== true || !boundToSession) {
      throw stepUpRequired();
    }
    return true;
  }
}
