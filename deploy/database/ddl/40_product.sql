-- ═══════════════════════════════════════════════════════════════════════════
-- 30_product.sql — schema product（统一产品目录 + 版本化 plan + 每周期定价）
-- 设计权威：docs/design/data_product_200_schema.md（取代 data_platform_200_schema.md §7）
-- 域内 FK 内联（含互引用 plans↔plan_versions，circular 段建表后 ALTER 补）。
-- 跨 schema：无出向真 FK；created_by/updated_by/checked_by 对 admin.operator_accounts
--   一律裸 UUID 不建 FK（边界#2 / 铁律七）。触发器见 triggers_ddl（is_locked 目标态模型）。
-- 表序 = 域内依赖序：product_categories → products → product_metrics → plans →
--   plan_versions →（ALTER plans.current_version_id）→ plan_prices → plan_components
--   → solutions → solution_products → solution_plans（2026-08-31，admin 解决方案）
--   → product_webhooks → launch_checklist_items → product_launch_statuses。
-- ═══════════════════════════════════════════════════════════════════════════

-- 树形品类字典（策展小字典，刻意 smallint 代理键 PK，人读可排序，§3）。
-- id 非可视码（可视码是 code），铁律二不冲突；自引用 parent_id（NULL=顶级，任意深度）。
CREATE TABLE product.product_categories (
    id          smallint     PRIMARY KEY,                             -- 刻意例外 uuid 规范（策展字典）
    parent_id   smallint     REFERENCES product.product_categories(id),
    code        varchar(32)  NOT NULL,                                -- 可视码
    name        varchar(64)  NOT NULL,
    name_key    varchar(128),                                       -- i18n 键（product.category.{code}）
    sort        int          NOT NULL DEFAULT 0,
    is_customer_visible  boolean      NOT NULL DEFAULT true,   -- 展示可见性（客户端/customer realm）——独立轴，不派生自 status/is_active/is_public/is_enabled
    is_workforce_visible boolean      NOT NULL DEFAULT true,   -- 展示可见性（运营端/workforce realm）
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_product_categories_code UNIQUE (code)
);
CREATE INDEX idx_product_categories_parent_id ON product.product_categories (parent_id);

