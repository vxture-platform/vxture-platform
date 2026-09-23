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
    layer                    varchar(8),                              -- 定位轴 L1/L2/L3（product_100_matrix §2）：L1=基础支撑 / L2=域平台 / L3=智能体。与 product_type（类型）、origin（来源）正交；NULL=未分类。封闭值域，值域权威 @vxture-platform/shared PRODUCT_LAYERS（lint:catalog-domains 锁 DDL 一致）
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
    status                   varchar(32)  NOT NULL DEFAULT 'active',  -- 接入状态:draft=草稿(只在 opera 可见)/developing=开发中(admin 可录营销、官网可预告)/active=已上线/inactive=已停用/deprecated=已退役(终态)
    release_stage            varchar(16)  NOT NULL DEFAULT 'preview',   -- 承诺等级轴:preview=预览版/beta=公测版/stable=正式版/sunset=停售中。答的是「买了之后平台承诺什么」,不是「代码到第几个里程碑」;与 status(接入状态)、可见域正交;新产品默认预览版

    is_customer_visible  boolean      NOT NULL DEFAULT true,   -- 展示可见性（客户端/customer realm）——独立轴，不派生自 status/is_active/is_public/is_enabled
    is_workforce_visible boolean      NOT NULL DEFAULT true,   -- 展示可见性（运营端/workforce realm）
    origin                   varchar(16)  NOT NULL DEFAULT 'self',    -- 来源轴：self=自建/third_party=三方接入/other；产品发布管理 2026-08-12 引入
    origin_provider          varchar(128),                            -- 来源方名称（origin='self' 时留空；third_party 时必填，公司/团队名，不是 product_code）
    launch_override_at       timestamptz,                             -- 带理由跳过上线闸门的时刻；NULL = 从未跳过（正常上线）。理由本身在 support.audit_logs
    launch_override_by       uuid,                                    -- 执行跳过的运营者；裸值→admin.operator_accounts（不建 FK，边界#2）
    launch_override_pending  jsonb,                                   -- 跳过当时尚未满足的 gate=launch 必填项 item_code 数组；产品页据此常驻提示，复验后转满足即不再提示
    created_by               uuid,                                    -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    updated_by               uuid,                                    -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    created_at               timestamptz  NOT NULL DEFAULT now(),
    updated_at               timestamptz  NOT NULL DEFAULT now(),
    deleted_at               timestamptz,
    CONSTRAINT uq_products_product_code UNIQUE (product_code),
    CONSTRAINT chk_products_status CHECK (status IN ('draft','developing','active','inactive','deprecated')),
    CONSTRAINT chk_products_release_stage CHECK (release_stage IN ('preview','beta','stable','sunset')),
    CONSTRAINT chk_products_layer CHECK (layer IS NULL OR layer IN ('L1','L2','L3')),
    CONSTRAINT chk_products_origin CHECK (origin IN ('self','third_party','other')),
    CONSTRAINT chk_products_origin_provider CHECK (origin <> 'third_party' OR origin_provider IS NOT NULL)
);
CREATE INDEX idx_products_category_id ON product.products (category_id);
CREATE INDEX idx_products_status      ON product.products (status);
CREATE INDEX idx_products_release_stage ON product.products (release_stage);
CREATE INDEX idx_products_origin      ON product.products (origin);
CREATE INDEX idx_products_layer       ON product.products (layer);
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
-- 计量项命名字典（owner 2026-09-22：「更高维度的统一，产品要复用」）。
--
-- 中文名是**键的属性**，不是「(产品, 键)」的属性：`member.max`、`retention.days`
-- 这类通用键每接一个产品就会被再命名一遍，于是同一个键在不同产品下各有各的叫法。
-- 所以命名住在这里一处，`product_metrics` 与 `platform_metrics` 都按 metric_key 读它。
--
-- 2026-10-16 曾把 display_name/description 直接加在那两张表上——落点错了，本表取代
-- 它们（那两列同批迁移里删掉；生产上一条都没填过，无数据损失）。
--
-- 不设 FK：两张表的键值域不相交（trg_product_metrics_no_platform_shadow 保证），
-- 而本表是**可选**的命名补充——没有对应行时界面回落显示 metric_key 本身，不阻塞。
-- 平台不替产品命名（`varda.enabled` 该叫「Varda 开关」还是「智能体启用」只有产品
-- 自己知道），所以这里没有默认值、没有自动生成。
CREATE TABLE product.metric_catalog (
    metric_key   varchar(64)  PRIMARY KEY,                          -- 可视码，与两张计量表同值域
    display_name varchar(128) NOT NULL,                             -- 中文名
    description  varchar(256),
    created_by   uuid,                                              -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_by   uuid,
    updated_at   timestamptz  NOT NULL DEFAULT now()
);

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
    version_no        int          NOT NULL,                          -- 同 plan 下从 1 递增（内部身份：唯一键、排序、详情路由都拄它；98 锚点列，不可改写）
    major_no          int          NOT NULL DEFAULT 1,                -- 主版本号（V1/V2…）：**人设定的商业代际**，不自增。价格/档位结构变了才升；只改配额这类小改沿用当前主版本，于是同一 V1 下可以有多个日期修订。98 锚点列（`_no` 后缀）——开草稿时一次写入，之后不改
    published_at      timestamptz,                                    -- 发布（启用）那一刻；NULL = 还没发布过。运营要看的「什么时间启用」只能取它——created_at 是草稿何时开的，是另一个时刻
    status            varchar(32)  NOT NULL DEFAULT 'draft',          -- 发布生命周期（值域=@shared PLAN_VERSION_STATUSES）：draft 可编辑/待发布；published 已发布（发布时随 is_locked=true 冻结、plans.current_version_id 指向）
    is_locked         boolean      NOT NULL DEFAULT false,            -- 锁定 → 版本 + components + prices + trial 全冻结
    trial_cycle_unit  varchar(16),                                    -- 试用时长单位（NULL=不提供试用）
    trial_cycle_count int,                                            -- 试用时长倍数（如 day×14）
    created_by        uuid,                                           -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    created_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_plan_versions_plan_version UNIQUE (plan_id, version_no),
    CONSTRAINT chk_plan_versions_status CHECK (status IN ('draft','published')),
    CONSTRAINT chk_plan_versions_trial_cycle_unit CHECK (trial_cycle_unit IS NULL OR trial_cycle_unit IN ('day','week','month')),
    CONSTRAINT chk_plan_versions_major_no CHECK (major_no >= 1)
    -- 刻意**不加**「published ⇔ published_at 非空」这条 CHECK：本列上线前就已发布的
    -- 版本没有这个时刻可考（既不在表里也不在审计里，发布动作此前压根不留痕），加了
    -- 会让存量行当场违反、也会顶穿 seed 里那些已发布版本。已发布而 published_at 为
    -- 空，读作「发布于本列上线之前」，界面显示「—」，不拿 created_at 冒充。
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
    industry             varchar(128),                                -- 行业领域：存 core-utils industry-taxonomy 自定义清单的码（与租户所属行业同一清单，2026-09-06）；历史自由文本原样保留
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
    webhook_secret_ref varchar(128),                                  -- 平台自签 HMAC 验签密钥引用（旧路径：ref→env）
    -- 边缘上游：智能体在 tailnet 上的 host:port。边缘那份 *.vxture.com 兜底 vhost
    -- 用 map $host 查它；精确 server_name 的 vhost 按 nginx 匹配优先级照旧压过通配。
    -- 空 = 不走通配兜底（自带精确 vhost，或尚未接入边缘）。
    edge_upstream      varchar(128),
    -- 边缘域名。表单预填 {product_code}.vxture.com 但**可改**——推导不是唯一规则:
    -- anlan.ai / xuanzhen.ai 这两个 L3 智能体是异 apex,推导给出的域名根本不存在。
    -- 空 = 不走通配兜底(自带精确 vhost,如 vxtpl)。
    edge_domain        varchar(255),
    -- provisioning webhook 的 HMAC 密钥**密文**（AES-256-GCM，v1.<iv>.<tag>.<ct>，
    -- 与 admin.operator_mfa.totp_secret 同格式同实现）。与 client_secret 不同：
    -- HMAC 密钥必须能还原原文，存哈希不可用。主密钥 PLATFORM_WEBHOOK_ENC_KEY，
    -- **只有一个、永不随产品增长**——这才是接一个智能体不用改 env 的原因。
    webhook_secret_enc text,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    -- 形状错要在登记那一刻报，不要等渲进 map 之后靠 nginx -t 失败才发现。
    -- 单行写：跨行约束会被 check-column-locks 的列解析器当成列定义。
    CONSTRAINT chk_product_webhooks_edge_upstream CHECK (edge_upstream IS NULL OR edge_upstream ~ '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?:[0-9]{1,5}$'),
    -- 主机名:不带协议、路径、端口(端口在 edge_upstream)。这个值原样进 nginx 的 map。
    CONSTRAINT chk_product_webhooks_edge_domain CHECK (edge_domain IS NULL OR edge_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);

