/**
 * actor-binding.guard.ts — 内部面「代为操作的运营者」主体绑定（E1 PR C，2026-10-04）。
 * @package @vxture/bff-auth
 *
 * ── 补的是哪个洞 ──
 * `operator-admin-internal` 与 `account-admin-internal` 两个 router 的 actor 来自请求体
 * `actorOperatorId`，rank 门比的也是它；`InternalAuthGuard` 只证明「调用方持有内部口令」。
 * 于是一个被攻破的 admin-bff / arche-bff（持 `IDP_INTERNAL_TOKEN`）能冒充**任意**运营者——
 * 凭空声明一个 super admin 的 id 就能建号、停号、重置 MFA。拆钥匙（PR A）没有改变这一点。
 *
 * ── 判据：六条全过才放，任一不符即 401 ──
 * 发送方把该运营者**自己的会话 access token** 放在 `x-vxture-actor-token`（admin-bff 的
 * `auth.middleware` 与 arche-bff 的 `operator-auth.middleware` 都把它挂在请求上下文里），
 * 这里逐条核：
 *   1. `keys.verify`：签名 / iss / exp（`OidcKeyService.verify` 只验这三样，**不验 aud**）；
 *   2. `aud ∈ ACTOR_TOKEN_AUDIENCES`（admin、arche——只有这两个 RP 调账号路由；client id 常量在
 *      `bff/admin-bff/src/oidc/oidc-rp.module.ts` 与 `bff/arche-bff/src/oidc/oidc-rp.module.ts`，
 *      `OIDC_CLIENT_ID` 可覆盖但部署里没有覆盖）。opera 的会话票**不收**：opera-bff 持内部口令，
 *      却不是账号路由的合法调用方，它只需要 step-up；产品的 OBO 票 aud 是产品码，这一条就挡掉；
 *   3. `userType === "operator"` 且 `sub` 以 `opr_` 开头；
 *   4. 不是 step-up 票（`stepup !== true`）、不是 OBO / 管理票（无 `act`、`scope` 不以 `mgmt:` 开头）
 *      ——第 2 条已经挡住它们，这一条是纵深；
 *   5. 是 access token 不是 id_token：`sid` 为非空字符串 **且** `Array.isArray(roles)`。
 *      `buildAccessClaims`（`token/access-claims.ts`）对每一张 access token 都写 `roles`（缺省
 *      `[]`），id_token（`oidc.service.ts` 的 `issueAccessAndId` 尾部）带 `sid`/`auth_time`/profile
 *      但从不带 `roles`——这就是两者的判别式，spec 用两种形状钉住；
 *   6. **中央会话仍在**：`redis.getOidcSession(sid)` 非空且其 `sub === claims.sub`。停用 / 强制
 *      下线 / MFA 重置走 `endOperatorSessions`，它删中央会话但**从不写 jti 黑名单**（黑名单的唯一
 *      写者是无人调用的 `/oidc/revoke`），所以「下线后旧票立刻失效」只能靠这一条，窗口为零
 *      而不是 access token 的 15 分钟。
 *   再加绑定本身：`stripSubPrefix(sub) === body.actorOperatorId`。
 *
 * ── 三个错误码，按「哪一组判据没过」分，不按哪一个 claim ──
 *   · `actor_token_missing`  头不在；
 *   · `actor_token_invalid`  第 1–5 条任一不过：这张票不是「允许的 RP 发给运营者的会话 access token」；
 *   · `actor_token_mismatch` 票本身可信，但绑不到请求体点名的那个人：`sub` 与 `actorOperatorId`
 *     不符、或 `sid` 对应的中央会话已不在 / 不属于这个 `sub`（第 6 条）。
 *   响应里只有码；哪个 claim 不过只在服务端的限速 warn 里能看到个大概（也只到组一级）。
 *
 * ── 挂法 ──
 * **类级** `@UseGuards(InternalAuthGuard, ActorBindingGuard)`：`check-internal-route-policy.mjs`
 * 只扫类级装饰器块，方法级会让它看不见；同时它反过来要求——声明 `actor: "token-bound"` 的
 * 路由所在 controller 必须挂着这道门，挂着这道门的 controller 不许再有 `declared-unbound`。
 * 顺序：口令（401）→ 路由准入（403）→ 主体绑定（401）。前两道在 `InternalAuthGuard` 里，
 * 所以持口令者能从 403/401 的差别里读出路由存不存在——它已经持有口令，这不是本门要防的人。
 * 这个顺序**不是写法自由**：反过来写（或分写成两个 `@UseGuards`——Nest 按装饰器求值序拼 guard
 * 数组，下面那个先跑）没口令的人会先撞到本门、从 invalid / mismatch 的差别里探会话、并让 IdP
 * 查 Redis。`check-internal-route-policy.mjs` 第 ⑧ 条静态钉住（反写 / 分写即红），
 * `operator-admin-internal` / `account-admin-internal` 两份 `*.actor-binding.spec.ts` 各走一遍真 HTTP。
 *
 * ── 部署窗口（不是攻击）──
 * 换上本门的那次 deploy 按「收方先」序重建（`deploy/scripts/lib/service-order.sh`）：auth-bff 换好
 * 到 admin-bff / arche-bff 换好之间，旧发送方不带 `x-vxture-actor-token`，这里回 `actor_token_missing`，
 * 发送方把它压成 503 `operator_admin_unavailable`；两个发送方换上新镜像即自愈。见
 * `docs/50-deployment/15-idp-internal-token-cutover.md` §8 末条。
 *
 * ── 诚实地说它能缩到哪 ──
 * 攻破的 admin-bff 或 arche-bff 只能冒充**此刻在两者之一有活会话的运营者**（同一把口令分不出
 * 谁在调，那是 E2 的题）；会话一结束票立刻失效；不能再凭空声明一个 super admin；opera-bff
 * 与任何产品拿着自己手里的票都进不来。
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { OidcKeyService } from "../oidc/oidc-key.service";
import { RedisService } from "../redis/redis.service";
import { RateLimitedWarn, routeLabel } from "./rejection-warn";

export const ACTOR_TOKEN_HEADER = "x-vxture-actor-token";

/**
 * 允许作为「代为操作者证明」的 RP client id。与两个发送方 `oidc-rp.module.ts` 的 `CLIENT_ID`
 * 常量逐字相同；加一个 RP 要同时改这里与 `check-internal-route-policy.mjs` 看不见的那半
 * （部署里哪些容器拿到 `IDP_INTERNAL_TOKEN`）。opera 刻意不在：它只需要 step-up 票。
 */
