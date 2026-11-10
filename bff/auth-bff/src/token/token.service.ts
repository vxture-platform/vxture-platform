/**
 * token.service.ts — the token authority (Identity Platform §6.3).
 *
 * Mints RS256 access tokens (via OidcKeyService / appoidc.signing_keys) carrying the
 * new claim set (sub + active_org + active_workspace + roles; NO entitlement),
 * and opaque refresh tokens stored hashed in session.refresh_tokens with rotation
 * + replay detection.
 */
import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import { OidcKeyService } from "../oidc/oidc-key.service";
import { buildAccessClaims } from "./access-claims";
import {
  hashToken,
  RefreshTokenRepository,
  type RefreshRecord,
  type RefreshStore,
} from "./refresh-token.repository";
import {
  OPERATOR_REFRESH_TOKEN_REPOSITORY,
  REFRESH_TOKEN_REPOSITORY,
} from "./tokens";

export interface IssueAccessInput {
  /** sub claim (e.g. usr_<userId> or opr_<operatorId>). */
  sub: string;
  /** aud claim — the client_id. */
  audience: string;
  sessionId?: string | null;
  activeOrg?: string | null;
  activeOrgType?: string | null;
  activeOrgName?: string | null;
  activeWorkspace?: string | null;
  activeWorkspaceName?: string | null;
  roles?: string[];
  userType?: string;
  ttlSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface IssueRefreshInput {
  userId: string;
  sessionId: string;
  clientId: string;
  ttlSeconds?: number;
  /**
   * "operator" → admin.operator_refresh_token; anything else (default) →
   * session.refresh_tokens. Keeps operator refresh tokens out of the tenant store.
   */
  realm?: string;
}

/**
 * 并发双刷的宽限窗口。行业普遍有这个旋钮：Okta 默认 30 秒（0–60 可配），
 * Auth0 叫 leeway，Duende 把它留成扩展点。我们先取与 Okta 相同的默认值。
 *
 * 它分开的是两件被混为一谈的事：**并发**（同一个客户端的几个请求同时到、
 * 网络抖动重试、SSR 与客户端同时取数）与**入侵**（令牌泄漏后被别人拿去用）。
 * 之前两者都被当成后者，并施以最重的处置。
 */
const REFRESH_GRACE_MS = 30_000;

/** 定位到的一枚 refresh 令牌及它所在的存储。 */
export interface LocatedRefresh {
  store: RefreshStore;
  rec: RefreshRecord;
}

export interface RotatedRefresh {
  refreshToken: string;
  userId: string;
  sessionId: string;
  clientId: string;
}

/** Authenticated client boundary, established before token inspection. */
export interface RefreshBinding {
  clientId: string;
  realm: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @Inject(OidcKeyService) private readonly keys: OidcKeyService,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refresh: RefreshStore,
    @Inject(OPERATOR_REFRESH_TOKEN_REPOSITORY)
    private readonly operatorRefresh: RefreshStore,
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** Refresh store for a realm: operator → ops.*, else tenant → identity.*. */
  private storeFor(realm?: string): RefreshStore {
    return realm === "workforce" ? this.operatorRefresh : this.refresh;
  }

  /** Mint an RS256 access token with the new claim set. */
  issueAccessToken(input: IssueAccessInput): string {
    const claims = buildAccessClaims(input);
    return this.keys.sign(claims, {
      audience: input.audience,
      subject: input.sub,
      expiresInSec: input.ttlSeconds ?? this.config.auth.OIDC_ACCESS_TTL,
    });
  }

  /** Issue a new opaque refresh token (stored hashed); returns the raw token. */
  async issueRefreshToken(input: IssueRefreshInput): Promise<string> {
    const raw = RefreshTokenRepository.newRawToken();
    await this.storeFor(input.realm).insert({
      userId: input.userId,
      sessionId: input.sessionId,
      clientId: input.clientId,
      tokenHash: hashToken(raw),
      ttlSeconds: input.ttlSeconds ?? this.config.auth.OIDC_REFRESH_TTL,
    });
    return raw;
  }

