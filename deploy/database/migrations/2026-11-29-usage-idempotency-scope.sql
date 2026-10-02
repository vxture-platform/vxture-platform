-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-29-usage-idempotency-scope.sql — 幂等权威补上归属维度
--
-- owner 2026-10-02 裁定：主键改成 (workspace_id, product_id, idempotency_key)。
--
-- ── 为什么 ──
-- `idempotency_key` 原本是**全局**主键，而 key 完全由产品侧自选，校验只是
-- `/^[\x21-\x7e]{1,128}$/`（任意可打印 ASCII，`"1"` 合法）。两家撞同一个 key 时，
-- `pg-consume.repository.ts` 的 replay 分支会：
--   ① **不扣减**，回 `status: ok` + `replayed: true` —— 调用方以为记上了，用量消失；
--   ② 把上一次的 `consumed` 与 `per_pool`（池 id + 扣减量）原样回给复用者。
-- 第一条是计费完整性，第二条是跨租户读。两者与走 Bearer 还是走旧凭据无关。
--
-- 表注释自己写着「全局唯一 key 才成立」——schema 知道它需要全局唯一，但没有任何东西
-- 强制调用方做到，C3 契约也从没要求过。**同一个教训仓里已经记过一次**：
-- `docs/30-design/data_commerce_220_provisioning.md:57` 为另一张幂等表写下
-- 「**修正**：派生须含 `workspace_id`——…仅靠二者不同 workspace 首个 provisioned 会撞键」。
-- 在 provisioning 上记住了，在 usage 上没记住。
--
-- ── 为什么连 product_id 一起进键 ──
-- 键的含义是「**某个调用方的某一次动作**」。同一工作空间下两个产品各自上报自己的用量，
-- 用同一个业务键（`order-123`）是正当的，它们是两件事，各自都该扣。只按 workspace 收口
-- 会让这两件事互相顶掉一件。
--
-- ── 本迁移整体在一个事务里 ──
-- 它换主键。上一份（2026-11-28）没有 BEGIN/COMMIT，审计段 RAISE 时第 1、2 段已经提交，
-- 生产停在半截。换主键没有「半截还能用」的中间态，所以这份包成一笔。
--
-- 幂等：列 IF NOT EXISTS；回填带 WHERE；主键先 DROP 再 ADD（弱版/旧版都会被顶掉）。
-- 2026-10-02 在一次性 postgres:18-alpine 上整目录按序重放两遍，两遍都 OK。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 两列（先可空，回填完再 NOT NULL） ────────────────────────────────────
ALTER TABLE metering.usage_idempotencies
  ADD COLUMN IF NOT EXISTS workspace_id uuid,
  ADD COLUMN IF NOT EXISTS product_id   uuid;

COMMENT ON COLUMN metering.usage_idempotencies.workspace_id IS
  '归属工作空间。与 product_id、idempotency_key 一起组成主键——key 由产品侧自选，不带归属时两家撞键会互相顶掉（静默漏扣 + 回对方池明细）。';
COMMENT ON COLUMN metering.usage_idempotencies.product_id IS
  '上报方产品。同一工作空间下两个产品用同一个业务键是正当的，它们是两件事，各自都该扣。';

-- ── 2. 回填：从 usage_events 按复合键取（它是分区表，PK 是 (id, created_at)） ──
UPDATE metering.usage_idempotencies i
   SET workspace_id = e.workspace_id,
       product_id   = e.product_id
  FROM metering.usage_events e
 WHERE e.id = i.event_id
   AND e.created_at = i.event_created_at
   AND (i.workspace_id IS NULL OR i.product_id IS NULL);

-- ── 3. 回填不到的 → 停下，不猜 ──────────────────────────────────────────────
DO $$
DECLARE
  v_orphan int;
BEGIN
  SELECT count(*) INTO v_orphan
    FROM metering.usage_idempotencies
   WHERE workspace_id IS NULL OR product_id IS NULL;

  IF v_orphan > 0 THEN
    -- RAISE 的格式串必须是**字面量**，不能用 || 拼（PL/pgSQL 语法，2026-10-01 实测过）。
    RAISE EXCEPTION '有 % 行幂等记录回填不出归属：它们的 event_id 在 usage_events 里找不到对应行（通常是「占了键但从未写事件」的残留）。这些行记录的用量为零，删掉只会失去一次「从未被记录的调用」的重放保护；但那是取舍不是推断，所以本迁移停在这里。确认后在本文件第 3 段前加一条带 WHERE 的 DELETE 再跑。', v_orphan;
  END IF;
END
$$;

-- ── 4. 收紧为 NOT NULL ──────────────────────────────────────────────────────
ALTER TABLE metering.usage_idempotencies
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN product_id   SET NOT NULL;

-- ── 5. 换主键（先 DROP 再 ADD，幂等且自愈） ─────────────────────────────────
-- 旧主键是列上内联的 `PRIMARY KEY`，默认名 usage_idempotencies_pkey。
ALTER TABLE metering.usage_idempotencies
  DROP CONSTRAINT IF EXISTS usage_idempotencies_pkey;
ALTER TABLE metering.usage_idempotencies
  ADD CONSTRAINT usage_idempotencies_pkey PRIMARY KEY (workspace_id, product_id, idempotency_key);

-- 按 key 单独查仍要能走索引（对账时手上只有 key 的那条路）。
CREATE INDEX IF NOT EXISTS idx_usage_idempotencies_key
  ON metering.usage_idempotencies (idempotency_key);

-- ── 6. 列级锁：锚点列多了两个，可改列集合不变 ───────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    REVOKE UPDATE ON metering.usage_idempotencies FROM platform_svc;
    GRANT UPDATE (event_id, event_created_at, consumed, per_pool)
      ON metering.usage_idempotencies TO platform_svc;
  END IF;
END
$$;

-- ── 7. 审计段 ───────────────────────────────────────────────────────────────
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
  RAISE NOTICE '幂等权威：主键 = (workspace_id, product_id, idempotency_key)，现有 % 行，全部带归属', v_rows;
END
$$;

COMMIT;
