/**
 * Operation-bound ownership verification, independent of login/session refresh.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-10
 */
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  createHash,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
// ⚠️ Cross-layer reference: verify credentials through public identity APIs only.
import { AccountService, CustomerMfaRepository } from "@vxture/service-account";
import { PgOperatorRepository } from "@vxture/service-iam";
import { MailService } from "@vxture/service-mail";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { CustomerMfaService } from "../oidc/customer-mfa.service";
import { OperatorMfaService } from "../oidc/operator-mfa.service";
import { OperatorWebauthnService } from "../oidc/operator-webauthn.service";
import {
  RealmSessionService,
  type IdentityRealm,
} from "../oidc/realm-session.service";
import { RedisService } from "../redis/redis.service";
import { CustomerPhoneCodeService } from "./customer-phone-code.service";

interface Ownership {
  realm: IdentityRealm;
  sid: string;
  userId: string;
  version: string;
  methods: string[];
  phone?: string | undefined;
  email?: string | undefined;
}
interface ProofRecord extends Omit<Ownership, "methods" | "phone" | "email"> {
  operation: string;
  target: string;
  method: string;
  phase: "pending" | "busy" | "proof";
  expiresAt: number;
  attempts: number;
  digest?: string;
  address?: string | undefined;
  challenge?: string;
}

