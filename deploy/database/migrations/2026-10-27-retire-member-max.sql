-- ═══════════════════════════════════════════════════════════════════════════
-- `member.max` 退役（owner 2026-09-23：「member.max = 租户成员上限，是占位和系统
-- 限制，不是卖点」）。
--
-- ── 它现在是什么 ──
-- 一个挂在 arda 名下、`merge_strategy='max'` 的产品指标，出现在 6 个套餐组件的
-- quota 里（1 / 1 / 1 / 5 / -1 / 1），被官网订阅页当「席位 / Seats」展示，
-- 而**全仓零执行点**——三个 BFF、services、packages 一处不读。
--
-- 也就是说：客户在订阅页看到一个按档位递增的「席位」数字，它不限制任何东西。
--
-- ── 它应该是什么 ──
-- 租户成员上限是**系统闸**，已于 2026-10-25 实现（admin.settings 的
-- tenancy/tenant.member_limit=500 + tenancy.tenants.member_limit 单租户覆盖，
-- 执行点在 addOrgMember / acceptInvitation）。那条才是真正生效的。
-- 套餐里这个是历史占位，与它同名而不同物。
--
-- ── 所以退役要动三处，少一处就留下残迹 ──
-- ① 6 个套餐组件的 quota 里摘掉这个键 —— 不摘，官网继续显示一个不生效的数字
-- ② product_metrics 里那一行 —— 不摘，opera 的计量页继续列着它、还能被命名
-- ③ metric_catalog 里可能有的名字 —— 本批之前刻意没给它命名，但运营可能填过
--
-- 注意**不动** admin.settings 与 tenancy.tenants 上的系统闸：那是另一件事，
-- 同名不同物，退役的是套餐里这个占位。
--
-- 重复执行安全（按存在与否筛，第二遍 0 行）。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 关于已发布版本：这是一次**刻意破例**，owner 2026-09-23 明确裁定 ──────────
-- `trg_plan_component_guard_lock` 挡住对 is_locked 版本的 plan_components 改动，
-- 那条契约（已发布即冻结）是订阅可审计性的地基：客户买的就是那一版的内容。
-- 本迁移要清的 10 处里有 6 处落在已发布版本上，绕不过它。
--
-- 我向 owner 报了这个代价，owner 选择「连已发布的一起清」。理由成立：这个键
-- **不生效任何东西**（全仓零执行点），留着只会让订阅页显示一个假的「席位」数字，
-- 而那比「版本字节级冻结」更贴近客户实际看到的东西。
--
-- 破例的三条自律：
--   ① 只在本事务内禁用该触发器，改完立刻恢复并断言它回来了；
--   ② 不删触发器、不改它的定义——下一次仍然照常挡；
--   ③ **逐行打印被清掉的 (套餐, 版本, 原值)**，让 deploy 日志成为这次破例的台账。
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  quota_rows  int;
  metric_rows int;
  name_rows   int;
  r           record;
BEGIN
  -- ③ 先留痕：破了冻结契约，至少要留下改了什么
  FOR r IN
    SELECT p.plan_code, pv.version_no, pv.status, pc.quota->>'member.max' AS val
      FROM product.plan_components pc
      JOIN product.plan_versions pv ON pv.id = pc.plan_version_id
      JOIN product.plans p ON p.id = pv.plan_id
     WHERE pc.quota ? 'member.max'
     ORDER BY p.plan_code, pv.version_no
  LOOP
    RAISE NOTICE '[retire-member-max] 清除 %  v%  (%)  原值=%',
      r.plan_code, r.version_no, r.status, r.val;
  END LOOP;

  -- ① 套餐组件的 quota（含已发布版本，见上方说明）
  ALTER TABLE product.plan_components DISABLE TRIGGER trg_plan_component_guard_lock;
  UPDATE product.plan_components
     SET quota = quota - 'member.max'
   WHERE quota ? 'member.max';
  GET DIAGNOSTICS quota_rows = ROW_COUNT;
  ALTER TABLE product.plan_components ENABLE TRIGGER trg_plan_component_guard_lock;

  -- ② 产品指标登记
  DELETE FROM product.product_metrics WHERE metric_key = 'member.max';
  GET DIAGNOSTICS metric_rows = ROW_COUNT;

  -- ③ 可能被运营填过的名字
  DELETE FROM product.metric_catalog WHERE metric_key = 'member.max';
  GET DIAGNOSTICS name_rows = ROW_COUNT;

  RAISE NOTICE '[retire-member-max] 套餐 quota % 处、产品指标 % 行、命名 % 行（第二遍应全为 0）',
    quota_rows, metric_rows, name_rows;
END $$;

DO $$
DECLARE leftover int;
BEGIN
  SELECT (SELECT count(*) FROM product.plan_components WHERE quota ? 'member.max')
       + (SELECT count(*) FROM product.product_metrics WHERE metric_key = 'member.max')
       + (SELECT count(*) FROM product.metric_catalog  WHERE metric_key = 'member.max')
    INTO leftover;
  IF leftover > 0 THEN
    RAISE EXCEPTION '[retire-member-max] 仍有 % 处残留', leftover;
  END IF;

  /* 系统闸必须还在——退役的是套餐占位，不是那道闸。两者同名不同物，
     这条断言存在的理由就是防止把闸一起删了。 */
  IF NOT EXISTS (SELECT 1 FROM admin.settings
                  WHERE config_group = 'tenancy' AND config_key = 'tenant.member_limit') THEN
    RAISE EXCEPTION '[retire-member-max] 系统闸 tenancy/tenant.member_limit 不见了 —— 退役动错了对象';
  END IF;

  RAISE NOTICE '[retire-member-max] 残留 0；系统闸 tenancy/tenant.member_limit 完好';
END $$;
