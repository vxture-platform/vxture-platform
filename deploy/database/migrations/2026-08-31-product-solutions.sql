-- 2026-08-31 解决方案三表（admin「业务产品方案」/「服务套餐」去 mock，TD-029 收口；
-- 设计见 docs/20-specs/000-platform/admin/70-product-solutions.md）。
-- 服务套餐 = 既有 product.plans 绑到方案的一个档位，不另建定价模型；方案是运营写出来的
-- 内容，无 seed，空表即正确态。
-- 幂等：可对已建库重复执行。对应 DDL：40_product.sql / 98_column_locks.sql。跨 schema FK：无
--（三表只引 product 域内的 products / plans，FK 与 DDL 一样内联；没有要放进
-- 90_cross_schema_fk.sql 的东西，所以这里不需要 DO 块补 FK）。

CREATE TABLE IF NOT EXISTS product.solutions (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    solution_code        varchar(64)  NOT NULL,
    solution_name        varchar(128) NOT NULL,
    description          text,
    industry             varchar(128),
    scenario             varchar(128),
    customer_segment     varchar(255),
    owner_team           varchar(128),
    tags                 text[]       NOT NULL DEFAULT '{}',
    delivery_mode        text,
    delivery_boundaries  text[]       NOT NULL DEFAULT '{}',
    status               varchar(32)  NOT NULL DEFAULT 'draft',
    is_public            boolean      NOT NULL DEFAULT true,
    is_customer_visible  boolean      NOT NULL DEFAULT true,
    is_workforce_visible boolean      NOT NULL DEFAULT true,
    sort                 int          NOT NULL DEFAULT 0,
    created_by           uuid,
    updated_by           uuid,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    deleted_at           timestamptz,
    CONSTRAINT uq_solutions_solution_code UNIQUE (solution_code),
    CONSTRAINT chk_solutions_status CHECK (status IN ('active','inactive','draft','deprecated'))
);
CREATE INDEX IF NOT EXISTS idx_solutions_status     ON product.solutions (status);
CREATE INDEX IF NOT EXISTS idx_solutions_deleted_at ON product.solutions (deleted_at);
CREATE INDEX IF NOT EXISTS idx_solutions_tags_gin   ON product.solutions USING gin (tags);

CREATE TABLE IF NOT EXISTS product.solution_products (
    solution_id uuid         NOT NULL REFERENCES product.solutions(id) ON DELETE CASCADE,
    product_id  uuid         NOT NULL REFERENCES product.products(id),
    role        varchar(128),
    sort        int          NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_solution_products PRIMARY KEY (solution_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_solution_products_product_id ON product.solution_products (product_id);

CREATE TABLE IF NOT EXISTS product.solution_plans (
    solution_id uuid         NOT NULL REFERENCES product.solutions(id) ON DELETE CASCADE,
    tier        varchar(32)  NOT NULL,
    plan_id     uuid         NOT NULL REFERENCES product.plans(id),
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_solution_plans PRIMARY KEY (solution_id, tier),
    CONSTRAINT uq_solution_plans_plan_id UNIQUE (plan_id),
    CONSTRAINT chk_solution_plans_tier CHECK (tier IN ('free','starter','pro','business','enterprise'))
);

-- 97_service_roles.sql 的 ALTER DEFAULT PRIVILEGES 会给 owner 新建的表自动授权；这里显式
-- 再授一次，是为了对「表已存在但由别的角色建出来」的库同样成立。
GRANT SELECT, INSERT, UPDATE, DELETE ON product.solutions, product.solution_products, product.solution_plans TO platform_svc;

-- 列锁（与 98_column_locks.sql 逐字一致；锚点 = PK / created_by / created_at）。
-- product.solutions  [anchor: id, created_by, created_at]
REVOKE UPDATE ON product.solutions FROM platform_svc;
GRANT UPDATE (solution_code, solution_name, description, industry, scenario, customer_segment, owner_team, tags, delivery_mode, delivery_boundaries, status, is_public, is_customer_visible, is_workforce_visible, sort, updated_by, updated_at, deleted_at) ON product.solutions TO platform_svc;

-- product.solution_products  [anchor: solution_id, product_id, created_at]
REVOKE UPDATE ON product.solution_products FROM platform_svc;
GRANT UPDATE (role, sort) ON product.solution_products TO platform_svc;

-- product.solution_plans  [anchor: solution_id, tier, created_at]
REVOKE UPDATE ON product.solution_plans FROM platform_svc;
GRANT UPDATE (plan_id) ON product.solution_plans TO platform_svc;
