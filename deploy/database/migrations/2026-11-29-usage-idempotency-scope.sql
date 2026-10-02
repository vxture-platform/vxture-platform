-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-29-usage-idempotency-scope.sql — 幂等权威补归属维度 **第 1 步（expand）**
--
-- owner 2026-10-02 裁定：主键改成 (workspace_id, product_id, idempotency_key)。
-- 本份只做「加」，第 2 步（2026-11-30-usage-idempotency-contract.sql）才「减」。
--
-- ── 为什么要改 ──
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
-- 键的含义是「**某个调用方的某一次动作**」。同一工作空间下两个产品各自上报自己的用量、
-- 用同一个业务键（`order-123`）是正当的，它们是两件事、各自都该扣。只按 workspace 收口
-- 会让这两件事互相顶掉一件。
--
-- ── 为什么拆两步（这一份不动旧主键） ──
-- 一份做完会造出一个 **consume 报错的窗口**，两个方向都会：
--   · 先迁移：窗口期跑的还是旧代码，它 `insert (idempotency_key, created_at)`，
--     撞上 NOT NULL；
--   · 先部署：新代码的 `ON CONFLICT (三列)` 在单列主键上直接报
--     「no unique or exclusion constraint matching」（2026-10-02 在一次性库上实见）。
-- 多数产品按契约本地缓冲 + 异步重试扛得住，但 arda 的 `ai.credit` 是 atomic 预扣、
-- **同步前置门控**，那几分钟它的贵操作会失败。所以：
--   第 1 步（本份）加列 + 回填 + **加三列唯一索引，旧主键原样留着** → 旧代码照常跑，
--     新代码的 ON CONFLICT 也有匹配的约束可用；
--   部署；
--   第 2 步 收紧 NOT NULL + 把主键换成三列 → 缺陷到这一刻才真正关闭。
-- 窗口期内唯一的行为差异是「两个空间撞同一个键」那种罕见情形会**硬报错**而不是静默重放——
-- 比原来的静默漏扣好，不是新的坏。
--
-- 幂等：列 IF NOT EXISTS；回填带 WHERE；索引 IF NOT EXISTS。整份一笔事务。
-- 2026-10-02 在一次性 postgres:18-alpine 上整目录按序重放两遍，两遍都 OK。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 两列（本步保持可空：旧代码还在写，它不会填这两列） ───────────────────
ALTER TABLE metering.usage_idempotencies
  ADD COLUMN IF NOT EXISTS workspace_id uuid,
  ADD COLUMN IF NOT EXISTS product_id   uuid;

COMMENT ON COLUMN metering.usage_idempotencies.workspace_id IS
  '归属工作空间。与 product_id、idempotency_key 一起组成主键（2026-11-30 那份收紧后）——key 由产品侧自选，不带归属时两家撞键会互相顶掉（静默漏扣 + 回对方池明细）。';
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

-- ── 3. 三列唯一索引：新代码的 ON CONFLICT 要有匹配的约束 ────────────────────
-- 本步**不碰旧主键**。可空列上的唯一索引对 NULL 不去重，所以窗口期旧代码写进来的
-- (NULL, NULL, key) 行不会互相冲突，而它们的去重仍由旧主键担着。
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_idempotencies_scoped
  ON metering.usage_idempotencies (workspace_id, product_id, idempotency_key);

-- 按 key 单独查仍要能走索引（对账时手上只有 key 的那条路）。
CREATE INDEX IF NOT EXISTS idx_usage_idempotencies_key
  ON metering.usage_idempotencies (idempotency_key);

-- ── 4. 列级锁：可改列集合不变，锚点列到第 2 步才定型 ────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    REVOKE UPDATE ON metering.usage_idempotencies FROM platform_svc;
    GRANT UPDATE (event_id, event_created_at, consumed, per_pool)
      ON metering.usage_idempotencies TO platform_svc;
  END IF;
END
$$;

-- ── 5. 审计段 ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_null int;
  v_rows int;
BEGIN
  SELECT count(*) INTO v_rows FROM metering.usage_idempotencies;
  SELECT count(*) INTO v_null
    FROM metering.usage_idempotencies
   WHERE workspace_id IS NULL OR product_id IS NULL;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'uq_usage_idempotencies_scoped') THEN
    RAISE EXCEPTION '三列唯一索引没建成——新代码的 ON CONFLICT 会找不到匹配的约束';
  END IF;

  -- 本步**刻意不拦** NULL 行：它们是旧代码在窗口期写的，第 2 步会再回填一次并在那时拦。
  RAISE NOTICE '幂等权威 expand 完成：共 % 行，其中 % 行尚无归属（旧代码写的，第 2 步再回填）', v_rows, v_null;
END
$$;

COMMIT;
