-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 退款补「已发起转账」这一段（设计 A，PR-D1）
--
-- 【缺的不是一条待办，是一个动作】
-- `billing.refunds.refund_status` 的值域里有 `processing`（52_billing.sql 的
-- chk_refunds_refund_status），但全仓没有写入方：退款只有「审 → 钱已经打出去了」两段，
-- 中间那段（钱打出去了、还没到账）没有时钟、没有凭证、没有流水号。待办
-- `refund_processing_stuck` 的阈值接好了却永远 0 条，运营告警文案已按银行转账在写。
--
-- 本迁移给这一段落地：
--   · `billing.refunds` 十一列：transfer_channel / transfer_reference / transfer_initiated_at /
--     transfer_initiated_by / transfer_date / transfer_attempt / payout_account_id /
--     payout_account_label / recipient_account_name / recipient_bank_name / recipient_bank_account。
--     命名纪律：不带 `_no`——98 规则②会把它判成锚点，而流水号在「失败 → 再发起」时要换号。
--   · 三条 CHECK（channel 三值；processing / success 必须先有「发起」；银行转账必须有回单号）。
--   · 两个部分唯一索引：同一张回单不能挂两张退款单；**一张订单同一时刻至多一张活退款单**
--     （活 = 非 rejected 且非 failed，与 getRefundBasis 的 existing_refund 子查询逐字同义）。
--   · `billing.payments` 两列 receive_account_id / receive_account_label：申报那一刻客户看到的
--     平台收款账户快照（设计 B 落地后由治理台喂；今天恒 NULL）。它们是锚点（EXTRA_ANCHOR），
--     98 不授 UPDATE。
--
-- 【存量怎么办】
--   ① 存量 `success` 行没有「发起」的事实，装门会顶红它们——先回填 transfer_channel='legacy'、
--      transfer_initiated_at=refund_at、transfer_attempt=1。legacy 的意思就是「那时没有这一段」，
--      不编一个流水号。
--   ② 同一订单下已有 > 1 张活退款单的，**停下来**并列出单号：那是双付风险，该由人处置，
--      不由迁移自动合并。
--
-- 【授权】新列的 GRANT UPDATE 由 28d 随后重放的 98_column_locks.sql 给（2026-09-07 事故后的
-- 机制）；这里也显式 GRANT 一遍——单跑本脚本（不经 28d）的库不至于缺授权。
--
-- 幂等：加列 IF NOT EXISTS、CHECK / 索引先查再建；跑第二遍 0 行回填、全部跳过。
-- 迁移每次 deploy 全量重放。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 加列（先加列，回填与装门才有落点）────────────────────────────────────
ALTER TABLE billing.refunds
  ADD COLUMN IF NOT EXISTS transfer_channel        varchar(16),
  ADD COLUMN IF NOT EXISTS transfer_reference      varchar(128),
  ADD COLUMN IF NOT EXISTS transfer_initiated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS transfer_initiated_by   uuid,
  ADD COLUMN IF NOT EXISTS transfer_date           date,
  ADD COLUMN IF NOT EXISTS transfer_attempt        int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_account_id       uuid,
  ADD COLUMN IF NOT EXISTS payout_account_label    varchar(128),
  ADD COLUMN IF NOT EXISTS recipient_account_name  varchar(128),
  ADD COLUMN IF NOT EXISTS recipient_bank_name     varchar(128),
  ADD COLUMN IF NOT EXISTS recipient_bank_account  varchar(64);

ALTER TABLE billing.payments
  ADD COLUMN IF NOT EXISTS receive_account_id    uuid,
  ADD COLUMN IF NOT EXISTS receive_account_label varchar(128);

-- ── 2. 存量：数一数、停不停 ─────────────────────────────────────────────────
DO $$
DECLARE
  legacy_rows bigint;
  dup_orders  text;
