/**
 * onboarding-model.ts — 产品页上「登录接入」与「密钥管理」共用的形状与换算。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * 页面里的客户端是**草稿**（字符串字段，一行一个地址），接口要的是数组。换算放在一处：
 * 此前注册在接入凭据页按「换行或逗号」切，详情页改回调按「换行」切——同一份白名单，
 * 两处切法不同，地址里自带逗号时一处对一处错。
 */

export const RELEASE_CHANNELS = ["stable", "beta", "canary"] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

export const CHANNEL_LABEL: Record<ReleaseChannel, string> = {
  stable: "正式",
  beta: "灰度",
  canary: "金丝雀",
};

export type ClientState = "active" | "inactive";
export type AuthMethod = "client_secret_basic" | "none";

/** `GET /api/oidc-clients?productId=` 的一行（opera-bff `OidcClientRecord` 的子集）。 */
export interface ClientRecord {
  clientId: string;
  releaseChannel: ReleaseChannel;
  state: ClientState;
  displayName: string | null;
  logoUrl: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  allowedScopes: string[];
  pkceRequired: boolean;
  tokenEndpointAuthMethod: string;
}

/** `GET /api/products/:id/webhook`。密钥本体永不回传，只有 `hasWebhookSecret`。 */
export interface WebhookRecord {
  homeUrl: string | null;
  webhookUrl: string | null;
  webhookSecretRef: string | null;
  edgeUpstream: string | null;
  edgeDomain: string | null;
  hasWebhookSecret: boolean;
}

export interface ClientDraft {
  /** React key。已存在的客户端是 client_id；新添加的是 `new:<渠道>`——client_id 还能改。 */
  key: string;
  isNew: boolean;
  clientId: string;
  releaseChannel: ReleaseChannel;
  displayName: string;
  logoUrl: string;
  /** 一行一个。白名单是集合，用逗号分隔会在地址自带逗号时静默切错。 */
  redirectUris: string;
  postLogoutRedirectUris: string;
  /** 空格分隔（也收逗号）。 */
  allowedScopes: string;
  pkceRequired: boolean;
  tokenEndpointAuthMethod: AuthMethod;
  state: ClientState;
}

/** 平台 IdP 给产品客户端的默认范围，与 opera-bff `DEFAULT_SCOPES` 一致。 */
export const DEFAULT_SCOPES = "openid profile email phone";

export function draftFromClient(c: ClientRecord): ClientDraft {
  return {
    key: c.clientId,
    isNew: false,
    clientId: c.clientId,
    releaseChannel: c.releaseChannel,
    displayName: c.displayName ?? "",
    logoUrl: c.logoUrl ?? "",
    redirectUris: c.redirectUris.join("\n"),
    postLogoutRedirectUris: c.postLogoutRedirectUris.join("\n"),
    allowedScopes: c.allowedScopes.join(" "),
    pkceRequired: c.pkceRequired,
    tokenEndpointAuthMethod:
      c.tokenEndpointAuthMethod === "none" ? "none" : "client_secret_basic",
    state: c.state,
  };
}

/**
 * 新添加一个渠道的客户端。
 *
 * client_id 预填产品码（正式渠道）或「产品码-渠道」：绝大多数客户端就叫这个。
 * **回调地址不预填**——它必须与产品侧真实实现的路由逐字一致，而平台不知道产品把回调
 * 挂在哪里。预填一个「看起来对」的值，正是回调登记错而全程没人发现的那条路。
 */
export function newClientDraft(
  channel: ReleaseChannel,
  productCode: string,
  productName: string,
): ClientDraft {
  const code = productCode.trim();
  return {
    key: `new:${channel}`,
    isNew: true,
    clientId: code ? (channel === "stable" ? code : `${code}-${channel}`) : "",
    releaseChannel: channel,
    displayName: productName.trim(),
    logoUrl: "",
    redirectUris: "",
    postLogoutRedirectUris: "",
    allowedScopes: DEFAULT_SCOPES,
    pkceRequired: true,
    tokenEndpointAuthMethod: "client_secret_basic",
    state: "active",
  };
}

export function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function splitScopes(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 草稿 → 合并保存里的一个客户端。
 *
 * 认证方式只在新建时送：建后不可改，送了一个不同的值服务端会拒——而页面上那一栏
 * 对已有客户端本来就是锁着的。
 */
export function clientInputFrom(d: ClientDraft) {
  return {
    clientId: d.clientId.trim(),
    releaseChannel: d.releaseChannel,
    displayName: d.displayName.trim() || null,
    logoUrl: d.logoUrl.trim() || null,
    redirectUris: splitLines(d.redirectUris),
    postLogoutRedirectUris: splitLines(d.postLogoutRedirectUris),
    allowedScopes: splitScopes(d.allowedScopes),
    /* 公共客户端强制 PKCE：开关在界面上锁住了，这里再钉一次，防的是「切成公共之前
       先关了 PKCE」留下的脏草稿。 */
    pkceRequired: d.tokenEndpointAuthMethod === "none" ? true : d.pkceRequired,
    ...(d.isNew ? { tokenEndpointAuthMethod: d.tokenEndpointAuthMethod } : {}),
  };
}

/** A–Z、a–z、0–9 的码位区间。按区间拼出字母表，而不是写一串 62 个字符的字面量——
    那串字面量长得正像一把 API key，密钥扫描会把它当成泄漏。 */
const SECRET_ALPHABET = (
  [
    [65, 90],
    [97, 122],
    [48, 57],
  ] as const
)
  .flatMap(([from, to]) =>
    Array.from({ length: to - from + 1 }, (_, i) =>
      String.fromCharCode(from + i),
    ),
  )
  .join("");

/**
 * 生成一把签名密钥：32 位字母数字。
 *
 * 只用字母数字：它要被粘进产品侧的 `.env`，带 `%` `$` `#` 的值在不同的加载器里
 * 各有各的转义规则，一个字符被吞掉，两侧的 HMAC 就对不上，而报错只会是「验签失败」。
 */
export function generateSecret(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(
    bytes,
    (b) => SECRET_ALPHABET[b % SECRET_ALPHABET.length],
  ).join("");
}