-- 统一产品目录（合并旧 agent + application）。双名称=product_name(主)+product_nick(副)两列，无 i18n 表。
-- category_id 域内 FK→product_categories（应指向叶子小类，应用层引导）。
-- created_by/updated_by 运营专属，裸值→admin.operator_accounts（不建 FK，边界#2）。
CREATE TABLE product.products (
    id                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    product_code             varchar(64)  NOT NULL,                   -- 可视码
    product_type             varchar(32)  NOT NULL,                   -- 扩展型 kind，不加 CHECK
    category_id              smallint     REFERENCES product.product_categories(id),
    product_name             varchar(128) NOT NULL,                   -- 主名/品牌名
    product_nick             varchar(128),                            -- 译名/副名
    description              text,
    description_key          varchar(128),                          -- i18n 键（product.product.{product_code}.desc）
    capability_keys          text[]       NOT NULL DEFAULT '{}',      -- 可门控功能键（GIN）
    tags                     text[]       NOT NULL DEFAULT '{}',      -- 自由标签（GIN）
    standalone_subscribable  boolean      NOT NULL DEFAULT true,
    icon_url                 varchar(512),
    sort                     int          NOT NULL DEFAULT 0,
    config                   jsonb,                                   -- 合并 agent.config_json + application.metadata
    marketing                jsonb,                                   -- 营销内容(双语富结构 {zh|en:{tagline,value,highlights[],tags[],industries[],detail}});admin 产品目录录入,官网据此渲染
    release_version          varchar(64),                            -- 对外发布号
    build_number             varchar(64),                            -- 内部构建号
    released_at              timestamptz,
    status                   varchar(32)  NOT NULL DEFAULT 'active',
    release_stage            varchar(16)  NOT NULL DEFAULT 'developing', -- 成熟度轴:ga=正式版/beta=公测版/developing=开发中。与 status(生命周期)、visibility(可见)正交;新产品默认开发中

    is_customer_visible  boolean      NOT NULL DEFAULT true,   -- 展示可见性（客户端/customer realm）——独立轴，不派生自 status/is_active/is_public/is_enabled
    is_workforce_visible boolean      NOT NULL DEFAULT true,   -- 展示可见性（运营端/workforce realm）
    origin                   varchar(16)  NOT NULL DEFAULT 'self',    -- 来源轴：self=自建/third_party=三方接入/other；产品发布管理 2026-08-12 引入
    origin_provider          varchar(128),                            -- 来源方名称（origin='self' 时留空；third_party 时必填，公司/团队名，不是 product_code）
    created_by               uuid,                                    -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    updated_by               uuid,                                    -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    created_at               timestamptz  NOT NULL DEFAULT now(),
    updated_at               timestamptz  NOT NULL DEFAULT now(),
    deleted_at               timestamptz,
    CONSTRAINT uq_products_product_code UNIQUE (product_code),
    CONSTRAINT chk_products_status CHECK (status IN ('active','inactive','draft','deprecated')),
    CONSTRAINT chk_products_release_stage CHECK (release_stage IN ('ga','beta','developing')),
    CONSTRAINT chk_products_origin CHECK (origin IN ('self','third_party','other')),
    CONSTRAINT chk_products_origin_provider CHECK (origin <> 'third_party' OR origin_provider IS NOT NULL)
);
CREATE INDEX idx_products_category_id ON product.products (category_id);
CREATE INDEX idx_products_status      ON product.products (status);
CREATE INDEX idx_products_release_stage ON product.products (release_stage);
CREATE INDEX idx_products_origin      ON product.products (origin);
CREATE INDEX idx_products_deleted_at  ON product.products (deleted_at);
CREATE INDEX idx_products_tags_gin    ON product.products USING gin (tags);
CREATE INDEX idx_products_cap_gin     ON product.products USING gin (capability_keys);

-- 计量维度（供 commerce.metering consume 分支）。merge_strategy=max/union 能力型（不消费）/
-- pool 消耗型（配额池瀑布扣）；pool 时 consume_mode 非空。product_id 域内 FK→products（CASCADE）。
CREATE TABLE product.product_metrics (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id     uuid         NOT NULL REFERENCES product.products(id) ON DELETE CASCADE,
    metric_key     varchar(64)  NOT NULL,                             -- doc.words/ai.calls/storage.max/member.max
    merge_strategy varchar(16)  NOT NULL,                              -- max/union/pool + tiered(非数值能力:取最高档组件的值,2026-07-07)
    consume_mode   varchar(16),                                       -- 仅 pool 时非空 divisible/atomic
    metric_unit    varchar(32),                                       -- words/calls/GB/seats
    reset_period   varchar(16)  NOT NULL DEFAULT 'none',              -- none/day/month（pool 型池的重置周期，物化时投影 quota_pools.reset_period；2026-07-07）
    created_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_product_metrics_product_metric UNIQUE (product_id, metric_key),
    CONSTRAINT chk_product_metrics_merge_strategy CHECK (merge_strategy IN ('max','union','pool','tiered')),
    CONSTRAINT chk_product_metrics_consume_mode CHECK (consume_mode IS NULL OR consume_mode IN ('divisible','atomic')),
    -- pool 消耗型必须给出 consume_mode（能力型放行 NULL）
    CONSTRAINT chk_product_metrics_pool_consume CHECK (merge_strategy <> 'pool' OR consume_mode IN ('divisible','atomic')),
    CONSTRAINT chk_product_metrics_reset_period CHECK (reset_period IN ('none','day','month')),
    -- 重置周期仅对 pool 型有意义（能力型恒 none）
    CONSTRAINT chk_product_metrics_reset_scope  CHECK (merge_strategy = 'pool' OR reset_period = 'none')
);
CREATE INDEX idx_product_metrics_product_id ON product.product_metrics (product_id);

