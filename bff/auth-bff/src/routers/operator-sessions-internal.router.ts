/**
 * operator-sessions-internal.router.ts — 运营者在线会话（内部只读）。
 * @package @vxture/bff-auth
 *
 * 治理平台（arche-bff）的「在线会话」从这里取。在线 = IdP 中央会话仍在（realm=workforce），
 * 不是「刷新令牌表里还有 active 行」：令牌链会被并发刷新的重放判定整条吊销，而中央会话
 * 仍在、静默 SSO 照样放行，按令牌表判在线会把登录着的人显示成不在线。
 *
 * Server-to-server only（InternalAuthGuard / AUTH_INTERNAL_TOKEN）。
 *
 * **sid 不出本进程**：sid 就是 IdP 会话 cookie 的值，拿到它等于拿到会话。对外只给
 * `sessionRef` = sha256(sid) 前 32 位十六进制；调用方用同一算法对「当前请求的 sid」求值，
 * 就能认出「当前会话」这一行，而不需要知道任何人的 sid。
 */
import { createHash } from "node:crypto";
import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { InternalAuthGuard } from "../authn/internal-auth.guard";
import { RedisService } from "../redis/redis.service";

export interface InternalOperatorSession {
  sessionRef: string;
  operatorId: string;
  authMethod: string;
  /** 这个会话登录过的平台（client_id）。 */
  clients: string[];
  createdAt: string;
  expiresAt: string;
}

/** 与 arche-bff 的同名函数同一算法（两边各写一份，不共享代码）。 */
export function sessionRefOf(sid: string): string {
  return createHash("sha256").update(sid).digest("hex").slice(0, 32);
}

const OPERATOR_SUB_PREFIX = "opr_";

@Controller("internal/operator/sessions")
@UseGuards(InternalAuthGuard)
export class OperatorSessionsInternalRouter {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  @Get()
  async list(): Promise<{ sessions: InternalOperatorSession[] }> {
    const sessions = await this.redis.listOperatorSessions();
    return {
      sessions: sessions
        .filter((session) => session.sub.startsWith(OPERATOR_SUB_PREFIX))
        .map((session) => ({
          sessionRef: sessionRefOf(session.sid),
          operatorId: session.sub.slice(OPERATOR_SUB_PREFIX.length),
          authMethod: session.authMethod,
          clients: [...session.clients].sort(),
          createdAt: new Date(session.createdAt * 1000).toISOString(),
          expiresAt: new Date(session.absExpiresAt * 1000).toISOString(),
        })),
    };
  }
}
