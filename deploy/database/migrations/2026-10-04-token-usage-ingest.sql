-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 原始 token 用量接收通道（vxture-platform#547 / atlas ADR-010 / 本仓 ADR-013）
--
-- 依据：owner 2026-09-30「Atlas 上报原始 token，分四个维度；换算成 credit 的规则由运营随时
-- 调整，Atlas 不做换算」；owner 2026-10-03 三条裁定：按工作区累计小数、补报历史只补事实不扣
-- credit、故障转移里失败的尝试不扣客户。
--
-- 背景：Atlas 替各产品上报的推理用量**从未入账**（生产 332 条记录零入账）—— 它发
-- `product:"atlas"`，而 atlas 已按 owner 2026-09-23 退出产品目录（L1 不是产品），consume 回
-- 400 unknown_product。现有 consume 一次只收一个 metric + 一个 amount，四维原始 token 进不去。
--
-- 本迁移给存量库建四张表（与 50_metering.sql §6b/§6c/§6d/§8b 同形）：
--   · metering.token_usage_events        原始事实（append-only，月分区，按调用方产品归属）
--   · metering.token_credit_rates        token→credit 费率（运营可改的数据；种子一行默认档）
--   · metering.token_credit_carry        每（工作空间 × 调用方产品）的小数 credit 结转
--   · metering.token_usage_idempotencies 幂等权威 + 扣减回填位（自愈：usage_event_id 空且 whole_due>0 = 待重放）
-- 以及：分区铺到与 96_partitions.sql 同一个 cover_until、append-only 触发器、跨 schema FK、
-- 列锁（与 98 同形）、默认费率一行。**不改任何既有表、不动任何既有数据。**
--
-- 新库不跑迁移（DDL + seed 直建），四张表与默认费率都已在 50_metering.sql / seed-catalog.mjs 里；
-- 本迁移只服务存量库。
--
-- 幂等：整份可重跑（IF NOT EXISTS / to_regclass / duplicate_object / on conflict）。
-- 顺序：**先 migrate 再 deploy**（新镜像的 /usage/consume 收到 tokens 形态就写这几张表；表不在就 500）。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
-- 分区边界按会话 TimeZone 解释，仓里没钉它（RDS 参数组决定）：与 96_partitions.sql /
-- 2026-10-03-extend-partition-window.sql 同一个理由钉成 UTC。SET LOCAL 只管本事务。
SET LOCAL TIME ZONE 'UTC';

-- ── 0. 锚点：缺一个就抛，不要静默建一半 ───────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('metering.usage_events') IS NULL OR to_regclass('metering.usage_idempotencies') IS NULL THEN
    RAISE EXCEPTION '[token-usage] metering 内核表不在 —— 先 apply 50_metering.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM product.platform_metrics WHERE metric_key = 'ai.credit' AND status = 'active') THEN
    RAISE EXCEPTION '[token-usage] platform_metrics 里没有 active 的 ai.credit —— 换算出来的 credit 没地方扣';
  END IF;
END $$;