export const ACTOR_TOKEN_AUDIENCES: ReadonlySet<string> = new Set([
  "admin",
  "arche",
]);

export type ActorBindingErrorCode =
  | "actor_token_missing"
  | "actor_token_invalid"
  | "actor_token_mismatch";

/** 管理票（OBO）的 scope 前缀；与 `oidc-key.service.ts` 的共同签发不变式同一个字面量。 */
const MGMT_SCOPE_PREFIX = "mgmt:";
const OPERATOR_SUB_PREFIX = "opr_";

interface ActorBindingBody {
  actorOperatorId?: unknown;
}

@Injectable()
export class ActorBindingGuard implements CanActivate {
  private readonly logger = new Logger(ActorBindingGuard.name);
  private readonly warn = new RateLimitedWarn(this.logger);

  // 显式 @Inject：esbuild 不产出 design:paramtypes（见 check-explicit-inject 守卫）。
  constructor(
    @Inject(OidcKeyService) private readonly keys: OidcKeyService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const route = routeLabel(context);
    const reject = (code: ActorBindingErrorCode): never => {
      this.warn.emit(req, `${code} route=${route}`);
      throw new UnauthorizedException(code);
    };

    const token = req.header(ACTOR_TOKEN_HEADER) ?? "";
    if (!token) reject("actor_token_missing");

    // 1. 签名 / iss / exp。验证密钥未配置时 verify 抛错 —— 同样 invalid（fail-closed：
    //    没有验证密钥的 IdP 也签不出任何票，不存在「合法但验不了」的票）。
    let claims: Record<string, unknown>;
    try {
      claims = this.keys.verify(token);
    } catch {
      return reject("actor_token_invalid");
    }
    const sub = claims["sub"];
    const sid = claims["sid"];
    if (!isAllowedOperatorSessionAccessToken(claims)) {
      return reject("actor_token_invalid");
    }

    // 绑定：请求体点名的人必须就是票的主人。
    const body = (req.body ?? {}) as ActorBindingBody;
    const declared = body.actorOperatorId;
    if (
      typeof declared !== "string" ||
      !declared ||
      stripOperatorSubPrefix(sub as string) !== declared
    ) {
      return reject("actor_token_mismatch");
    }

    // 6. 中央会话仍在且属于这个 sub —— 停用 / 强制下线后旧票在这里立刻失效。
    //    Redis 不可用时 getOidcSession 抛 503，原样放出去：那不是「票不对」，是基础设施，
    //    把它压成 401 会让排障去怀疑发送方。
    const session = await this.redis.getOidcSession(sid as string);
    if (!session || session.sub !== sub) {
      return reject("actor_token_mismatch");
    }
    return true;
  }
}

/**
 * 第 2–5 条：这张票是不是「允许的 RP 发给运营者的会话 access token」。纯函数，spec 直接打。
 * 返回 false 的原因刻意不区分——响应只有一个码。
 */
export function isAllowedOperatorSessionAccessToken(
  claims: Record<string, unknown>,
): boolean {
  const aud = claims["aud"];
  if (typeof aud !== "string" || !ACTOR_TOKEN_AUDIENCES.has(aud)) return false;
  if (claims["userType"] !== "operator") return false;
  const sub = claims["sub"];
  if (typeof sub !== "string" || !sub.startsWith(OPERATOR_SUB_PREFIX)) {
    return false;
  }
  if (claims["stepup"] === true) return false;
  if (claims["act"] !== undefined) return false;
  const scope = claims["scope"];
  if (typeof scope === "string" && scope.startsWith(MGMT_SCOPE_PREFIX)) {
    return false;
  }
  const sid = claims["sid"];
  if (typeof sid !== "string" || !sid) return false;
  if (!Array.isArray(claims["roles"])) return false;
  return true;
}

/** `opr_<id>` → `<id>`。只认 operator 前缀；调用前已经断过前缀。 */
function stripOperatorSubPrefix(sub: string): string {
  return sub.slice(OPERATOR_SUB_PREFIX.length);
}
