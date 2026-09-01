/**
 * operator-self.service.ts — operator SELF-service account management, authorized
 * by the operator central session cookie (vx_sid_op).
 * @package @vxture/bff-auth
 *
 * Phase B(收敛到身份层,2026-09-02):运营者本人的账户自助(读身份、改邮箱)统一收口在
 * 身份层。此前只有 admin-bff 的 RP 会话代理到 `internal/operator/accounts/:id/contact/
 * email/*`(内部 token + body 自证);本服务把同一套逻辑改为**浏览器直连、`vx_sid_op`
 * cookie 鉴权**,与 operator-webauthn.service 同一 guard 模式(`resolveOperatorId`),供
 * accounts 门户「个人信息」页同源调用,三门户 popover 深链于此。
 *
 * 只覆盖 whoami + 改邮箱(B.1)。改手机/改密码/MFA 自助是 net-new 流程(B.2)。
 * 写入面(admin.operator_account)只经 PgOperatorRepository,与内部委托路径同一张表。
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { randomInt } from "node:crypto";
import { PgOperatorRepository } from "@vxture/service-iam";
import { MailService } from "@vxture/service-mail";
import { RedisService } from "../redis/redis.service";

/** operator central-session `sub` prefix (workforce realm). Mirrors webauthn service. */
const OPERATOR_SUB_PREFIX = "opr_";
/** pending contact-change TTL — matches operator-admin-internal.router. */
const OPERATOR_CONTACT_TTL_SECONDS = 10 * 60;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Mask an email for API responses: b***@example.com. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  const head = local?.slice(0, 1) ?? "";
  return `${head}***@${domain ?? ""}`;
}

export interface OperatorSelfView {
  username: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  /** 角色码(role_code);展示用,不做鉴权。 */
  role: string;
}

@Injectable()
export class OperatorSelfService {
  constructor(
    @Inject(PgOperatorRepository)
    private readonly operators: PgOperatorRepository,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  /**
   * Resolve the operator id from the central session cookie; 401 otherwise.
   * Identical guard to OperatorWebauthnService — the browser must already hold a
   * workforce-realm `vx_sid_op` session.
   */
  private async resolveOperatorId(sid: string | undefined): Promise<string> {
    if (!sid) throw new UnauthorizedException("operator_session_required");
    const session = await this.redis.getOidcSession(sid);
    if (
      !session ||
      session.realm !== "workforce" ||
      !session.sub.startsWith(OPERATOR_SUB_PREFIX)
    ) {
      throw new UnauthorizedException("operator_session_required");
    }
    return session.sub.slice(OPERATOR_SUB_PREFIX.length);
  }

  /** Read the authenticated operator's own account view (no secret material). */
  async getSelf(sid: string | undefined): Promise<OperatorSelfView> {
    const operatorId = await this.resolveOperatorId(sid);
    const view = await this.operators.getOperatorAdminView(operatorId);
    if (!view) throw new UnauthorizedException("operator_session_required");
    return {
      username: view.username,
      email: view.email,
      emailVerified: view.emailVerified,
      phone: view.phone,
      phoneVerified: view.phoneVerified,
      role: view.roleCode,
    };
  }

  /**
   * Self-service email change — step 1: send a 6-digit code to the NEW address
   * (proving ownership). Nothing is mutated here; a pending record is parked in
   * Redis (short TTL). Same logic as the internal delegation path, but authorized
   * by the session cookie instead of an internal token + body self-assertion.
   */
  async startEmailChange(
    sid: string | undefined,
    newEmailRaw: string | undefined,
  ): Promise<{ ok: true; sentTo: string }> {
    const operatorId = await this.resolveOperatorId(sid);
    const newEmail = (newEmailRaw ?? "").trim().toLowerCase();
    if (!newEmail || !EMAIL_RE.test(newEmail)) {
      throw new BadRequestException("invalid_email");
    }
    const view = await this.operators.getOperatorAdminView(operatorId);
    if (!view) throw new UnauthorizedException("operator_session_required");
    const code = String(randomInt(100000, 1000000));
    await this.redis.storeOperatorContactChange(
      operatorId,
      "email",
      newEmail,
      code,
      OPERATOR_CONTACT_TTL_SECONDS,
    );
    await this.mail.sendVerifyCode(newEmail, code);
    return { ok: true, sentTo: maskEmail(newEmail) };
  }

  /**
   * Self-service email change — step 2: submit the code from the new address. On
   * match, writes the new email + email_verified=true (proven owned). Unique
   * collision → 409; bad/expired code → 400.
   */
  async verifyEmailChange(
    sid: string | undefined,
    codeRaw: string | undefined,
  ): Promise<{ ok: true; email: string }> {
    const operatorId = await this.resolveOperatorId(sid);
    const code = (codeRaw ?? "").trim();
    const newEmail = await this.redis.verifyOperatorContactChange(
      operatorId,
      "email",
      code,
    );
    if (!newEmail) throw new BadRequestException("invalid_or_expired_code");
    try {
      const ok = await this.operators.setOperatorContactVerified(
        operatorId,
        "email",
        newEmail,
      );
      if (!ok) throw new UnauthorizedException("operator_session_required");
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        throw new ConflictException("email_in_use");
      }
      throw err;
    }
    return { ok: true, email: newEmail };
  }
}
