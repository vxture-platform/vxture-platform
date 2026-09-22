-- ═══════════════════════════════════════════════════════════════════════════
-- 套餐版本：补发布时刻 + 主版本号（owner 2026-09-22）。
--
-- ── 为什么要加 ──
-- `product.plan_versions` 只有 `created_at`——那是**草稿何时开的**，不是何时启用。
-- 运营问的「这一版什么时间启用」在库里没有落点：发布那一刻既不在表里，也不在审计里
-- （发布动作此前压根不留痕，同批已补 `product.plan_version.publish`）。
--
-- owner：「版本号不是强绑定日期，是设定的逻辑。V1.20260922 这种样式，都是需要设定的，
-- 不能自己无限增。可以存在 V1 下多个日期版本，如调整了很小的细节，修改一两个配额，
-- 但是价格没有改变。」
--
-- ── 两列各管一段，别混 ──
--   major_no      主版本号 V1/V2…：**人设定的商业代际**，不自增。价格或档位结构变了
--                 才升；只改配额这类小改沿用当前主版本 → 同一 V1 下多个日期修订
--   published_at  发布（启用）那一刻：**自动**，发布时写入。它是事实，不是设定项
-- 展示口径 `V<major_no>.<published_at:YYYYMMDD>`（未发布的草稿显示为草稿）。
--
-- `version_no` 一列不动：它是内部身份——唯一键 `(plan_id, version_no)`、排序、以及
-- 详情路由 `/plan-versions/<产品>/<套餐码>/<版本号>/edit` 全都拄着它，而且它是 98 的
-- 锚点列本就不可改写。所以不是「把编号换成日期」，是在它旁边补两列。
--
-- ── 存量不回填 ──
-- 本列上线前就已发布的版本没有发布时刻可考，`published_at` 留空，界面显示「—」。
-- **不拿 `created_at` 冒充**：那是另一个时刻，填进去就是给一个看起来很确定的错答案。
-- 同理**不加**「published ⇔ published_at 非空」的 CHECK：它会让存量行当场违反，
-- 也会顶穿 seed 里那些已发布版本。
-- major_no 全部落到默认值 1——存量版本都还在第一个商业代际里。
--
-- ── 98 列锁必须同步 ──
-- `plan_versions` 被 REVOKE 过 UPDATE 再按列 GRANT。`published_at` 在发布时由 UPDATE
-- 写入，不进 GRANT 名单的话生产上 platform_svc 写它会 42501 **整条事务回滚**（发布
-- 当场失败），而静态守卫只比源码清单、看不见活库的 GRANT 滞后。所以这里把 GRANT 重新
-- 发一遍，包含它。
--
-- `major_no` **不进** GRANT：它是 `_no` 后缀，按 98 的规则②就是锚点列
-- （`lint:column-locks` 会拦）。它只在开草稿那一次 INSERT 写入、之后不改——正好与
-- 「主版本号是一次设定」对上。要换代际就删掉草稿重开一份。
--
-- 重复执行安全（IF NOT EXISTS + 幂等 GRANT + 约束先 DROP 再 ADD）。
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE product.plan_versions
  ADD COLUMN IF NOT EXISTS major_no int NOT NULL DEFAULT 1;
ALTER TABLE product.plan_versions
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE product.plan_versions
  DROP CONSTRAINT IF EXISTS chk_plan_versions_major_no;
ALTER TABLE product.plan_versions
  ADD CONSTRAINT chk_plan_versions_major_no CHECK (major_no >= 1);

-- 列锁：重发 GRANT，把 published_at 纳入可写名单（与 98_column_locks.sql 保持一致）。
-- major_no 不进——它是锚点列，只在 INSERT 时写。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    REVOKE UPDATE ON product.plan_versions FROM platform_svc;
    GRANT UPDATE (plan_id, status, is_locked, trial_cycle_unit,
                  trial_cycle_count, published_at)
      ON product.plan_versions TO platform_svc;
  END IF;
END
$$;

DO $$
DECLARE
  published_without_date int;
BEGIN
  SELECT count(*) INTO published_without_date
    FROM product.plan_versions
   WHERE status = 'published' AND published_at IS NULL;

  RAISE NOTICE '[plan-version-published-at] 已发布但无发布时刻的版本 % 个（本列上线之前发布的，界面显示「—」，不回填）',
    published_without_date;
END $$;
