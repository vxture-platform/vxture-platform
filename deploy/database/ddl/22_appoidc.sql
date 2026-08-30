-- ═══════════════════════════════════════════════════════════════════════════
-- 30_appoidc.sql — schema appoidc（Vxture 作 IdP，向业务/应用/域名 outbound 发身份）
-- 设计权威：docs/design/data_identity_200_schema.md §7
-- 域内 FK 内联（oidc_consents.client_id → oidc_clients.client_id，同 schema）；
-- 跨 schema FK（oidc_consents.user_id→account.users / oidc_clients.product_id→product.products）
-- 一律见 90_cross_schema_fk.sql（铁律一，裸列 + 注释，本文件不内联）。
-- 表序 = 域内依赖序：oidc_clients → signing_keys → oidc_consents。
-- ═══════════════════════════════════════════════════════════════════════════

-- OIDC 出站客户端注册（应用 → 平台）。身份接入方 = oidc_client，≠ product.application ≠ agent。
-- client_id 是 OIDC 协议客户端标识（域内关联键，见 oidc_consents），非 *_no/*_code 可视码。
-- product_id 跨 schema→product.products（真 FK；见 90）。
-- client_kind 把「这行归谁」写成显式事实，不再靠 product_id 是否为 NULL 去猜
-- （2026-08-30，产品登记单一入口：docs/20-specs/000-platform/opera/40-product-registry.md §3）：
--   platform = 平台自有门户（website/console/admin/opera），只由 seed 建，product_id 必为 NULL；
--   product  = 某个已登记产品的接入凭据，product_id 必非 NULL——产品目录之外不存在产品。
-- 两者由 chk_oidc_clients_kind_product 绑死：写不出「像产品却挂不上产品」的行。
-- realm 客户/员工绝对隔离（铁律七）；back_channel_logout_uri 在 back_channel 参与时必填。
CREATE TABLE appoidc.oidc_clients (
    id                        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id                 varchar(64)  NOT NULL,                     -- OIDC 协议客户端标识，域内关联键
    client_secret_hash        varchar(255),                             -- 机密客户端；public client 可空
    realm                     varchar(16)  NOT NULL DEFAULT 'customer',
    product_id                uuid,                                     -- 跨 schema→product.products（90）；与 client_kind 绑定
    client_kind               varchar(16)  NOT NULL DEFAULT 'product',  -- platform / product（见文件头）
    release_channel           varchar(16)  NOT NULL DEFAULT 'stable',
    name                      varchar(96),
    display_name              varchar(128),                             -- 授权页展示名（补齐，铁律四）
    logo_url                  varchar(512),                             -- 授权页展示 logo（补齐，铁律四）
    redirect_uris             text[]       NOT NULL,
    post_logout_redirect_uris text[]       NOT NULL DEFAULT '{}',       -- 登出回跳白名单（补齐，铁律四）
    allowed_scopes            text[]       NOT NULL DEFAULT '{}',       -- 允许申请的 scope 白名单（补齐，铁律四）
    access_token_ttl          int          NOT NULL DEFAULT 900,        -- access_token 有效期(秒)（补齐，铁律四）
    refresh_token_ttl         int          NOT NULL DEFAULT 2592000,    -- refresh_token 有效期(秒)（补齐，铁律四）
    pkce_required             boolean      NOT NULL DEFAULT true,
    -- token 端点客户端认证方式：client_secret_basic（机密客户端，默认）/ none（公共客户端）。
    -- 公共客户端 = RFC 8252 原生应用（如影桌面端）：二进制装不下 secret，凭 PKCE 而非 secret
    -- 在 token 端点证明自己。默认保持 client_secret_basic，存量行零影响。
    token_endpoint_auth_method varchar(24) NOT NULL DEFAULT 'client_secret_basic',
    slo_participation         varchar(32)  NOT NULL DEFAULT 'none',     -- none/back_channel/front_channel
    back_channel_logout_uri   varchar(512),
    status                    varchar(32)  NOT NULL DEFAULT 'active',
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_oidc_clients_client_id       UNIQUE (client_id),
    CONSTRAINT chk_oidc_clients_realm          CHECK (realm IN ('customer','workforce')),
    CONSTRAINT chk_oidc_clients_release_channel CHECK (release_channel IN ('stable','beta','canary')),
    CONSTRAINT chk_oidc_clients_client_kind    CHECK (client_kind IN ('platform','product')),
    -- 归属不变式：平台级 ⇔ 无产品；产品级 ⇔ 有产品。默认 kind=product 配上这条，
    -- 意味着漏传 product_id 的插入直接失败，而不是静默变成一个"平台级"客户端。
    CONSTRAINT chk_oidc_clients_kind_product
        CHECK ((client_kind = 'platform') = (product_id IS NULL)),
    CONSTRAINT chk_oidc_clients_slo            CHECK (slo_participation IN ('none','back_channel','front_channel')),
    CONSTRAINT chk_oidc_clients_token_auth     CHECK (token_endpoint_auth_method IN ('client_secret_basic','none')),
    -- 公共客户端硬不变式：token_endpoint_auth_method='none' ⟹ 强制 PKCE 且不得持有 secret。
    -- 一个"公共却带 secret"或"公共却不强制 PKCE"的行写不进去——把 RFC 8252 的前提焊进数据层，
    -- 而不是靠服务代码每处自觉检查。
    CONSTRAINT chk_oidc_clients_public_pkce
        CHECK (token_endpoint_auth_method <> 'none' OR (pkce_required AND client_secret_hash IS NULL)),
    -- product_251 B-3：「算不算数」最小词表是 active / inactive。原来这里是
    -- 'disabled'——不是词表的扩展，是同一概念的第三种拼法（atlas 用布尔
    -- isActive、runos 用 state/status/lifecycle 三个词）。列名 status 保留：
    -- 规范管接口形状，DDL 是另一层。
    CONSTRAINT chk_oidc_clients_status         CHECK (status IN ('active','inactive')),
    -- back_channel 参与时 back_channel_logout_uri 必填（§7.1）
    CONSTRAINT chk_oidc_clients_bclo_uri
        CHECK (slo_participation <> 'back_channel' OR back_channel_logout_uri IS NOT NULL)
);
CREATE INDEX idx_oidc_clients_realm      ON appoidc.oidc_clients (realm);
CREATE INDEX idx_oidc_clients_product_id ON appoidc.oidc_clients (product_id);
CREATE INDEX idx_oidc_clients_status     ON appoidc.oidc_clients (status);

-- RS256 签名公钥 / 元数据（私钥不落库，进 secret manager）。kid 为自然主键（协议内公开标识）。
-- 状态机 next→active→retiring→retired；部分唯一索引保同一时刻至多一把 active（平滑轮换）。
CREATE TABLE appoidc.signing_keys (
    kid          varchar(64)  PRIMARY KEY,
    algorithm    varchar(16)  NOT NULL DEFAULT 'RS256',
    public_jwk   jsonb        NOT NULL,                                 -- 仅公钥
    status       varchar(16)  NOT NULL DEFAULT 'next',
    activated_at timestamptz,
    retiring_at  timestamptz,
    retired_at   timestamptz,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_signing_keys_status CHECK (status IN ('next','active','retiring','retired'))
);
CREATE INDEX idx_signing_keys_status ON appoidc.signing_keys (status);
-- 至多一把 active（status='active' 的行全同值 → 唯一索引锁定单行）
CREATE UNIQUE INDEX uq_signing_keys_one_active ON appoidc.signing_keys (status) WHERE status = 'active';

-- 用户对客户端的授权 grant（行业缺口补齐，对齐 Hydra consent / Auth0 grant）。
-- user_id 跨 schema→account.users（真 FK，见 90）；client_id 域内 FK→oidc_clients（同 schema，内联）。
-- 授权码 / access_token 明细走 Redis 短存不入库，本表只留持久化 consent。
CREATE TABLE appoidc.oidc_consents (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid         NOT NULL,                                  -- 跨 schema→account.users（90）
    client_id   varchar(64)  NOT NULL
                 REFERENCES appoidc.oidc_clients(client_id) ON DELETE CASCADE,  -- 域内 FK
    scopes      text[]       NOT NULL,                                  -- 用户已授权的 scope 集合
    granted_at  timestamptz  NOT NULL DEFAULT now(),
    revoked_at  timestamptz,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_oidc_consents_user_id   ON appoidc.oidc_consents (user_id);
CREATE INDEX idx_oidc_consents_client_id ON appoidc.oidc_consents (client_id);
-- 每 (user, client) 至多一条未撤销 consent（§7.3）
CREATE UNIQUE INDEX uq_oidc_consents_user_client_active
    ON appoidc.oidc_consents (user_id, client_id) WHERE revoked_at IS NULL;
