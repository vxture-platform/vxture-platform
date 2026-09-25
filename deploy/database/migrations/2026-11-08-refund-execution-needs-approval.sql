-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 退款执行必须先过审核（库级门）
--
-- 【为什么要库级门】
-- `billing.refunds` 有两根状态：审核 `audit_status`（pending/approved/rejected）与
-- 执行 `refund_status`（pending/processing/success/failed）。叉乘 12 种，合法的只有
-- 六种；其中两种是**资金事故**：
--   rejected × success  审核没过却退了钱
--   pending  × success  没审就退
-- 今天挡住它们的只有 `executeRefund` 里那一句 `where audit_status = 'approved'`。
-- 一条旁路 SQL、一次手工修数据、一个新写的批处理，都能绕过它——而后果是钱出去了。
--
-- 这条 CHECK 把同一件事放到库里：**只有审核通过的单，才允许离开 `refund_status
-- = 'pending'`**。谁写都治。
--
--   CHECK (refund_status = 'pending' OR audit_status = 'approved')
--
-- 读法：refund_status 还在 pending 时 audit 可以是任意值（待审、已驳回都合理）；
-- 一旦 refund_status 动了（processing/success/failed），audit 必须已经是 approved。
--
-- 【只有这一件事】
-- 本来还打算补 `idx_refunds_order_id`（订单列表每行一次 `exists ... where
-- r.order_id = o.id`）。核查后发现**它早就有**：52_billing.sql 与 2026-09-03 的
-- 订单实体拆分迁移里都建了。我先前只读到 refunds 索引块的前四行就下了结论。
--
-- 【不做什么】
-- 不动 `billing.payments.pay_status` 的值域。那里的 `pending` 与 `refunding` 确实
-- 没有写入方，但 `pending` 是**该列的 DEFAULT**——从 CHECK 里摘掉它，任何不显式给
-- pay_status 的 INSERT 当场失败。两个未用值的清理换不来这个风险；DDL 里注明它们是
-- 保留值即可（见 52_billing.sql 的注释）。
--
-- 幂等：CHECK 先查再建；跑第二遍跳过。迁移每次 deploy 全量重放。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 先看存量有没有违反的行 ────────────────────────────────────────────────
-- 有就**停下来**，不自动改。这类行意味着「钱在没有审核通过的情况下动过」，该由人
-- 去看那几笔到底发生了什么，不该被一条迁移悄悄改状态掩盖过去。
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM billing.refunds
   WHERE refund_status <> 'pending' AND audit_status <> 'approved';
  IF bad > 0 THEN
    RAISE EXCEPTION
      '[refund-approval-gate] % 笔退款在未通过审核的情况下已离开 pending —— 先人工核这几笔，再装这道门',
      bad;
  END IF;
END $$;

-- ── 2. 装门 ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'billing.refunds'::regclass
       AND conname = 'chk_refunds_execute_needs_approval'
  ) THEN
    ALTER TABLE billing.refunds
      ADD CONSTRAINT chk_refunds_execute_needs_approval
      CHECK (refund_status = 'pending' OR audit_status = 'approved');
    RAISE NOTICE '[refund-approval-gate] CHECK 已装上';
  ELSE
    RAISE NOTICE '[refund-approval-gate] CHECK 已在，跳过';
  END IF;
END $$;

COMMIT;

-- ── 审计：证明门在管事，不只是「被建出来了」 ────────────────────────────────
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'billing.refunds'::regclass
     AND conname = 'chk_refunds_execute_needs_approval';
  IF def IS NULL THEN
    RAISE EXCEPTION '[refund-approval-gate] CHECK 不在';
  END IF;
  -- 只断言「名字在」是不够的：同名约束可以写着别的谓词（比如被谁改成恒真）。
  -- 这里核它的定义里两个关键量都在——refund_status 的 pending 分支与 audit 的
  -- approved 分支。
  IF def NOT LIKE '%refund_status%' OR def NOT LIKE '%approved%' THEN
    RAISE EXCEPTION '[refund-approval-gate] CHECK 的定义不是这道门：%', def;
  END IF;

  RAISE NOTICE '[refund-approval-gate] OK —— 退款执行必须先过审核';
END $$;
