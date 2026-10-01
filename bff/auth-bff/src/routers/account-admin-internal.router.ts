/**
 * account-admin-internal.router.ts — internal IdP endpoints for admin-delegated
 * customer account management (C12: disable / enable / force-logout).
 * @package @vxture/bff-auth
 *
 * Server-to-server only (InternalAuthGuard / AUTH_INTERNAL_TOKEN). admin-bff, on
 * behalf of an authenticated operator, delegates customer account status/session
 * mutations here — the IdP owns customer credentials & sessions (realm=customer).
 * Realm-isolated: AccountService resolves targets via account.users only, so an
 * operator id yields 404. NEVER exposed publicly (nginx must not route /internal/*).
 *
 * Unlike the operator router there is no rank gate (operators managing customers is
 * not a cross-peer action) and no anti-lockout (an operator may fully disable an
 * abusive customer). Credential reset for customers (out-of-band; social-only vs
 * verified-email semantics) is a deferred follow-up, not in this router.
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AccountService } from "@vxture/service-account";
import { InternalAuthGuard } from "../authn/internal-auth.guard";
import { InternalRoute } from "../authn/internal-route-policy";

/**
 * S2S 请求体。admin-bff 的 `delegate` 一直就送 `{ actorOperatorId, reason }`——本路由此前
 * 把整个 body 丢掉了，所以运营填的原因走到 IdP 就没了。
 *
 * `actorOperatorId` 这一批不用：客户正文里点名一个运营者的身份既无必要也是泄露，客户要
 * 知道的是「平台做了这件事，原因是什么」。留着声明是为了说明这个字段确实在线上、不是猜的。
 */
interface AdminAccountActionBody {
  actorOperatorId?: string;
  reason?: string;
}

/**
 * 运营填的原因：**必填**（owner 2026-09-29 裁定第 3 条），并原样进客户正文。
 *
 * 为什么门守在这里而不是只守在 admin 的表单上：表单是可以绕过的（这是 S2S 端点），而
 * 「没有原因」的下游后果不是少一个字段，是**整条客户通知发不出去**——被平台锁掉的人于是
 * 只能从一个他打不开的界面里猜为什么。空原因当场 400，比静默发一条半截话好。
 *
 * 这一条与 admin-bff 把那个字段改必填是**同一批的两半**：先合本半的话，admin 侧还在送
 * undefined 的窗口期里这三个端点会 400。两半同一个 tag 出。
 */
function requireReason(body: AdminAccountActionBody | undefined): string {
  const reason = body?.reason?.trim();
  if (!reason) throw new BadRequestException("reason_required");
  return reason;
}

@Controller("internal/account/users")
@UseGuards(InternalAuthGuard)
export class AccountAdminInternalRouter {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {}

  // POST /internal/account/users/:id/disable — status='disabled' + revoke all sessions.
  @InternalRoute({
    risk: "admin-action",
    actor: "declared-ignored",
    why: "admin-bff 代运营者停用客户账号。本路由有意不读 actorOperatorId —— 客户正文里点名一个运营者既无必要也是泄露（见文件头）",
  })
  @Post(":id/disable")
  @HttpCode(HttpStatus.OK)
  async disable(
    @Param("id") id: string,
    @Body() body: AdminAccountActionBody,
  ): Promise<{ ok: true; status: string; revoked: number }> {
    const { user, revoked } = await this.accounts.adminDisableAccount(
      id,
      requireReason(body),
    );
    return { ok: true, status: user.status, revoked };
  }

  // POST /internal/account/users/:id/enable — status='active'.
  @InternalRoute({
    risk: "admin-action",
    actor: "declared-ignored",
    why: "停用的反向动作。同样不读 actorOperatorId",
  })
  @Post(":id/enable")
  @HttpCode(HttpStatus.OK)
  async enable(
    @Param("id") id: string,
    @Body() body: AdminAccountActionBody,
  ): Promise<{ ok: true; status: string }> {
    const user = await this.accounts.adminEnableAccount(
      id,
      requireReason(body),
    );
    return { ok: true, status: user.status };
  }

  // POST /internal/account/users/:id/sessions/revoke — revoke all active customer sessions.
  @InternalRoute({
    risk: "admin-action",
    actor: "declared-ignored",
    why: "强制客户下线。同样不读 actorOperatorId",
  })
  @Post(":id/sessions/revoke")
  @HttpCode(HttpStatus.OK)
  async revokeSessions(
    @Param("id") id: string,
    @Body() body: AdminAccountActionBody,
  ): Promise<{ ok: true; revoked: number }> {
    const { revoked } = await this.accounts.adminForceLogout(
      id,
      requireReason(body),
    );
    return { ok: true, revoked };
  }
}