  /**
   * Inspect without rotation, binding the realm and client before replay effects.
   * The caller must then validate current session authority before consumption.
   * @param rawToken - Presented opaque refresh token.
   * @param binding - Authenticated client and its server-controlled identity realm.
   * @returns The active token and its owning store.
   * @throws {UnauthorizedException} For invalid grants or detected replay.
   */
  async inspectRefreshToken(
    rawToken: string,
    binding: RefreshBinding,
  ): Promise<LocatedRefresh> {
    if (
      !binding.clientId ||
      (binding.realm !== "customer" && binding.realm !== "workforce")
    ) {
      throw new UnauthorizedException("invalid_grant");
    }
    // Never search another identity domain, even for an unknown presented token.
    const store = this.storeFor(binding.realm);
    const rec = await store.findByHash(hashToken(rawToken));
    if (
      !rec ||
      rec.clientId !== binding.clientId ||
      rec.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("invalid_grant");
    }
    // Client ownership must be proven before replay detection can revoke a family.
    if (rec.status === "active") return { store, rec };

    /* 已经不是 active。两种可能，处置完全不同：
       (1) 它的子令牌刚生成且仍 active => 别的请求几百毫秒前刚刷过，这是**并发**；
       (2) 没有子令牌、或子令牌已老 => 才是真正的**重放**。 */
    const childAt = await store.findActiveChildIssuedAt(rec.id);
    const withinGrace =
      childAt !== null && Date.now() - childAt.getTime() <= REFRESH_GRACE_MS;

    if (childAt !== null && withinGrace) {
      this.logger.warn(
        "refresh concurrent-rotation within grace window" +
          ` client=${rec.clientId} session=${rec.sessionId}` +
          ` childAgeMs=${Date.now() - childAt.getTime()}`,
      );
      // 只拒这一次，不动任何已签发的令牌。
      throw new UnauthorizedException("invalid_grant");
    }

    this.logger.warn(
      "refresh token reuse detected - revoking this client's family" +
        ` client=${rec.clientId} session=${rec.sessionId}` +
        ` hadChild=${childAt !== null}`,
    );
    /* 只吊这个客户端的家族，不是整条会话——后者会把同一用户在其它门户、
       其它标签页的登录一起踢下线。行业（Auth0 / Okta）都钉在 client 这一层。 */
    await store.revokeSession(rec.sessionId, rec.clientId);
    throw new UnauthorizedException("refresh token reuse detected");
  }

  /**
   * 消费一枚已校验过的令牌，签发后继。
   *
   * CAS 落败**永远不吊销**：那按定义就是「另一个请求刚刚赢了」，是并发不是入侵。
   * 旧写法在这里调 `revokeSession(sessionId)`，而那条 SQL 连**赢家刚插入的新令牌**
   * （status='active'）一起收 —— 于是两个请求同归于尽。
   */
  async consumeRefreshToken(found: LocatedRefresh): Promise<RotatedRefresh> {
    const { store, rec } = found;
    const won = await store.markRotated(rec.id);
    if (!won) {
      this.logger.warn(
        "refresh lost the rotation race - rejecting this call only" +
          ` client=${rec.clientId} session=${rec.sessionId}`,
      );
      throw new UnauthorizedException("invalid_grant");
    }
    const newRaw = RefreshTokenRepository.newRawToken();
    await store.insert({
      userId: rec.userId,
      sessionId: rec.sessionId,
      clientId: rec.clientId,
      tokenHash: hashToken(newRaw),
      ttlSeconds: this.config.auth.OIDC_REFRESH_TTL,
      rotatedFrom: rec.id,
    });
    return {
      refreshToken: newRaw,
      userId: rec.userId,
      sessionId: rec.sessionId,
      clientId: rec.clientId,
    };
  }

  /**
   * Inspect and consume within one authenticated client boundary.
   * OIDC grants inspect separately so live authority can be checked before rotation.
   * @param rawToken - Presented opaque refresh token.
   * @param binding - Authenticated client and its identity realm.
   * @returns The rotated token and its original identity binding.
   * @throws {UnauthorizedException} For invalid grants, concurrent rotation or replay.
   */
  async rotateRefreshToken(
    rawToken: string,
    binding: RefreshBinding,
  ): Promise<RotatedRefresh> {
    return this.consumeRefreshToken(
      await this.inspectRefreshToken(rawToken, binding),
    );
  }

  /**
   * Revoke all live refresh tokens for a session (logout). Realm-blind: a session
   * id lives in exactly one store, so revoke in both (the other no-ops).
   */
  async revokeSession(sessionId: string): Promise<void> {
    await this.refresh.revokeSession(sessionId);
    await this.operatorRefresh.revokeSession(sessionId);
  }

  /**
   * Revoke only the authenticated client's family in its own identity domain.
   * @param rawToken - Presented opaque token; unknown tokens are a no-op.
   * @param binding - Authenticated client and its server-controlled realm.
   * @returns When any matching client family has been revoked.
   * @throws {UnauthorizedException} For an unsupported client identity domain.
   */
  async revokeRefreshToken(
    rawToken: string,
    binding: RefreshBinding,
  ): Promise<void> {
    if (!binding.clientId || !["customer", "workforce"].includes(binding.realm))
      throw new UnauthorizedException("invalid_client");
    const store = this.storeFor(binding.realm);
    const rec = await store.findByHash(hashToken(rawToken));
    if (rec?.clientId === binding.clientId)
      await store.revokeSession(rec.sessionId, binding.clientId);
  }
}