BEGIN
  -- 2a. 将回填的 legacy 行：成功了却没有「发起」事实的（第二遍 0 行）。
  SELECT count(*) INTO legacy_rows
    FROM billing.refunds
   WHERE refund_status = 'success' AND transfer_initiated_at IS NULL;
  RAISE NOTICE '[refund-transfer-step] % 笔存量 success 退款将回填为 legacy', legacy_rows;

  -- 2b. 同一订单下活单 > 1 的订单：有就停。活 = 非 rejected 且非 failed。
  SELECT string_agg(
           format('%s[%s]', o.order_no, x.refund_nos), '; ' ORDER BY o.order_no)
    INTO dup_orders
    FROM (
      SELECT r.order_id, count(*) AS n,
             string_agg(r.refund_no, ',' ORDER BY r.created_at) AS refund_nos
        FROM billing.refunds r
       WHERE r.order_id IS NOT NULL
         AND r.audit_status <> 'rejected'
         AND r.refund_status <> 'failed'
       GROUP BY r.order_id
      HAVING count(*) > 1
    ) x
    JOIN billing.orders o ON o.id = x.order_id;
  IF dup_orders IS NOT NULL THEN
    RAISE EXCEPTION
      '[refund-transfer-step] 以下订单各有两张以上在途退款单，先人工处置（驳回或标失败多余的那张）再装门：%',
      dup_orders;
  END IF;
END $$;

-- ── 3. 回填 legacy（第二遍 0 行）─────────────────────────────────────────────
UPDATE billing.refunds
   SET transfer_channel      = 'legacy',
       transfer_initiated_at = coalesce(refund_at, updated_at),
       transfer_attempt      = greatest(transfer_attempt, 1)
 WHERE refund_status = 'success'
   AND transfer_initiated_at IS NULL;

-- ── 4. 装门：三条 CHECK + 两个部分唯一索引（存在即跳过）─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'billing.refunds'::regclass
                    AND conname = 'chk_refunds_transfer_channel') THEN
    ALTER TABLE billing.refunds
      ADD CONSTRAINT chk_refunds_transfer_channel
      CHECK (transfer_channel IS NULL OR transfer_channel IN ('bank_transfer','alipay','legacy'));
    RAISE NOTICE '[refund-transfer-step] chk_refunds_transfer_channel 已装上';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'billing.refunds'::regclass
                    AND conname = 'chk_refunds_moved_has_transfer') THEN
    ALTER TABLE billing.refunds
      ADD CONSTRAINT chk_refunds_moved_has_transfer
      CHECK (refund_status IN ('pending','failed') OR transfer_initiated_at IS NOT NULL);
    RAISE NOTICE '[refund-transfer-step] chk_refunds_moved_has_transfer 已装上';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'billing.refunds'::regclass
                    AND conname = 'chk_refunds_bank_needs_reference') THEN
    ALTER TABLE billing.refunds
      ADD CONSTRAINT chk_refunds_bank_needs_reference
      CHECK (transfer_channel IS DISTINCT FROM 'bank_transfer' OR transfer_reference IS NOT NULL);
    RAISE NOTICE '[refund-transfer-step] chk_refunds_bank_needs_reference 已装上';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_refunds_transfer_reference
  ON billing.refunds (transfer_channel, transfer_reference)
  WHERE transfer_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_refunds_one_live_per_order
  ON billing.refunds (order_id)
  WHERE audit_status <> 'rejected' AND refund_status <> 'failed';

-- ── 5. 授权（98 随后会整份重放；这里显式给一遍，单跑也不缺）──────────────────
GRANT UPDATE (transfer_channel, transfer_reference, transfer_initiated_at, transfer_initiated_by,
              transfer_date, transfer_attempt, payout_account_id, payout_account_label,
              recipient_account_name, recipient_bank_name, recipient_bank_account)
  ON billing.refunds TO platform_svc;

COMMIT;

-- ── 审计：证明门在管事，不只是「被建出来了」 ────────────────────────────────
DO $$
DECLARE
  def      text;
  n_cols   int;
  n_bad    bigint;
  n_grant  int;