-- L0 平台资源目录（D7，product_220 §4）：跨产品共享计量维度的单一定义点。产品套餐组件只
-- 贡献额度（quota jsonb 写数），不得在 product_metrics 重复定义共享键（95 触发器强制）。
-- kind=counter(流量,consume 瀑布)/gauge(存量,水位,准入制不走 consume——D5)。status=reserved 行
-- 仅占位键名（compute/egress 类），kind 可空、不开池。
CREATE TABLE product.platform_metrics (
    metric_key    varchar(64)  PRIMARY KEY,
    kind          varchar(16),                                        -- counter | gauge（reserved 行可空）
    consume_mode  varchar(16),                                        -- divisible/atomic（仅 counter）
    metric_unit   varchar(32),
    reset_period  varchar(16)  NOT NULL DEFAULT 'none',
    status        varchar(16)  NOT NULL DEFAULT 'active',             -- active | reserved
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_platform_metrics_kind    CHECK (kind IS NULL OR kind IN ('counter','gauge')),
    CONSTRAINT chk_platform_metrics_status  CHECK (status IN ('active','reserved')),
    CONSTRAINT chk_platform_metrics_reset   CHECK (reset_period IN ('none','day','month')),
    CONSTRAINT chk_platform_metrics_consume CHECK (consume_mode IS NULL OR consume_mode IN ('divisible','atomic')),
    -- active rows must be fully defined; counters need a consume mode; gauges never consume nor reset
    CONSTRAINT chk_platform_metrics_active_defined CHECK (status = 'reserved' OR kind IS NOT NULL),
    CONSTRAINT chk_platform_metrics_counter_mode   CHECK (status = 'reserved' OR kind <> 'counter' OR consume_mode IS NOT NULL),
    CONSTRAINT chk_platform_metrics_gauge_shape    CHECK (kind IS NULL OR kind <> 'gauge' OR (consume_mode IS NULL AND reset_period = 'none'))
);

