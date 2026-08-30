/**
 * pg-oidc-client.repository.ts - appoidc.oidc_clients 表驱动配置仓储
 * @package @vxture/service-iam
 * @layer Infrastructure
 * @category repository
 *
 * OIDC 出站客户端（应用→平台）的运行时配置，供 auth-bff 的 IdP 端点按 client_id
 * 动态解析（与 oauth_provider 入站方向相反）。配置只读，secret hash 不外泄出本层。
 * 见 docs/design/identity-platform-idp.md §1.1 / §3。
 */
import { compare } from "bcryptjs";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { IAM_PG_POOL } from "../tokens";

export interface OidcClientConfig {
  clientId: string;
  name: string;
  displayName: string | null;
  logoUrl: string | null;
  realm: string; // customer | workforce
  clientSecretHash: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  backChannelLogoutUri: string | null;
  allowedScopes: string[];
  accessTokenTtl: number;
  refreshTokenTtl: number;
  pkceRequired: boolean;
  /**
   * token 端点客户端认证方式。`client_secret_basic` = 机密客户端（凭 secret）；
   * `none` = 公共客户端（RFC 8252 原生应用，如影桌面端），凭 PKCE 而非 secret 认证。
   * 由 DB CHECK 保证 `none` ⟹ pkceRequired 且无 secret hash。
   */
  tokenEndpointAuthMethod: "client_secret_basic" | "none";
  isEnabled: boolean;
  /**
   * The product this client belongs to (T1, product_210 §2/§3.2's act.sub
   * source) — null for platform-level clients (website/console/admin) and
   * client-side products excluded from the entitlement engine (umbra/ruyin).
   */
  productCode: string | null;
}

/** Public-safe branding for a client (no secrets). Served by /oidc/client-info. */
export interface OidcClientInfo {
  clientId: string;
  name: string;
  displayName: string | null;
  logoUrl: string | null;
}

interface OidcClientRow {
  client_id: string;
  name: string;
  display_name: string | null;
  logo_url: string | null;
  realm: string;
  client_secret_hash: string | null;
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
  back_channel_logout_uri: string | null;
  allowed_scopes: string[];
  access_token_ttl: number;
  refresh_token_ttl: number;
  pkce_required: boolean;
  token_endpoint_auth_method: string;
  is_enabled: boolean;
  product_code: string | null;
}

const SELECT_COLUMNS = `
  c.client_id, c.name, c.display_name, c.logo_url, c.realm, c.client_secret_hash,
  c.redirect_uris, c.post_logout_redirect_uris, c.back_channel_logout_uri,
  c.allowed_scopes, c.access_token_ttl, c.refresh_token_ttl,
  c.pkce_required, c.token_endpoint_auth_method,
  (c.status = 'active') as is_enabled, p.product_code
`;

function toConfig(row: OidcClientRow): OidcClientConfig {
  return {
    clientId: row.client_id,
    name: row.name,
    displayName: row.display_name,
    logoUrl: row.logo_url,
    realm: row.realm,
    clientSecretHash: row.client_secret_hash,
    redirectUris: row.redirect_uris ?? [],
    postLogoutRedirectUris: row.post_logout_redirect_uris ?? [],
    backChannelLogoutUri: row.back_channel_logout_uri,
    allowedScopes: row.allowed_scopes ?? [],
    accessTokenTtl: row.access_token_ttl,
    refreshTokenTtl: row.refresh_token_ttl,
    pkceRequired: row.pkce_required,
    tokenEndpointAuthMethod:
      row.token_endpoint_auth_method === "none"
        ? "none"
        : "client_secret_basic",
    isEnabled: row.is_enabled,
    productCode: row.product_code,
  };
}

@Injectable()
export class PgOidcClientRepository {
  constructor(@Inject(IAM_PG_POOL) private readonly pool: Pool) {}

  /** 按 client_id 读取已启用的 OIDC client；未启用或不存在返回 null。 */
  async findEnabledByClientId(
    clientId: string,
  ): Promise<OidcClientConfig | null> {
    const result = await this.pool.query<OidcClientRow>(
      `select ${SELECT_COLUMNS}
         from appoidc.oidc_clients c
         left join product.products p on p.id = c.product_id
        where c.client_id = $1 and c.status = 'active'
        limit 1`,
      [clientId],
    );
    const row = result.rows[0];
    return row ? toConfig(row) : null;
  }

  /**
   * Authenticate a confidential client: load it (if enabled) and verify the
   * presented secret against its bcrypt hash. Returns the config on success,
   * null on unknown/disabled client or a bad secret (caller maps to invalid_client).
   */
  async authenticateClient(
    clientId: string,
    clientSecret: string,
  ): Promise<OidcClientConfig | null> {
    const config = await this.findEnabledByClientId(clientId);
    if (!config || !config.clientSecretHash) return null;
    const ok = await compare(clientSecret, config.clientSecretHash);
    return ok ? config : null;
  }

  /** Public branding for an enabled client (no secrets); for the post-logout/login surface. */
  async getPublicClientInfo(clientId: string): Promise<OidcClientInfo | null> {
    const result = await this.pool.query<{
      client_id: string;
      name: string;
      display_name: string | null;
      logo_url: string | null;
    }>(
      `select client_id, name, display_name, logo_url
         from appoidc.oidc_clients
        where client_id = $1 and status = 'active'
        limit 1`,
      [clientId],
    );
    const row = result.rows[0];
    return row
      ? {
          clientId: row.client_id,
          name: row.name,
          displayName: row.display_name,
          logoUrl: row.logo_url,
        }
      : null;
  }
}
