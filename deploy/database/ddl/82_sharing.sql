-- ═══════════════════════════════════════════════════════════════════════════
-- 82_sharing.sql — schema sharing（SharingGrant 策略 SoT + 物化可见集）
-- 设计权威：docs/design/data_sharing_200_schema.md（字段级）/ data_sharing_100（架构）；
-- 模型语义：product_110_sharing-isolation.md §8；决策：ADR-12 D2（M5 建库 = product_310 P4.2）。
-- 3 表：grants（SoT，一行=一条授权，撤销保留行、重授新行）+ visible_set_current /
--   visible_set_refresh（惰性 TTL 物化，非 SoT，可 TRUNCATE 全量重建）。
-- 资产本体永不进平台：resource_ref = 业务面资产 id，loose（铁律一边界#1，不建 FK）。
-- 跨 schema FK（→ tenancy.tenants/workspaces、product.products）一律不内联，见 cross_schema_fks（铁律一）。
-- org 内机制三角一致（跨 org grant 结构上不可写入）由 95_triggers.sql 的 tenant 一致性触发器加固。
-- 表序 = 域内依赖序：grants → visible_set_current → visible_set_refresh（互无域内 FK）。
-- ═══════════════════════════════════════════════════════════════════════════

-- SharingGrant SoT。actor 沿用 commerce §0.1 约定（*_by_type + *_by_id loose 对，边界#2 不建 FK）：
-- 发起常态 = customer（属主 WS 管理员），运营代操作 / 系统预设（org-all 模板）跨 realm。
-- 行仅两次可变写（建、撤销），无独立 history 表；全量轨迹归 support.audit_logs。
-- expires_at 与撤销是两条独立轴：到期不改 status，求值/物化按时刻过滤，事件由扫描 Job 补发。
CREATE TABLE sharing.grants (
    id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              uuid          NOT NULL,                    -- 跨 schema→tenancy.tenants（org 内机制硬约束）
    resource_type          varchar(32)   NOT NULL,                    -- 三类 day-one 建全（v1 仅 dataset 有消费者）
    resource_product_id    uuid          NOT NULL,                    -- 跨 schema→product.products（资产归属键）
    resource_workspace_id  uuid          NOT NULL,                    -- 跨 schema→tenancy.workspaces（= 属主 WS）
    resource_ref           varchar(128)  NOT NULL,                    -- 业务面资产 id，loose（边界#1）
    grantee_type           varchar(16)   NOT NULL,                    -- org_all = T 级 org 库预设 grant 形态
    grantee_workspace_id   uuid,                                      -- 跨 schema→tenancy.workspaces（仅 workspace 型）
    grantee_product_id     uuid,                                      -- 跨 schema→product.products（仅 product 型）
    scope                  varchar(16)   NOT NULL,                    -- 值域按 resource_type 参数化（§8.2）
    status                 varchar(16)   NOT NULL DEFAULT 'active',
    expires_at             timestamptz,
    created_by_type        varchar(16)   NOT NULL,
    created_by_id          uuid,                                      -- loose，按 type 解引用（边界#2）
    revoked_at             timestamptz,
    revoked_by_type        varchar(16),
    revoked_by_id          uuid,                                      -- loose，按 type 解引用（边界#2）
    created_at             timestamptz   NOT NULL DEFAULT now(),
    updated_at             timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_grants_resource_type CHECK (resource_type IN ('dataset','knowledge_base','skill')),
    CONSTRAINT chk_grants_grantee_type  CHECK (grantee_type IN ('workspace','product','org_all')),
    CONSTRAINT chk_grants_scope         CHECK (scope IN ('read','retrieve','apply','use')),
    CONSTRAINT chk_grants_status        CHECK (status IN ('active','revoked')),
    CONSTRAINT chk_grants_created_by    CHECK (created_by_type IN ('system','customer','operator')),
    CONSTRAINT chk_grants_revoked_by    CHECK (revoked_by_type IS NULL OR revoked_by_type IN ('system','customer','operator')),
    -- grantee 形态一致性（§8.3，防实现分叉）
    CONSTRAINT chk_grants_grantee_shape CHECK ((grantee_type = 'workspace' AND grantee_workspace_id IS NOT NULL AND grantee_product_id IS NULL) OR (grantee_type = 'product' AND grantee_product_id IS NOT NULL AND grantee_workspace_id IS NULL) OR (grantee_type = 'org_all' AND grantee_workspace_id IS NULL AND grantee_product_id IS NULL)),
    -- scope × resource_type 参数化（§8.2：dataset→read；knowledge_base→retrieve<apply；skill→use）
    CONSTRAINT chk_grants_scope_type CHECK ((resource_type = 'dataset' AND scope = 'read') OR (resource_type = 'knowledge_base' AND scope IN ('retrieve','apply')) OR (resource_type = 'skill' AND scope = 'use')),
    -- 撤销字段成组（撤销 = 置 revoked 保留行；重新授权 = 新建行，不复活旧行）
    CONSTRAINT chk_grants_revoked_pair CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
-- 同一 (resource, grantee, scope) 至多一条活跃行（不同 scope 并存合法，求值就高合成）
CREATE UNIQUE INDEX uq_grants_active ON sharing.grants
  (tenant_id, resource_type, resource_product_id, resource_workspace_id, resource_ref,
   grantee_type, grantee_workspace_id, grantee_product_id, scope)
  NULLS NOT DISTINCT WHERE status = 'active';
-- 物化重算的三条命中路径（§8.3 谓词：workspace / product / org_all）
CREATE INDEX idx_grants_hit_workspace ON sharing.grants (tenant_id, grantee_workspace_id) WHERE status = 'active';
CREATE INDEX idx_grants_hit_product   ON sharing.grants (tenant_id, grantee_product_id)   WHERE status = 'active';
CREATE INDEX idx_grants_hit_org_all   ON sharing.grants (tenant_id)                        WHERE status = 'active' AND grantee_type = 'org_all';
-- 属主视角列表/撤销、资产删除级联撤销反查
CREATE INDEX idx_grants_resource ON sharing.grants (resource_product_id, resource_workspace_id, resource_ref);
-- 到期扫描 Job（status=active 且 expires_at 已过）
CREATE INDEX idx_grants_expiry ON sharing.grants (expires_at) WHERE status = 'active' AND expires_at IS NOT NULL;

-- 物化可见集（一行 = 调用方 × 可见资源；按调用方 (workspace, product) 预展开，对齐 entitlement_current 键法）。
-- 非 SoT：惰性 TTL 缓存，读侧 miss/过期重算，grant 写同事务删锚失效；可整体 TRUNCATE 重建。
-- expires_at = 贡献 grant 中最早到期时刻（保守失效：到期视同缺失触发重算，default-deny 方向安全）。
CREATE TABLE sharing.visible_set_current (
    id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              uuid          NOT NULL,                    -- 跨 schema→tenancy.tenants
    workspace_id           uuid          NOT NULL,                    -- 跨 schema→tenancy.workspaces（调用方 WS）
    product_id             uuid          NOT NULL,                    -- 跨 schema→product.products（调用方 product）
    resource_type          varchar(32)   NOT NULL,
    resource_product_id    uuid          NOT NULL,                    -- 跨 schema→product.products
    resource_workspace_id  uuid          NOT NULL,                    -- 跨 schema→tenancy.workspaces
    resource_ref           varchar(128)  NOT NULL,
    scope                  varchar(16)   NOT NULL,                    -- 多 grant 就高合成后的单值
    expires_at             timestamptz,
    refreshed_at           timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_visible_set_current_resource_type CHECK (resource_type IN ('dataset','knowledge_base','skill')),
    CONSTRAINT chk_visible_set_current_scope         CHECK (scope IN ('read','retrieve','apply','use')),
    CONSTRAINT uq_visible_set_current_row UNIQUE
      (workspace_id, product_id, resource_type, resource_product_id, resource_workspace_id, resource_ref)
);
CREATE INDEX idx_visible_set_current_tenant ON sharing.visible_set_current (tenant_id);

-- 物化新鲜度锚（每调用方一行）：空可见集是合法状态，锚行让"新鲜的空集"可判定。
-- 写失效 = 删锚（行可留待重算清理）：workspace 型删该 WS 锚；product 型删 org 内该 product 锚；org_all 删该 org 全部锚。
CREATE TABLE sharing.visible_set_refresh (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid         NOT NULL,                              -- 跨 schema→tenancy.tenants
    workspace_id  uuid         NOT NULL,                              -- 跨 schema→tenancy.workspaces
    product_id    uuid         NOT NULL,                              -- 跨 schema→product.products
    refreshed_at  timestamptz  NOT NULL DEFAULT now(),
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_visible_set_refresh_caller UNIQUE (workspace_id, product_id)
);
CREATE INDEX idx_visible_set_refresh_tenant ON sharing.visible_set_refresh (tenant_id);

-- ── FK 支撑索引(2026-08-19 全库体检 P2 补齐;audit 类 created_by/updated_by 引用有意不建,父行不删)──
CREATE INDEX idx_grants_resource_workspace       ON sharing.grants (resource_workspace_id);
CREATE INDEX idx_grants_grantee_workspace        ON sharing.grants (grantee_workspace_id);
CREATE INDEX idx_grants_grantee_product          ON sharing.grants (grantee_product_id);
CREATE INDEX idx_visible_set_current_product     ON sharing.visible_set_current (product_id);
CREATE INDEX idx_visible_set_current_res_ws      ON sharing.visible_set_current (resource_workspace_id);
CREATE INDEX idx_visible_set_current_res_product ON sharing.visible_set_current (resource_product_id);
CREATE INDEX idx_visible_set_refresh_product     ON sharing.visible_set_refresh (product_id);