-- ── 1. 四张表（与 DDL §6b/§6c/§6d/§8b 逐字同形；改一边必须改另一边）──────────────
CREATE TABLE IF NOT EXISTS metering.token_usage_events (
    id                 uuid          NOT NULL DEFAULT gen_random_uuid(),
    workspace_id       uuid          NOT NULL,
    product_id         uuid          NOT NULL,
    request_id         varchar(128)  NOT NULL,
    attempt_index      smallint      NOT NULL DEFAULT 0,
    outcome            varchar(16)   NOT NULL DEFAULT 'served',
    occurred_at        timestamptz   NOT NULL,
    model_code         varchar(128),
    provider_code      varchar(64),
    input_tokens       bigint        NOT NULL DEFAULT 0,
    output_tokens      bigint        NOT NULL DEFAULT 0,
    cache_write_tokens bigint        NOT NULL DEFAULT 0,
    cache_read_tokens  bigint        NOT NULL DEFAULT 0,
    reasoning_tokens   bigint,
    rerank_candidates  int,
    parse_pages        int,
    credits_micro      bigint,
    credit_skip_reason varchar(24),
    rate_id            uuid,
    created_at         timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at),
    CONSTRAINT chk_token_usage_events_outcome CHECK (outcome IN ('served','failed')),
    CONSTRAINT chk_token_usage_events_skip CHECK (credit_skip_reason IS NULL OR credit_skip_reason IN ('pre_cutover','failed_attempt','no_rate')),
    CONSTRAINT chk_token_usage_events_tokens CHECK (input_tokens >= 0 AND output_tokens >= 0 AND cache_write_tokens >= 0 AND cache_read_tokens >= 0),
    CONSTRAINT chk_token_usage_events_credit_xor CHECK ((credits_micro IS NULL) <> (credit_skip_reason IS NULL))
) PARTITION BY RANGE (created_at);
CREATE INDEX IF NOT EXISTS idx_token_usage_events_route    ON metering.token_usage_events (workspace_id, product_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_token_usage_events_request  ON metering.token_usage_events (request_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_events_occurred ON metering.token_usage_events (occurred_at);

CREATE TABLE IF NOT EXISTS metering.token_credit_rates (
    id                         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_code              varchar(64),
    model_code                 varchar(128),
    input_micro_per_1k         bigint        NOT NULL,
    output_micro_per_1k        bigint        NOT NULL,
    cache_write_micro_per_1k   bigint        NOT NULL,
    cache_read_micro_per_1k    bigint        NOT NULL,
    rerank_micro_per_candidate bigint        NOT NULL DEFAULT 0,
    parse_micro_per_page       bigint        NOT NULL DEFAULT 0,
    effective_from             timestamptz   NOT NULL DEFAULT now(),
    effective_to               timestamptz,
    note                       varchar(256),
    created_by                 uuid,
    created_at                 timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_token_credit_rates_window CHECK (effective_to IS NULL OR effective_to > effective_from),
    CONSTRAINT chk_token_credit_rates_nonneg CHECK (input_micro_per_1k >= 0 AND output_micro_per_1k >= 0 AND cache_write_micro_per_1k >= 0 AND cache_read_micro_per_1k >= 0 AND rerank_micro_per_candidate >= 0 AND parse_micro_per_page >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_token_credit_rates_scope_from ON metering.token_credit_rates ((coalesce(provider_code, '')), (coalesce(model_code, '')), effective_from);
CREATE INDEX IF NOT EXISTS idx_token_credit_rates_lookup ON metering.token_credit_rates (provider_code, model_code, effective_from);

CREATE TABLE IF NOT EXISTS metering.token_credit_carry (
    workspace_id uuid          NOT NULL,
    product_id   uuid          NOT NULL,
    carry_micro  bigint        NOT NULL DEFAULT 0,
    updated_at   timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, product_id),
    CONSTRAINT chk_token_credit_carry_range CHECK (carry_micro >= 0 AND carry_micro < 1000000)
);

CREATE TABLE IF NOT EXISTS metering.token_usage_idempotencies (
    workspace_id           uuid          NOT NULL,
    product_id             uuid          NOT NULL,
    request_id             varchar(128)  NOT NULL,
    attempt_index          smallint      NOT NULL DEFAULT 0,
    token_event_id         uuid,
    token_event_created_at timestamptz,
    credits_micro          bigint,
    credit_skip_reason     varchar(24),
    whole_due              bigint        NOT NULL DEFAULT 0,
    usage_event_id         uuid,
    created_at             timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, product_id, request_id, attempt_index)
);
CREATE INDEX IF NOT EXISTS idx_token_usage_idempotencies_request ON metering.token_usage_idempotencies (request_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_idempotencies_pending ON metering.token_usage_idempotencies (created_at) WHERE usage_event_id IS NULL AND whole_due > 0;

-- ── 2. 分区：铺到与 96_partitions.sql 同一个 cover_until ─────────────────────────
--    两处的日期必须一致（check-partition-window 守卫只看 96 与 extend-partition-window；
--    本表的窗口与那三张表同步推，下次推窗口把这里也带上）。
DO $$
DECLARE
  cover_from  date := date '2026-07-01';
  cover_until date := date '2028-02-01';
  child text; mn date; nm date; made int := 0;
BEGIN
  mn := cover_from;
  WHILE mn < cover_until LOOP
    nm := mn + interval '1 month';
    child := 'token_usage_events_y' || to_char(mn, 'YYYY') || 'm' || to_char(mn, 'MM');
    IF to_regclass(format('metering.%I', child)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE metering.%I PARTITION OF metering.token_usage_events FOR VALUES FROM (%L) TO (%L)',
        child, mn, nm);
      made := made + 1;
    END IF;
    mn := nm;
  END LOOP;
  IF to_regclass('metering.token_usage_events_default') IS NULL THEN
    EXECUTE 'CREATE TABLE metering.token_usage_events_default PARTITION OF metering.token_usage_events DEFAULT';
  END IF;
  RAISE NOTICE '[token-usage] token_usage_events 新建 % 个月分区，窗口到 %', made, cover_until;
END $$;

-- ── 3. append-only 触发器（与 95_triggers.sql 同形）────────────────────────────
DROP TRIGGER IF EXISTS trg_token_usage_events_append_only ON metering.token_usage_events;
CREATE TRIGGER trg_token_usage_events_append_only
  BEFORE UPDATE OR DELETE ON metering.token_usage_events
  FOR EACH ROW EXECUTE FUNCTION metering.forbid_mutation();

-- ── 4. 跨 schema FK（与 90_cross_schema_fk.sql 同形）─────────────────────────────
DO $$ BEGIN
  ALTER TABLE metering.token_usage_events ADD CONSTRAINT fk_token_usage_events_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.token_usage_events ADD CONSTRAINT fk_token_usage_events_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.token_credit_carry ADD CONSTRAINT fk_token_credit_carry_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.token_credit_carry ADD CONSTRAINT fk_token_credit_carry_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. 授权与列锁（与 97 / 98 同形；ALTER DEFAULT PRIVILEGES 不一定覆盖迁移建的表，显式给）──
GRANT SELECT, INSERT, UPDATE, DELETE ON metering.token_usage_events, metering.token_credit_rates,
  metering.token_credit_carry, metering.token_usage_idempotencies TO platform_svc;
GRANT SELECT ON metering.token_usage_events, metering.token_credit_rates,
  metering.token_credit_carry, metering.token_usage_idempotencies TO reporting_ro;
REVOKE UPDATE ON metering.token_usage_events FROM platform_svc;
GRANT UPDATE (workspace_id, product_id, request_id, attempt_index, outcome, occurred_at, model_code, provider_code, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, reasoning_tokens, rerank_candidates, parse_pages, credits_micro, credit_skip_reason, rate_id) ON metering.token_usage_events TO platform_svc;
REVOKE UPDATE ON metering.token_credit_rates FROM platform_svc;
GRANT UPDATE (effective_to, note) ON metering.token_credit_rates TO platform_svc;
REVOKE UPDATE ON metering.token_credit_carry FROM platform_svc;
GRANT UPDATE (carry_micro, updated_at) ON metering.token_credit_carry TO platform_svc;
REVOKE UPDATE ON metering.token_usage_idempotencies FROM platform_svc;
GRANT UPDATE (token_event_id, token_event_created_at, credits_micro, credit_skip_reason, whole_due, usage_event_id) ON metering.token_usage_idempotencies TO platform_svc;

-- ── 6. 默认费率一行：2K tokens = 1 credit（product_220 §4.2 的基线）───────────────
--    1 credit = 1,000,000 微 credit ⇒ 每 token 500 微 ⇒ 每 1K token 500,000 微。
--    四维同价、rerank / parse 为 0：缓存折价与按候选/按页计价是商业判断，这里不替 owner 定，
--    运营改一行数据即生效（改价 = 关旧行窗口 + 插新行）。与 seed-catalog.mjs 同一行。
INSERT INTO metering.token_credit_rates
  (provider_code, model_code, input_micro_per_1k, output_micro_per_1k, cache_write_micro_per_1k, cache_read_micro_per_1k,
   rerank_micro_per_candidate, parse_micro_per_page, effective_from, note)
VALUES
  (NULL, NULL, 500000, 500000, 500000, 500000, 0, 0, timestamptz '2026-01-01 00:00:00+00',
   '默认档：2K tokens = 1 credit（product_220 §4.2 基线）；缓存读写同价、rerank/parse 暂为 0，运营按需另插行')
ON CONFLICT ((coalesce(provider_code, '')), (coalesce(model_code, '')), effective_from) DO NOTHING;

-- ── 7. 审计段：读回来，PR 里贴这几行 ──────────────────────────────────────────
DO $$
DECLARE
  n_parts int; n_rates int; r record;
BEGIN
  SELECT count(*) INTO n_parts FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'token_usage_events'
    AND pg_get_expr(c.relpartbound, c.oid) NOT LIKE '%DEFAULT%';
  SELECT count(*) INTO n_rates FROM metering.token_credit_rates WHERE effective_to IS NULL;
  RAISE NOTICE '[token-usage] token_usage_events 月分区 % 个；生效中的费率 % 行', n_parts, n_rates;
  FOR r IN SELECT coalesce(provider_code,'*') AS p, coalesce(model_code,'*') AS m,
                  input_micro_per_1k AS i, output_micro_per_1k AS o, cache_write_micro_per_1k AS cw, cache_read_micro_per_1k AS cr,
                  effective_from FROM metering.token_credit_rates WHERE effective_to IS NULL ORDER BY effective_from LOOP
    RAISE NOTICE '  费率 %/% 自 %：in=% out=% cw=% cr=%（微 credit / 1K token）', r.p, r.m, r.effective_from, r.i, r.o, r.cw, r.cr;
  END LOOP;
END $$;

COMMIT;