-- 加油包/扩展包目录（product_220 §0/§4.2:加油包 = SKU 但不经套餐机器——购买直接生成
-- pool grant;owner 2026-08-20 用量配额线激活 addon_purchase 登记项）。表驱动便于运营侧
-- 后续接管定价与上下架(登记);购买时字段快照进 metering.addon_purchases(盖章拷贝,
-- 同 plan 锁定原则:改目录不影响已售)。metric_key 松引用 platform_metrics(仅 WS 级
-- 资源可做加油包)。created_by/updated_by 运营专属,裸值→admin.operator_accounts(边界#2)。
CREATE TABLE product.addon_packs (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_code     varchar(64)  NOT NULL,                              -- 可视码(如 addon-storage-1g,铁律二不作 FK 目标)
    pack_name     varchar(128) NOT NULL,                              -- 展示名(中文基准,i18n 键后置)
    metric_key    varchar(64)  NOT NULL,                              -- 松引用 product.platform_metrics(storage.bytes / ai.credit)
    amount        bigint       NOT NULL,                              -- 授予量(bytes / credits)
    validity_days int          NOT NULL,                              -- 自开通起效期(天)
    price         numeric(12,2) NOT NULL,
    currency      varchar(16)  NOT NULL DEFAULT 'CNY',
    status        varchar(16)  NOT NULL DEFAULT 'active',             -- active | retired(下架不删,已售快照自持)
    sort          int          NOT NULL DEFAULT 100,
    created_by    uuid,
    updated_by    uuid,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_addon_packs_pack_code   UNIQUE (pack_code),
    CONSTRAINT chk_addon_packs_status     CHECK (status IN ('active','retired')),
    CONSTRAINT chk_addon_packs_amount     CHECK (amount > 0),
    CONSTRAINT chk_addon_packs_validity   CHECK (validity_days >= 1),
    CONSTRAINT chk_addon_packs_price      CHECK (price >= 0)
);

-- 产品壳/对外销售方案。current_version_id 域内 FK→plan_versions（互引用，建表后 ALTER 补）。
-- created_by/updated_by 运营专属，裸值→admin.operator_accounts（不建 FK，边界#2）。
CREATE TABLE product.plans (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code          varchar(64)  NOT NULL,                         -- 可视码
    plan_name          varchar(128) NOT NULL,
    plan_name_key      varchar(128),                                -- i18n 键（product.plan.{plan_code}）
    description        text,
    description_key    varchar(128),                                -- i18n 键（product.plan.{plan_code}.desc）
    current_version_id uuid,                                          -- 域内 FK→plan_versions.id（下方 ALTER 补）
    is_public          boolean      NOT NULL DEFAULT true,
    is_customer_visible  boolean      NOT NULL DEFAULT true,   -- 展示可见性（客户端/customer realm）——独立轴，不派生自 status/is_active/is_public/is_enabled
    is_workforce_visible boolean      NOT NULL DEFAULT true,   -- 展示可见性（运营端/workforce realm）
    status             varchar(32)  NOT NULL DEFAULT 'active',
    created_by         uuid,                                          -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    updated_by         uuid,                                          -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    CONSTRAINT uq_plans_plan_code UNIQUE (plan_code),
    CONSTRAINT chk_plans_status CHECK (status IN ('active','inactive','draft','deprecated'))
);
CREATE INDEX idx_plans_status     ON product.plans (status);
CREATE INDEX idx_plans_deleted_at ON product.plans (deleted_at);

-- 不可变版本（组合的版本快照）。is_locked=true（被订阅引用）→ 版本+其 components+prices 全冻结（§7 触发器）。
-- trial_cycle_unit/count=试用配置（NULL=不提供）。plan_id 域内 FK→plans（CASCADE）。created_by 裸值（不建 FK，边界#2）。
CREATE TABLE product.plan_versions (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id           uuid         NOT NULL REFERENCES product.plans(id) ON DELETE CASCADE,
    version_no        int          NOT NULL,                          -- 同 plan 下从 1 递增
    status            varchar(32)  NOT NULL DEFAULT 'draft',          -- 发布生命周期（值域=@shared PLAN_VERSION_STATUSES）：draft 可编辑/待发布；published 已发布（发布时随 is_locked=true 冻结、plans.current_version_id 指向）
    is_locked         boolean      NOT NULL DEFAULT false,            -- 锁定 → 版本 + components + prices + trial 全冻结
    trial_cycle_unit  varchar(16),                                    -- 试用时长单位（NULL=不提供试用）
    trial_cycle_count int,                                            -- 试用时长倍数（如 day×14）
    created_by        uuid,                                           -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    created_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_plan_versions_plan_version UNIQUE (plan_id, version_no),
    CONSTRAINT chk_plan_versions_status CHECK (status IN ('draft','published')),
    CONSTRAINT chk_plan_versions_trial_cycle_unit CHECK (trial_cycle_unit IS NULL OR trial_cycle_unit IN ('day','week','month'))
);
CREATE INDEX idx_plan_versions_plan_id ON product.plan_versions (plan_id);

-- 互引用回填：plans.current_version_id → plan_versions.id（域内 FK，因 circular 依赖在此 ALTER）。
ALTER TABLE product.plans
    ADD CONSTRAINT fk_plans_current_version
    FOREIGN KEY (current_version_id) REFERENCES product.plan_versions(id);

-- 每周期定价（闭合订阅周期模型）：一个 plan_version 挂 N 个周期价（月/季/年/永久…各自价）。
-- commerce.subscriptions.cycle_unit/cycle_count 从中选一。随版本 is_locked 冻结（§7 触发器覆盖本表）。
-- plan_version_id 域内 FK→plan_versions（CASCADE）。价格 numeric(12,2)——资金类有且只有两位小数
-- （owner 2026-09-03：不能显示时四舍五入、存储却一长串小数；原 numeric(18,6) 经
-- migrations/2026-09-03-money-two-decimals.sql 收口）；free 档=0。
CREATE TABLE product.plan_prices (
    id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_version_id uuid           NOT NULL REFERENCES product.plan_versions(id) ON DELETE CASCADE,
    cycle_unit      varchar(16)    NOT NULL,                          -- 对齐 subscriptions.cycle_unit
    cycle_count     int            NOT NULL DEFAULT 1,                -- 季=month×3、年=year×1…
    price           numeric(12,2)  NOT NULL,                          -- 标价，到分；free=0
    currency        varchar(16)    NOT NULL DEFAULT 'CNY',
    created_at      timestamptz    NOT NULL DEFAULT now(),
    CONSTRAINT uq_plan_prices_version_cycle_currency UNIQUE (plan_version_id, cycle_unit, cycle_count, currency),
    CONSTRAINT chk_plan_prices_cycle_unit  CHECK (cycle_unit IN ('day','week','month','year','perpetual')),
    CONSTRAINT chk_plan_prices_cycle_count CHECK (cycle_count >= 1),
    CONSTRAINT chk_plan_prices_price       CHECK (price >= 0)
);
CREATE INDEX idx_plan_prices_plan_version_id ON product.plan_prices (plan_version_id);

-- plan 组合唯一 SoT（挂 plan_version；无 JSONB 双写）。priority 编排期序→投影 commerce.quota_pools.priority。
-- quota=业务语言配额（计数非金额）。plan_version_id/product_id 域内 FK。随版本冻结（§7 触发器）。
CREATE TABLE product.plan_components (
    id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_version_id     uuid         NOT NULL REFERENCES product.plan_versions(id) ON DELETE CASCADE,
    product_id          uuid         NOT NULL REFERENCES product.products(id),
    tier                varchar(32),                                  -- commercial ladder, PRIMARY components only (D6): bundled components carry NULL — their "grade" is the explicit quota
    component_role      varchar(16)  NOT NULL DEFAULT 'primary',      -- primary=the product the plan sells / bundled=bundled-sale backing component (value priced into the host product; NOT free) — replaces billing_kind (product_220 §2)
    source_profile_code varchar(64),                                  -- provenance of the stamped config profile (product_220 §6); loose, display-only
    priority            int          NOT NULL DEFAULT 100,            -- 编排期序，投影 quota_pools.priority
    features            text[]       NOT NULL DEFAULT '{}',           -- 该档开放功能键
    quota               jsonb,                                        -- {"doc.words":1000000}（计数非金额）；键归属目录决定池作用域（platform_metrics 键=共享贡献）
    sort_order          int          NOT NULL DEFAULT 0,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_plan_components_version_product_tier UNIQUE NULLS NOT DISTINCT (plan_version_id, product_id, tier),
    -- 值域权威 = @vxture-platform/shared catalog-domains (TIERS / COMPONENT_ROLES);
    -- lint:catalog-domains 强制 DDL 与 @shared 一致,勿在此单独增删值(改 @shared,DDL 跟随)。
    CONSTRAINT chk_plan_components_tier CHECK (tier IS NULL OR tier IN ('free','starter','pro','business','enterprise')),
    CONSTRAINT chk_plan_components_role CHECK (component_role IN ('primary','bundled')),
    -- role/tier pairing (product_220 §2): primary sells a graded tier; bundled has no commercial grade
    CONSTRAINT chk_plan_components_role_tier CHECK ((component_role = 'primary' AND tier IS NOT NULL) OR (component_role = 'bundled' AND tier IS NULL))
);
CREATE INDEX idx_plan_components_plan_version_id ON product.plan_components (plan_version_id);
CREATE INDEX idx_plan_components_product_id      ON product.plan_components (product_id);

-- ── 解决方案（行业方案聚合，admin「产品与套餐 · 业务产品方案」；2026-08-31 TD-029 收口）──
-- 设计权威：docs/20-specs/000-platform/admin/70-product-solutions.md。owner 2026-08-30 裁定：
-- 上线前 admin 产品板块不得再返回内存 mock，故建表——方案是运营写出来的内容，无 seed，
-- 空库空表即正确态。三表分工：solutions=方案本体；solution_products=方案包含哪些产品能力
-- （M:N，role=该产品在方案里扮演的角色，纯展示）；solution_plans=方案在五档商业阶梯上各绑
-- 一个既有 product.plans（服务套餐 = 既有 plan 绑到方案档位，价格/版本/组件都是 plan 自己
-- 的，不另立第二套定价模型）。
-- status 值域与 products/plans 同一套（draft/active/inactive/deprecated），状态机与
-- product.products 同形（draft→active⇄inactive，任一→deprecated 终态），守卫在 admin-bff。
-- is_public=对外售卖开放（admin 视作 visibility public/internal）；is_customer_visible /
-- is_workforce_visible 展示可见性双列，与本 schema 其余表同轴（§3.2.6）。
-- created_by/updated_by 运营专属，裸值→admin.operator_accounts（不建 FK，边界#2）。
CREATE TABLE product.solutions (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    solution_code        varchar(64)  NOT NULL,                       -- 可视码（kebab，如 flood-regulation；铁律二不作 FK 目标）
    solution_name        varchar(128) NOT NULL,
    description          text,
    industry             varchar(128),                                -- 行业领域（水利 / 法务…；自由文本，不建字典）
    scenario             varchar(128),                                -- 业务场景
    customer_segment     varchar(255),                                -- 目标客户群
    owner_team           varchar(128),                                -- 负责团队（展示）
    tags                 text[]       NOT NULL DEFAULT '{}',          -- 自由标签（GIN）
    delivery_mode        text,                                        -- 交付模式一句话（平台订阅 + 行业实施…）
    delivery_boundaries  text[]       NOT NULL DEFAULT '{}',          -- 交付边界条目（含/不含什么），一条一项
    status               varchar(32)  NOT NULL DEFAULT 'draft',       -- 新建即草稿；上线由运营显式点「启用」
    is_public            boolean      NOT NULL DEFAULT true,          -- 对外售卖开放（≠展示可见性）
    is_customer_visible  boolean      NOT NULL DEFAULT true,   -- 展示可见性（客户端/customer realm）——独立轴，不派生自 status/is_public
    is_workforce_visible boolean      NOT NULL DEFAULT true,   -- 展示可见性（运营端/workforce realm）
    sort                 int          NOT NULL DEFAULT 0,
    created_by           uuid,                                        -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    updated_by           uuid,                                        -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    deleted_at           timestamptz,
    CONSTRAINT uq_solutions_solution_code UNIQUE (solution_code),
    CONSTRAINT chk_solutions_status CHECK (status IN ('active','inactive','draft','deprecated'))
);
CREATE INDEX idx_solutions_status     ON product.solutions (status);
CREATE INDEX idx_solutions_deleted_at ON product.solutions (deleted_at);
CREATE INDEX idx_solutions_tags_gin   ON product.solutions USING gin (tags);

-- 方案 × 产品能力（M:N）。solution 删则随删（CASCADE）；product 走 deleted_at 软删，读侧过滤，
-- 故 product_id 不设 CASCADE。role 是"这个产品在方案里干什么"的展示文案，不进值域。
-- 复合 PK 即唯一约束（一方案一产品一行）。
CREATE TABLE product.solution_products (
    solution_id uuid         NOT NULL REFERENCES product.solutions(id) ON DELETE CASCADE,
    product_id  uuid         NOT NULL REFERENCES product.products(id),
    role        varchar(128),                                         -- 该产品在方案中的角色（巡检采集 / 视频解译…）
    sort        int          NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_solution_products PRIMARY KEY (solution_id, product_id)
);
CREATE INDEX idx_solution_products_product_id ON product.solution_products (product_id);

-- 方案 × 档位 → 套餐绑定（服务套餐）。一方案一档位至多一个 plan（PK），一个 plan 至多
-- 绑一个方案档位（UNIQUE plan_id）——套餐的订阅/收入按 plan 归到唯一方案，计数不重叠。
-- tier 值域 = 五档商业阶梯（product_220 §1；与 chk_plan_components_tier 同源，
-- lint:catalog-domains 强制与 @shared TIERS 一致）。此前 admin mock 用的
-- free/pro/enterprise/custom 是演示口径，2026-08-30 随去 mock 一并废止。
CREATE TABLE product.solution_plans (
    solution_id uuid         NOT NULL REFERENCES product.solutions(id) ON DELETE CASCADE,
    tier        varchar(32)  NOT NULL,
    plan_id     uuid         NOT NULL REFERENCES product.plans(id),
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_solution_plans PRIMARY KEY (solution_id, tier),
    CONSTRAINT uq_solution_plans_plan_id UNIQUE (plan_id),
    CONSTRAINT chk_solution_plans_tier CHECK (tier IN ('free','starter','pro','business','enterprise'))
);

-- 平台自签 HMAC 端点（平台→产品推送订阅变更/额度预警）。每产品一行（product_id 即 PK/FK）。
-- webhook_secret_ref=平台自签验签密钥引用（非 Provider Key，正常入平台库）。
-- 被 commerce.provisioning.webhook_deliveries 投递时 join 取端点+密钥签名。
CREATE TABLE product.product_webhooks (
    product_id         uuid         PRIMARY KEY REFERENCES product.products(id) ON DELETE CASCADE,
    home_url           varchar(512),                                  -- 产品主页（展示）
    webhook_url        varchar(512),                                  -- 平台→产品推送目标
    webhook_secret_ref varchar(128),                                  -- 平台自签 HMAC 验签密钥引用
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now()
);

-- 上架检查项目录（可配置，item_code 自然键 PK）。新增检查项 = INSERT 一行，不改表结构。
CREATE TABLE product.launch_checklist_items (
    item_code   varchar(64)  PRIMARY KEY,                             -- verification_policy/pricing_set…
    item_name   varchar(128) NOT NULL,
    item_name_key varchar(128),                                     -- i18n 键（product.checklist.{item_code}）
    description  varchar(256),
    description_key varchar(128),                                   -- i18n 键（product.checklist.{item_code}.desc）
    is_required boolean      NOT NULL DEFAULT true,
    sort        int          NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now()
);

-- 每 product × 每检查项完成态（复合 PK）。可上架由本表推导（所有 required 项 satisfied），主表不加汇总字段。
-- product_id 域内 FK→products（CASCADE）；item_code 域内 FK→launch_checklist_items（code 作 PK，此处即主键非可视码语义）。
-- checked_by 运营专属裸值（不建 FK，边界#2）。created_at/updated_at 按四件套补（可变状态行，铁律四；无软删）。
CREATE TABLE product.product_launch_statuses (
    product_id   uuid         NOT NULL REFERENCES product.products(id) ON DELETE CASCADE,
    item_code    varchar(64)  NOT NULL REFERENCES product.launch_checklist_items(item_code),
    is_satisfied boolean      NOT NULL DEFAULT false,
    checked_at   timestamptz,
    checked_by   uuid,                                                -- 裸值→admin.operator_accounts（不建 FK，边界#2）；自动校验为 NULL
    remark       varchar(256),
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_product_launch_statuses PRIMARY KEY (product_id, item_code)
);
CREATE INDEX idx_product_launch_statuses_item_code ON product.product_launch_statuses (item_code);

-- ── FK 支撑索引(2026-08-19 全库体检 P2 补齐;audit 类 created_by/updated_by 引用有意不建,父行不删)──
CREATE INDEX idx_plans_current_version ON product.plans (current_version_id);
