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
-- 判据不靠记性：第 1 段先看有没有「尚无归属」的行，有就说明旧代码还在写，直接停下。
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

-- ── 2. 回填不出归属的 → 停下，不猜 ──────────────────────────────────────────
DO $$
DECLARE
  v_orphan int;
BEGIN
  SELECT count(*) INTO v_orphan
    FROM metering.usage_idempotencies
   WHERE workspace_id IS NULL OR product_id IS NULL;

  IF v_orphan > 0 THEN
    -- RAISE 的格式串必须是**字面量**，不能用 || 拼（PL/pgSQL 语法，2026-10-01 实测过）。
    RAISE EXCEPTION '有 % 行幂等记录回填不出归属。两种成因，处置相反：① 新代码还没上产，旧代码仍在写无归属的行 —— 那就先部署再跑本份（本份必须在部署之后）；② 它们的 event_id 在 usage_events 里找不到对应行，是「占了键但从未写事件」的残留 —— 那些行记录的用量为零，删掉只会失去一次「从未被记录的调用」的重放保护，但那是取舍不是推断。先分清是哪一种。', v_orphan;
  END IF;
END
$$;

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
  v_pk   text;
  v_rows int;
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
  RAISE NOTICE '幂等权威 contract 完成：主键 = (workspace_id, product_id, idempotency_key)，现有 % 行，全部带归属', v_rows;
END
$$;

COMMIT;
