-- ═══════════════════════════════════════════════════════════════════════════
-- 30_kyc.sql — schema kyc（实名 / 认证，敏感隔离）
-- 设计权威：docs/design/data_identity_200_schema.md §4
-- 域内 FK 内联；本 schema 全部引用均为跨 schema（→account/→tenancy/→product），
--   一律见 90_cross_schema_fk.sql（铁律一）。reviewer_id 逻辑引用 operator 主体，
--   属 realm 隔离边界#2，裸 UUID 不建 FK（铁律七）。
-- 表序 = 域内依赖序：user_kycs / tenant_verifications / verification_policies（三表互不引用）。
-- ═══════════════════════════════════════════════════════════════════════════

-- 个人实名（§4.1，预留·铁律四建全不接线）。与 user 1:1，PK=user_id。
-- id_no 加密存储（bytea 密文，非明文）；reviewer_id 逻辑引用 admin.operator_accounts（边界#2，不建 FK）。
-- user_id 跨 schema→account.users（见 90，ON DELETE CASCADE）。敏感表，无软删（硬约束生命周期随 user）。
CREATE TABLE kyc.user_kycs (
    user_id          uuid         PRIMARY KEY,                     -- 跨 schema→account.users（90，CASCADE）
    real_name        varchar(64),
    id_type          varchar(32),
    id_no_encrypted  bytea,                                        -- 加密存储，非明文
    status           varchar(32)  NOT NULL DEFAULT 'unverified',
    verified_at      timestamptz,
    reviewer_id      uuid,                                         -- 逻辑引用 admin.operator_accounts（边界#2，不建 FK）
    reject_reason    varchar(255),
    created_at       timestamptz  NOT NULL DEFAULT now(),
    updated_at       timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_user_kycs_id_type CHECK (id_type IN ('id_card','passport','hk_macao_permit','taiwan_permit','foreign_permanent_resident')),
    CONSTRAINT chk_user_kycs_status  CHECK (status IN ('unverified','pending','verified','rejected'))
);
CREATE INDEX idx_user_kycs_status      ON kyc.user_kycs (status);
CREATE INDEX idx_user_kycs_reviewer_id ON kyc.user_kycs (reviewer_id);

-- 组织实名明细（§4.2，预留）。审核流水权威在本表；tenancy.tenants.verification_status/_type 为反规范化只读快查。
-- tenant_id 跨 schema→tenancy.tenants（见 90，ON DELETE CASCADE）；reviewer_id 同上逻辑引用（边界#2，不建 FK）。
CREATE TABLE kyc.tenant_verifications (
    id                          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   uuid         NOT NULL,               -- 跨 schema→tenancy.tenants（90，CASCADE）
    verification_type           varchar(32)  NOT NULL,               -- 主体轴：individual / enterprise
    verification_method         varchar(32)  NOT NULL DEFAULT 'lite', -- 方式轴（2026-09-06）：lite 简易 / face 法人扫脸 / documents 提交资料
    company_name                varchar(128),                        -- 认证申报的企业名称（方式一必填；审核通过后即租户认证名）
    business_license_no         varchar(64),
    business_license_image_ref  varchar(255),                       -- 对象存储引用
    legal_person_name           varchar(64),
    status                      varchar(32)  NOT NULL DEFAULT 'unverified',
    reviewer_id                 uuid,                               -- 逻辑引用 admin.operator_accounts（边界#2，不建 FK）
    reviewed_at                 timestamptz,
    reject_reason               varchar(255),
    created_at                  timestamptz  NOT NULL DEFAULT now(),
    updated_at                  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_tenant_verifications_type   CHECK (verification_type IN ('individual','enterprise')),
    -- 方式轴与主体轴正交：能力差异（可订阅 / 可开票）按方式派生，见 console 认证页设计
    CONSTRAINT chk_tenant_verifications_method CHECK (verification_method IN ('lite','face','documents')),
    CONSTRAINT chk_tenant_verifications_status CHECK (status IN ('unverified','pending','verified','rejected'))
);
CREATE INDEX idx_tenant_verifications_tenant_id   ON kyc.tenant_verifications (tenant_id);
CREATE INDEX idx_tenant_verifications_status      ON kyc.tenant_verifications (status);
CREATE INDEX idx_tenant_verifications_reviewer_id ON kyc.tenant_verifications (reviewer_id);

-- KYC 门控策略（§4.3，2026-07-04 从 commerce 域移入）。"何时要求实名"的策略配置。
-- product_id NULL=平台基准值（每 tenant_type 一行）；非 NULL=该产品策略。product_id 跨 schema→product.products（见 90）。
-- 校验逻辑（创建付费订阅时按 (product_id,tenant_type) 查本表 → 校验 tenant_verifications/user_kycs）留应用层，不下沉 DB CHECK。
CREATE TABLE kyc.verification_policies (
    id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id            uuid,                                     -- 跨 schema→product.products（90，NULL 允许）
    tenant_type           varchar(32)  NOT NULL,
    require_verification  boolean      NOT NULL,
    required_type         varchar(32),
    created_at            timestamptz  NOT NULL DEFAULT now(),
    updated_at            timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_verification_policies_tenant_type   CHECK (tenant_type IN ('personal','organization')),
    CONSTRAINT chk_verification_policies_required_type CHECK (required_type IN ('individual','enterprise'))
);
CREATE INDEX idx_verification_policies_product_id ON kyc.verification_policies (product_id);
-- 产品级策略：每 (product_id, tenant_type) 唯一
CREATE UNIQUE INDEX uq_verification_policies_product_tenant_type
    ON kyc.verification_policies (product_id, tenant_type) WHERE product_id IS NOT NULL;
-- 平台基准值：每 tenant_type 仅一行（product_id IS NULL）
CREATE UNIQUE INDEX uq_verification_policies_platform_baseline
    ON kyc.verification_policies (tenant_type) WHERE product_id IS NULL;