// ============================================================================
// Policy and fresh credential state
// ============================================================================
@Injectable()
export class AccountReauthenticationService {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RealmSessionService) private readonly realms: RealmSessionService,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(CustomerMfaRepository)
    private readonly factors: CustomerMfaRepository,
    @Inject(PgOperatorRepository)
    private readonly operators: PgOperatorRepository,
    @Inject(CustomerMfaService)
    private readonly customerMfa: CustomerMfaService,
    @Inject(OperatorMfaService)
    private readonly operatorMfa: OperatorMfaService,
    @Inject(OperatorWebauthnService)
    private readonly webauthn: OperatorWebauthnService,
    @Inject(CustomerPhoneCodeService)
    private readonly sms: CustomerPhoneCodeService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  private scope(realm: IdentityRealm, operation: unknown, target: unknown) {
    const allowed =
      realm === "customer"
        ? [
            "password",
            "phone-change",
            "email-change",
            "account-login",
            "email-login",
            "identity-link",
            "identity-unlink",
            "mfa-enable",
          ]
        : [
            "password",
            "phone-change",
            "email-change",
            "passkey-add",
            "passkey-remove",
          ];
    if (
      typeof operation !== "string" ||
      !allowed.includes(operation) ||
      typeof target !== "string" ||
      target.length > 512
    )
      throw new BadRequestException("invalid_security_request");
    return { operation, target };
  }

  private async owner(
    realm: IdentityRealm,
    sid: string | undefined,
  ): Promise<Ownership> {
    if (realm === "customer") {
      const ctx = await this.realms.requireCustomer(sid);
      if (ctx.user.status !== "active")
        throw new BadRequestException("account_not_active");
      const factor = await this.factors.read(ctx.userId);
      const methods = factor
        ? ["totp", "recovery"]
        : [
            ...(ctx.user.hasPassword ? ["password"] : []),
            ...(ctx.user.phoneVerified ? ["phone"] : []),
            ...(ctx.user.emailVerified && ctx.user.email ? ["email"] : []),
          ];
      return {
        realm,
        sid: ctx.sid,
        userId: ctx.userId,
        methods,
        phone: ctx.user.phone,
        email: ctx.user.email ?? undefined,
        version: createHash("sha256")
          .update(
            JSON.stringify([
              await this.accounts.selfSecurityVersion(ctx.userId),
              factor?.version ?? null,
            ]),
          )
          .digest("hex"),
      };
    }
    const userId = await this.realms.requireOperator(sid);
    const operator = await this.operators.findById(userId);
    if (!operator?.authenticationVersion)
      throw new BadRequestException("security_proof_stale");
    const policy = await this.operatorMfa.resolveLoginMfa(userId);
    return {
      realm,
      sid: sid!,
      userId,
      version: operator.authenticationVersion,
      methods: policy.methods.flatMap((method) =>
        method === "totp" ? ["totp", "recovery"] : [method],
      ),
    };
  }

  /** Capture the customer credential version before an action is authorized. */
  customerVersion(userId: string) {
    return this.accounts.selfSecurityVersion(userId);
  }
  async customerFactorVersion(userId: string) {
    return (await this.factors.read(userId))?.version ?? null;
  }

  async options(
    realm: IdentityRealm,
    sid: string | undefined,
    operation: unknown,
    target: unknown,
  ) {
    this.scope(realm, operation, target);
    return { methods: (await this.owner(realm, sid)).methods, expiresIn: 300 };
  }

  // ============================================================================
  // Proof creation and factor verification
  // ============================================================================
  async start(
    realm: IdentityRealm,
    sid: string | undefined,
    body: Record<string, unknown>,
  ) {
    const scope = this.scope(realm, body.operation, body.target);
    const owner = await this.owner(realm, sid);
    const method = typeof body.method === "string" ? body.method : "";
    if (!owner.methods.includes(method))
      throw new BadRequestException("invalid_verification_method");
    await this.budget(owner);
    const id = randomUUID();
    const record: ProofRecord = {
      realm,
      sid: owner.sid,
      userId: owner.userId,
      version: owner.version,
      ...scope,
      method,
      phase: "pending",
      attempts: 0,
      expiresAt: Date.now() + 300000,
    };
    let options;
    let code = "";
    if (method === "phone" || method === "email") {
      record.address = method === "phone" ? owner.phone : owner.email;
      code = String(randomInt(0, 1000000)).padStart(6, "0");
      record.digest = this.digest(id, code);
    } else if (method === "webauthn") {
      options = await this.webauthn.createAuthenticationOptions(
        owner.userId,
        false,
      );
      record.challenge = options.challenge;
    }
    // A dispatching ticket cannot be verified until delivery has completed.
    const staged = JSON.stringify({ ...record, phase: "busy" });
    if (!(await this.redis.createAccountReauthentication(id, staged)))
      throw new BadRequestException("security_proof_expired");
    try {
      if (method === "phone")
        await this.sms.sendCode(record.address!.replace(/^\+86/, ""), {
          scope: "customer-security",
          context: id,
        });
      if (method === "email")
        await this.mail.sendVerifyCode(record.address!, code);
      if (
        !(await this.redis.swapAccountReauthentication(
          id,
          staged,
          JSON.stringify(record),
        ))
      )
        throw new BadRequestException("security_proof_expired");
    } catch (error) {
      await this.redis.swapAccountReauthentication(id, staged, null);
      throw error;
    }
    return { verificationId: id, options, expiresIn: 300 };
  }

  async verify(
    realm: IdentityRealm,
    sid: string | undefined,
    id: string,
    body: Record<string, unknown>,
  ) {
    const { owner, record, raw } = await this.load(realm, sid, id);
    if (record.phase !== "pending")
      throw new BadRequestException("security_proof_required");
    await this.budget(owner);
    record.phase = "busy";
    record.attempts++;
    const busy = JSON.stringify(record);
    if (!(await this.redis.swapAccountReauthentication(id, raw, busy)))
      throw new BadRequestException("security_proof_required");
    let accepted = false;
    try {
      const code =
        typeof body.code === "string" && body.code.length <= 128
          ? body.code.trim()
          : "";
      if (record.method === "password") {
        accepted =
          typeof body.password === "string" &&
          (await this.accounts.verifySelfPassword(owner.userId, body.password));
      } else if (record.method === "phone") {
        accepted =
          /^\d{6}$/.test(code) &&
          (await this.sms.verifyCode(
            record.address!.replace(/^\+86/, ""),
            code,
            { scope: "customer-security", context: id },
          ));
      } else if (record.method === "email") {
        accepted =
          /^\d{6}$/.test(code) &&
          timingSafeEqual(
            Buffer.from(record.digest!, "hex"),
            Buffer.from(this.digest(id, code), "hex"),
          );
      } else if (["totp", "recovery"].includes(record.method)) {
        accepted =
          realm === "customer"
            ? await this.customerMfa.verify(owner.userId, record.method, code)
            : await this.operatorMfa.verifySecondFactor({
                operatorId: owner.userId,
                method: record.method,
                code,
              });
      } else if (
        record.method === "webauthn" &&
        body.response &&
        typeof body.response === "object"
      ) {
        accepted = await this.webauthn.verifyAuthentication(
          owner.userId,
          body.response as AuthenticationResponseJSON,
          record.challenge,
        );
      }
      // Logout, credential changes and factor replacement during verification invalidate it.
      const current = await this.owner(realm, sid);
      accepted = accepted && current.version === record.version;
    } catch (error) {
      await this.redis.swapAccountReauthentication(id, busy, null);
      throw error;
    }
    record.phase = accepted ? "proof" : "pending";
    if (
      !(await this.redis.swapAccountReauthentication(
        id,
        busy,
        !accepted && record.attempts >= 5 ? null : JSON.stringify(record),
      )) ||
      !accepted
    )
      throw new BadRequestException(
        record.method === "password"
          ? "invalid_current_password"
          : "invalid_security_code",
      );
    return { proofToken: id, expiresAt: record.expiresAt };
  }

  // ============================================================================
  // Exact-operation authorization and one-use consumption
  // ============================================================================
  async require(
    realm: IdentityRealm,
    sid: string | undefined,
    token: unknown,
    operation: string,
    target: string,
    consume = false,
  ) {
    this.scope(realm, operation, target);
    const { record, raw } = await this.load(realm, sid, token);
    if (
      record.phase !== "proof" ||
      record.operation !== operation ||
      record.target !== target ||
      (consume &&
        !(await this.redis.swapAccountReauthentication(
          token as string,
          raw,
          null,
        )))
    )
      throw new BadRequestException("security_proof_required");
  }

  private async load(
    realm: IdentityRealm,
    sid: string | undefined,
    token: unknown,
  ) {
    if (typeof token !== "string" || !/^[0-9a-f-]{36}$/.test(token))
      throw new BadRequestException("security_proof_required");
    const owner = await this.owner(realm, sid);
    const raw = await this.redis.readAccountReauthentication(token);
    if (!raw) throw new BadRequestException("security_proof_expired");
    const record = JSON.parse(raw) as ProofRecord;
    if (
      record.realm !== realm ||
      record.userId !== owner.userId ||
      record.sid !== owner.sid ||
      record.version !== owner.version ||
      record.expiresAt <= Date.now() ||
      !owner.methods.includes(record.method)
    )
      throw new BadRequestException("security_proof_stale");
    return { owner, record, raw };
  }

  private async budget(owner: Ownership) {
    if (
      !(await this.redis.reserveCustomerSecurityBudget(
        `reauth:${owner.realm}:${owner.userId}`,
        [10, 50, 100],
      ))
    )
      throw new HttpException("too_many_attempts", 429);
  }
  private digest(id: string, code: string) {
    return createHash("sha256").update(`${id}:${code}`).digest("hex");
  }
}
