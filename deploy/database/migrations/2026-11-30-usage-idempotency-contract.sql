-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-30-usage-idempotency-contract.sql — 幂等权威补归属维度 **第 2 步（contract）**
--
-- 第 1 步（2026-11-29-usage-idempotency-scope.sql）只「加」：两列可空 + 三列唯一索引，
-- 旧主键原样留着，所以旧代码与新代码都能跑 —— 那是为了让部署没有窗口。
-- **本份才真正关闭缺陷**：收紧 NOT NULL，把主键从单列换成三列。
--
-- ── 跑本份的前提 ──
-- **新代码必须已经在产**（它会填那两列）。顺序是：第 1 步 → 部署 → 本份。
-- 反过来先跑本份，窗口期的旧代码会撞 NOT NULL —— 那正是拆两步要避开的事。
--
-- **这个顺序由操作者的两次派发保证**（第一次带 `migrate_until=2026-11-29`，部署之后再派
-- 一次不带它的），**不由本文件里的任何检查保证**。
--
-- 第一版在这里写的是「第 1 段先看有没有尚无归属的行，有就说明旧代码还在写」——那是**假的**：
-- 旧代码的占位行在同一事务里就被回填了 `event_id`，所以 expand 的回填总能从 `usage_events`
-- 解出它们的归属。回填不出的只能是「事件没了或从未写成」，与「新代码上没上产」无关。
-- 那条判据是拿一个手边恰好能区分的列当代理，防不住它声称防的事。删掉那句话比留着好：
-- 留着会让下一个人以为有机制在兜，于是不看派发顺序。
--
-- 幂等：回填带 WHERE；NOT NULL 重复设无副作用；主键先 DROP 再 ADD。整份一笔事务。
-- 2026-10-02 在一次性 postgres:18-alpine 上整目录按序重放两遍，两遍都 OK。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 再回填一次（窗口期旧代码写的那些行） ─────────────────────────────────
UPDATE metering.usage_idempotencies i
   SET workspace_id = e.workspace_id,
       product_id   = e.product_id
  FROM metering.usage_events e
 WHERE e.id = i.event_id
   AND e.created_at = i.event_created_at
   AND (i.workspace_id IS NULL OR i.product_id IS NULL);

-- ── 2. 回填不出归属的 → **移到归档表**，不删、不停 ──────────────────────────
--
-- 这类行是「占了键但事件没了或从未写成」：它们记录的用量为零（`consumed` 与 `per_pool`
-- 都没回填过），所以对计费没有贡献，但它们**挡着 NOT NULL**。
--
-- 为什么移而不是删：删是不可逆的判断，而这里没有必须立刻判的理由。移到归档表之后
-- contract 能继续，那几行随时可查；真要删，另起一条迁移、带着当时查过的结论删。
-- 2026-10-02 生产实测 2 行（run 36982816171 的 expand NOTICE）。
--
-- 表本身的权威在 ddl/50_metering.sql §8b（新库靠它建，本表在新库上是空的）。这里 IF NOT EXISTS
-- 是给**存量库**补的——它们不跑 DDL。两处的列必须一致：lint:schema-residue 会拦住只写在
-- 迁移里的表（2026-10-02 实撞），而 30-verify 断言「活库表数 == DDL 表数」，所以漏一边都会红。
CREATE TABLE IF NOT EXISTS metering.usage_idempotencies_orphaned (
    idempotency_key  varchar(128) NOT NULL,
    event_id         uuid,
    event_created_at timestamptz,
    consumed         bigint,
    per_pool         jsonb,
    created_at       timestamptz,
    archived_at      timestamptz  NOT NULL DEFAULT now(),
    archived_reason  text         NOT NULL
);
COMMENT ON TABLE metering.usage_idempotencies_orphaned IS
  '从 usage_idempotencies 移出来的「占了键但解不出归属」的行（2026-11-30 换主键时）：它们的 event_id 在 usage_events 里找不到对应行，记录的用量为零。不删是因为删是不可逆的判断，而这里没有必须立刻判的理由。';

WITH moved AS (
  DELETE FROM metering.usage_idempotencies
   WHERE workspace_id IS NULL OR product_id IS NULL
  RETURNING idempotency_key, event_id, event_created_at, consumed, per_pool, created_at
)
INSERT INTO metering.usage_idempotencies_orphaned
  (idempotency_key, event_id, event_created_at, consumed, per_pool, created_at, archived_reason)
SELECT idempotency_key, event_id, event_created_at, consumed, per_pool, created_at,
       '2026-11-30 换主键：event_id 在 usage_events 里解不出归属'
  FROM moved;

-- ── 3. 收紧为 NOT NULL ──────────────────────────────────────────────────────
ALTER TABLE metering.usage_idempotencies
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN product_id   SET NOT NULL;

-- ── 4. 换主键（先 DROP 再 ADD，幂等且自愈） ─────────────────────────────────
-- 旧主键是列上内联的 `PRIMARY KEY`，默认名 usage_idempotencies_pkey；新主键同名。
ALTER TABLE metering.usage_idempotencies
  DROP CONSTRAINT IF EXISTS usage_idempotencies_pkey;
ALTER TABLE metering.usage_idempotencies
  ADD CONSTRAINT usage_idempotencies_pkey PRIMARY KEY (workspace_id, product_id, idempotency_key);

-- 主键自带索引，第 1 步那条过渡用的唯一索引可以收掉（整目录重放时它会被重新建出来，
-- 再被这一句收掉；表是个位数到千级行，这点索引开销无所谓）。
DROP INDEX IF EXISTS metering.uq_usage_idempotencies_scoped;

-- ── 5. 列级锁：锚点列定型为三列 + created_at ────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    REVOKE UPDATE ON metering.usage_idempotencies FROM platform_svc;
    GRANT UPDATE (event_id, event_created_at, consumed, per_pool)
      ON metering.usage_idempotencies TO platform_svc;
  END IF;
END
$$;

-- ── 6. 审计段 ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pk       text;
  v_rows     int;
  v_archived int;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY k.ord)
    INTO v_pk
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conname = 'usage_idempotencies_pkey'
     AND c.conrelid = 'metering.usage_idempotencies'::regclass;

  IF v_pk IS DISTINCT FROM 'workspace_id,product_id,idempotency_key' THEN
    RAISE EXCEPTION '主键没换成预期的三列，实际是：%', v_pk;
  END IF;

  SELECT count(*) INTO v_rows FROM metering.usage_idempotencies;
  SELECT count(*) INTO v_archived FROM metering.usage_idempotencies_orphaned;
  RAISE NOTICE '幂等权威 contract 完成：主键 = (workspace_id, product_id, idempotency_key)，现有 % 行全部带归属；归档表里 % 行（解不出归属的，未删）', v_rows, v_archived;
END
$$;

COMMIT;