-- 产品可露出的端（web/desktop/app/miniprogram）。owner 2026-09-11:「平台 N 个产品，
-- 但 ruyin 可同步使用的 M 个产品」。**产品自身的形态属性，与租户无关**——按租户的
-- 开关属权益，挂订阅/套餐。键是**端类型**不是客户端凭据:一个端可能有多套凭据
-- （iOS/Android 两个 OIDC 客户端），产品支持的是「移动端」这一件事。
CREATE TABLE product.product_surfaces (
    product_id  uuid         NOT NULL REFERENCES product.products(id) ON DELETE CASCADE,
    surface     varchar(24)  NOT NULL,                             -- 受管枚举，权威源 @vxture/core-utils 的 PRODUCT_SURFACES
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_product_surfaces PRIMARY KEY (product_id, surface),
    CONSTRAINT chk_product_surfaces_value CHECK (surface IN ('web','desktop','app','miniprogram'))
);
CREATE INDEX ix_product_surfaces_surface ON product.product_surfaces (surface);

-- 产品图标（平台托管，2026-09-11）。一产品一张，位图；**不收 SVG**——SVG 可以带
-- <script>，从 console 自己的域名发出去等于存储型 XSS。没有行时界面回落到产品字母牌。
-- 存库不存对象存储：平台没有上传基础设施，而图标很小（≤256KB × 二十几个产品）。
CREATE TABLE product.product_icons (
    product_id  uuid         PRIMARY KEY REFERENCES product.products(id) ON DELETE CASCADE,
    mime_type   varchar(64)  NOT NULL,
    bytes       bytea        NOT NULL,
    byte_size   int          NOT NULL,                                  -- 冗余，列清单时不拖 bytea
    checksum    varchar(64)  NOT NULL,                                  -- HTTP ETag 用
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_product_icons_mime CHECK (mime_type IN ('image/png','image/webp','image/jpeg')),
    CONSTRAINT chk_product_icons_size CHECK (byte_size > 0 AND byte_size <= 262144)
);