BEGIN
  -- 十一列 + payments 两列都在。
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'billing' AND table_name = 'refunds'
     AND column_name IN ('transfer_channel','transfer_reference','transfer_initiated_at',
                         'transfer_initiated_by','transfer_date','transfer_attempt',
                         'payout_account_id','payout_account_label','recipient_account_name',
                         'recipient_bank_name','recipient_bank_account');
  IF n_cols <> 11 THEN
    RAISE EXCEPTION '[refund-transfer-step] refunds 期望 11 个转账列，实测 %', n_cols;
  END IF;
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'billing' AND table_name = 'payments'
     AND column_name IN ('receive_account_id','receive_account_label');
  IF n_cols <> 2 THEN
    RAISE EXCEPTION '[refund-transfer-step] payments 期望 2 个收款账户快照列，实测 %', n_cols;
  END IF;

  -- 门的定义里关键量都在（同名约束可以写着别的谓词）。
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'billing.refunds'::regclass AND conname = 'chk_refunds_moved_has_transfer';
  IF def IS NULL OR def NOT LIKE '%transfer_initiated_at%' OR def NOT LIKE '%failed%' THEN
    RAISE EXCEPTION '[refund-transfer-step] chk_refunds_moved_has_transfer 不是这道门：%', def;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'billing.refunds'::regclass AND conname = 'chk_refunds_bank_needs_reference';
  IF def IS NULL OR def NOT LIKE '%bank_transfer%' OR def NOT LIKE '%transfer_reference%' THEN
    RAISE EXCEPTION '[refund-transfer-step] chk_refunds_bank_needs_reference 不是这道门：%', def;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'billing.refunds'::regclass AND conname = 'chk_refunds_transfer_channel';
  IF def IS NULL OR def NOT LIKE '%legacy%' THEN
    RAISE EXCEPTION '[refund-transfer-step] chk_refunds_transfer_channel 不是这道门：%', def;
  END IF;

  -- 两个部分唯一索引都在，且各自带 WHERE（没有 WHERE 的同名索引会把合法的多张 failed 单也拒掉）。
  -- 逐个点名断言在/不在（0/1），不数「共几个」——全量计数会随后来的任何索引新增而失效。
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'billing' AND tablename = 'refunds'
       AND indexname = 'uq_refunds_transfer_reference'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE%') THEN
    RAISE EXCEPTION '[refund-transfer-step] 缺带 WHERE 的部分唯一索引 uq_refunds_transfer_reference';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'billing' AND tablename = 'refunds'
       AND indexname = 'uq_refunds_one_live_per_order'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE%') THEN
    RAISE EXCEPTION '[refund-transfer-step] 缺带 WHERE 的部分唯一索引 uq_refunds_one_live_per_order';
  END IF;

  -- 回填收口：不再有「成功却没有发起事实」的行。
  SELECT count(*) INTO n_bad
    FROM billing.refunds
   WHERE refund_status IN ('processing', 'success') AND transfer_initiated_at IS NULL;
  IF n_bad <> 0 THEN
    RAISE EXCEPTION '[refund-transfer-step] 仍有 % 笔离开 pending 的退款没有发起事实', n_bad;
  END IF;

  -- 活库 GRANT 不滞后于文件：十一列对 platform_svc 都可 UPDATE。
  SELECT count(*) INTO n_grant
    FROM information_schema.column_privileges
   WHERE table_schema = 'billing' AND table_name = 'refunds'
     AND grantee = 'platform_svc' AND privilege_type = 'UPDATE'
     AND column_name IN ('transfer_channel','transfer_reference','transfer_initiated_at',
                         'transfer_initiated_by','transfer_date','transfer_attempt',
                         'payout_account_id','payout_account_label','recipient_account_name',
                         'recipient_bank_name','recipient_bank_account');
  IF n_grant <> 11 THEN
    RAISE EXCEPTION '[refund-transfer-step] platform_svc 对转账列的 UPDATE 授权期望 11，实测 %', n_grant;
  END IF;

  RAISE NOTICE '[refund-transfer-step] OK —— 退款有了「已发起转账」这一段，一张订单至多一张活退款单';
END $$;
