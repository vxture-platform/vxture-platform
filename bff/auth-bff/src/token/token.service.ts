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

  /**
   * Find a presented refresh token in whichever realm store holds it (tenant
   * first, then operator). Returns the record + its owning store so rotation /
   * revocation stays within the right table.
   */
  private async locate(
    rawToken: string,
  ): Promise<{ store: RefreshStore; rec: RefreshRecord } | null> {
    const hash = hashToken(rawToken);
    const tenant = await this.refresh.findByHash(hash);
    if (tenant) return { store: this.refresh, rec: tenant };
    const operator = await this.operatorRefresh.findByHash(hash);
    if (operator) return { store: this.operatorRefresh, rec: operator };
    return null;
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
   * 校验一枚 refresh 令牌，**不消费它**。
   *
   * 拆出这一步是为了让调用方先把 client 绑定、中央会话、远程下线三项查完
   * 再调 `consumeRefreshToken`。旧写法是先轮换再校验，于是「用错 client_id 刷一次」
   * 或「中央会话已到期」都会先烧掉一枚令牌，而客户端重试时拿的就是那枚已 rotated
   * 的旧令牌 ⇒ 走重放门 ⇒ 整条链被吊。本仓记过这个形状：凭据过了才消耗。
   */
  async inspectRefreshToken(rawToken: string): Promise<LocatedRefresh> {
    const found = await this.locate(rawToken);
    if (!found || found.rec.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("invalid_grant");
    }
    const { store, rec } = found;
    if (rec.status === "active") return found;

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
   * 校验 + 消费一步做完。留给不需要在两者之间插校验的调用方；
   * `tokenWithRefresh` 不走这条，它要在中间查三项。
   */
  async rotateRefreshToken(rawToken: string): Promise<RotatedRefresh> {
    return this.consumeRefreshToken(await this.inspectRefreshToken(rawToken));
  }

  /**
   * Revoke all live refresh tokens for a session (logout). Realm-blind: a session
   * id lives in exactly one store, so revoke in both (the other no-ops).
   */
  async revokeSession(sessionId: string): Promise<void> {
    await this.refresh.revokeSession(sessionId);
    await this.operatorRefresh.revokeSession(sessionId);
  }

  /** Revoke a refresh token by its raw value (RFC 7009) — revokes its session chain. */
  async revokeRefreshToken(rawToken: string): Promise<void> {
    const found = await this.locate(rawToken);
    if (found) await found.store.revokeSession(found.rec.sessionId);
  }
}