-- 上架检查项目录（可配置，item_code 自然键 PK）。新增检查项 = INSERT 一行，不改表结构。
-- owner / gate 是两根**正交**轴（2026-09-17）：前者说这一项归谁，后者说它卡哪道门。
-- 此前两者被揉在 opera-bff 的 ADMIN_OWNED_ITEM_CODES 字面量里，而「卡哪道门」根本
-- 没有表达处——`acceptance` 因此卡在上线门上，形成循环自锁（它要的端到端链路需要
-- 产品先能被订阅，而订阅需要产品已上线）。
CREATE TABLE product.launch_checklist_items (
    item_code   varchar(64)  PRIMARY KEY,                             -- verification_policy/pricing_set…
    item_name   varchar(128) NOT NULL,
    item_name_key varchar(128),                                     -- i18n 键（product.checklist.{item_code}）
    description  varchar(256),
    description_key varchar(128),                                   -- i18n 键（product.checklist.{item_code}.desc）
    is_required boolean      NOT NULL DEFAULT true,
    owner       varchar(16)  NOT NULL DEFAULT 'opera',               -- 归属轴：opera=技术接入 / admin=商业前置
    gate        varchar(16)  NOT NULL DEFAULT 'launch',              -- 门轴：launch=产品上线（draft→active，opera 卡）/ publish=发布套餐（admin 的 publishPlanVersion 卡）。publish 原指 developing→beta，2026-09-22 beta 简化为纯展示标签后那道门悬空，改指「发布套餐」——即 owner 给的生命周期里第 4 步
    sort        int          NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_launch_checklist_items_owner CHECK (owner IN ('opera','admin')),
    CONSTRAINT chk_launch_checklist_items_gate  CHECK (gate  IN ('launch','publish'))
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 接入认证台账（2026-10-30）。**一次认证跑动的结论**，不是产品行上的一个 enum。
--
-- ── 为什么是事件表而不是 products 上的一列 ──
-- 认证是「后果」，产品的 status 是「意图」——合成一个字段之后，一次复验失败就要把
-- 一个正在跑的产品改回草稿。同一条原则在 lifecycle.ts 与模型路由的 state/resolution
-- 上已经用过两次。且「谁在什么时候、对哪个契约版本、在哪个沙箱里认的」要答得出来，
-- 那是台账才有的形状。
--
-- ── 它挂在产品上，不挂在套餐上 ──
-- 判据是「换个宿主它变吗」：换个套餐它不变，换个产品它才变。所以发第二个套餐不必
-- 重认一遍——认证认的是**平台与产品方之间那条链**，不是某一档的定价。
--
-- ── sandbox_workspace_id 是这张表的要害 ──
-- 认证的观测那一半（对方拉权益、报用量）必须**按沙箱工作区收口**。不收口的话，
-- A 客户的真实使用会把 B 产品的认证喂绿——那正是旧 `acceptance` 判据的毛病：
-- 它读的是该产品的**任意**流量。
--
-- ── plan_version_id + component_fingerprint ──
-- 认证订阅指向**待发布的草稿版本本身**（不是另造一个「认证套餐」），这样认证的对象
-- 与发布的对象字节相同，且顺带把配额池物化跑通——套餐组件配错会在认证时炸，而不是
-- 上架后炸。但草稿在发布前仍可改，所以记一份组件指纹：发布门比对指纹，对不上就要求
-- 重认。指纹而不是时间戳，因为「改了又改回来」不该判成失效。
--
-- ── stale 不是 invalid ──
-- 回调地址变更、密钥轮换、redirect URI 变更、上游授权被撤、契约版本 bump——各自把
-- 认证标成 stale（`stale_reason` 非空）。stale **只挡「再发布新版本」，不把在跑的
-- 产品拉下线**。不设按时间自动过期：那会让一个安静了三个月的正常产品突然失效，
-- 而认证回答的是「能不能工作」，不是「有没有人在用」（后者归运行健康）。
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE product.certification_runs (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id           uuid         NOT NULL REFERENCES product.products(id) ON DELETE CASCADE,
    contract_version     varchar(32)  NOT NULL,                       -- 《产品接入通则》契约版本；bump 即令既有认证 stale
    sandbox_workspace_id uuid         NOT NULL,                       -- 跨 schema→tenancy.workspaces（90）。观测按它收口
    plan_version_id      uuid,                                        -- 认证所针对的草稿版本（域内→plan_versions，不建 FK：版本可被删，台账要留证据）
    component_fingerprint varchar(64),                                -- 认证时刻 plan_components 的指纹；发布门比对，对不上要求重认
    segments             jsonb        NOT NULL DEFAULT '{}'::jsonb,   -- 五段各自结果 {login,provision,delivery,entitlement,consume}
    verdict              varchar(16)  NOT NULL DEFAULT 'running',     -- running=进行中 / certified=已认证 / failed=某段没通过或超时
    stale_reason         varchar(64),                                 -- 非空 = 待复认证；值域见 CHECK
    certified_at         timestamptz,                                 -- verdict='certified' 的时刻
    stale_at             timestamptz,
    run_by               uuid,                                        -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    created_at           timestamptz  NOT NULL DEFAULT now(),   -- 这一次跑动的开始时刻（不另设 started_at：同一个事实只留一份）
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_certification_runs_verdict CHECK (verdict IN ('running','certified','failed')),
    -- 值域与 stale 的触发器一一对应；新增一种失效原因要同时改这里与那个触发点。
    -- 只收**契约变更**。前三个由事件写入（webhook 登记 / rotate-secret /
    -- PUT redirect-uris），后两个是读时现算、不落库（契约升版比 contract_version、
    -- 组件变更比指纹）——值留在值域里，是为了「为什么失效」在读侧也能用同一套词说。
    -- 上游授权被撤**不在其列**：那不是契约变更，认证那句有时间的话仍然成立，断的是
    -- 运行时，归运行健康。见 migrations/2026-11-02-stale-reason-domain.sql。
    CONSTRAINT chk_certification_runs_stale_reason CHECK (
        stale_reason IS NULL OR stale_reason IN (
            'webhook_changed','secret_rotated','redirect_uri_changed',
            'contract_version_bumped','components_changed')),
    -- 结论与时刻互为充要：certified 必有时刻，非 certified 必无——否则「认证过没有」
    -- 会有两个互相矛盾的读法，而它是发布门唯一的判据。
    CONSTRAINT chk_certification_runs_certified_at CHECK (
        (verdict = 'certified') = (certified_at IS NOT NULL)),
    CONSTRAINT chk_certification_runs_stale_pair CHECK (
        (stale_reason IS NULL) = (stale_at IS NULL))
);
CREATE INDEX idx_certification_runs_product   ON product.certification_runs (product_id);
CREATE INDEX idx_certification_runs_workspace ON product.certification_runs (sandbox_workspace_id);
-- 发布门的查询：某产品当前那一条有效认证。部分索引把台账里的历史行整块排除。
CREATE INDEX idx_certification_runs_effective ON product.certification_runs (product_id, certified_at DESC)
  WHERE verdict = 'certified' AND stale_reason IS NULL;

-- ── FK 支撑索引(2026-08-19 全库体检 P2 补齐;audit 类 created_by/updated_by 引用有意不建,父行不删)──
CREATE INDEX idx_plans_current_version ON product.plans (current_version_id);
