-- ═══════════════════════════════════════════════════════════════════════════
-- 30_access.sql — schema access（customer realm 治理 RBAC）
-- 设计权威：docs/design/data_identity_200_schema.md §6
-- 域内 FK 内联（permissions 自引用树 / role_permissions 复合 PK）。
-- operator RBAC 独立于 admin.operator_roles/operator_permissions（realm 隔离，边界#2，与本 schema 零 FK）。
-- 表序 = 域内依赖序：roles → permissions → role_permissions。
-- ═══════════════════════════════════════════════════════════════════════════

-- 治理角色（customer realm）。与 admin.operator_role 最大化一致（同为控制台模式 RBAC，
-- 仅用户域不同）：三元 role_code/role_name/role_name_key + is_system + status/sort + 审计列。
-- 保留分化：scope（tenant/workspace 两级，客户专属）。id 是 membership/invitation 关联唯一目标
-- （2026-07-04 起取代 code 关联）；role_code 仅展示/seed 语义标识，非关联键（铁律二）。
-- 角色间不设继承/组合（扁平模型，对齐 AWS IAM / Keycloak 基础模型）。
-- is_system=true 预置不可删；false 管理员自建可删（配 created_by 溯源）。故无 deleted_at。
CREATE TABLE access.roles (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_code      varchar(64)  NOT NULL,                     -- 语义码，非关联键
    scope          varchar(16)  NOT NULL,                     -- tenant / workspace 判别列（realm 专属分化）
    role_name      varchar(128),                              -- 默认/回退显示名
    role_name_key  varchar(128),                              -- i18n 键（前端按 locale 解析）
    description    varchar(255),
    description_key varchar(128),                             -- i18n 键（可空）
    is_system      boolean      NOT NULL DEFAULT false,       -- 预置不可删 / false=管理员自建可删
    is_customer_visible  boolean      NOT NULL DEFAULT true,   -- 展示可见性（客户端/customer realm）——独立轴，不派生自 status/is_active/is_public/is_enabled
    is_workforce_visible boolean      NOT NULL DEFAULT true,   -- 展示可见性（运营端/workforce realm）
    status         varchar(32)  NOT NULL DEFAULT 'active',    -- active/disabled
    sort           int          NOT NULL DEFAULT 999,         -- 控制台排序
    created_by     uuid,                                      -- 谁建的（SYS vs 管理员 id）
    updated_by     uuid,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_roles_scope_role_code UNIQUE (scope, role_code), -- 业务唯一性，非关联用途
    CONSTRAINT uq_roles_id_scope        UNIQUE (id, scope),        -- 复合 FK 目标：锁"tenant 成员不能挂 workspace 角色"
    CONSTRAINT chk_roles_scope          CHECK (scope IN ('tenant','workspace'))
);
CREATE INDEX idx_roles_scope ON access.roles (scope);
CREATE INDEX idx_roles_sort  ON access.roles (sort);

-- 治理权限目录。与 admin.operator_permission 完全同构（控制台菜单树模式）：三元 perm_code/
-- perm_name/perm_name_key + perm_type/route_path/component/icon（菜单渲染）+ is_active/is_customer_visible/is_workforce_visible
-- + is_system + sort + 审计列。perm_code 全局唯一；parent_id 树形自引用。category 分组标签
-- （billing/member/security/settings，开放标签不加 CHECK）。
CREATE TABLE access.permissions (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id      uuid         REFERENCES access.permissions(id),  -- 树形自引用（域内）
    perm_code      varchar(64)  NOT NULL,
    perm_name      varchar(128),                                    -- 显示名（2026-07-30 64→128，与 admin.operator_permission 一致）
    perm_name_key  varchar(128),                                    -- i18n 键
    description_key varchar(128),                                   -- i18n 键（access.perm.{perm_code}.desc）
    perm_type      varchar(20),                                     -- menu/button/api（控制台模式，开放集）
    route_path     varchar(255),                                    -- 前端路由（菜单渲染）
    component      varchar(255),
    icon           varchar(64),
    category       varchar(32),                                     -- 分组标签：billing/member/security/settings
    description    varchar(255),
    is_active      boolean      NOT NULL DEFAULT true,
    is_customer_visible  boolean      NOT NULL DEFAULT true,   -- 展示可见性（客户端/customer realm）——独立轴，不派生自 status/is_active/is_public/is_enabled
    is_workforce_visible boolean      NOT NULL DEFAULT true,   -- 展示可见性（运营端/workforce realm）
    is_system      boolean      NOT NULL DEFAULT true,              -- 权限目录默认系统预置
    sort           int          NOT NULL DEFAULT 999,
    created_by     uuid,
    updated_by     uuid,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_permissions_code UNIQUE (perm_code)
);
CREATE INDEX idx_permissions_parent_id ON access.permissions (parent_id);
CREATE INDEX idx_permissions_sort      ON access.permissions (sort);

-- 角色↔权限映射（复合 PK）。与 admin.operator_role_permission 一致：is_system + created_by 溯源。
-- 两端 ON DELETE CASCADE：删角色/权限自动清映射。
CREATE TABLE access.role_permissions (
    role_id       uuid         NOT NULL REFERENCES access.roles(id)       ON DELETE CASCADE,
    permission_id uuid         NOT NULL REFERENCES access.permissions(id) ON DELETE CASCADE,
    is_system     boolean      NOT NULL DEFAULT true,                     -- 预置映射 vs 管理员分配
    created_by    uuid,                                                   -- 谁建的
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_role_permissions PRIMARY KEY (role_id, permission_id)
);
-- PK 前导列已索引 role_id；补 permission_id 反向查询索引（照 B0 外键列建 index）。
CREATE INDEX idx_role_permissions_permission_id ON access.role_permissions (permission_id);
