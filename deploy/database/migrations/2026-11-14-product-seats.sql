-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 产品席位占用表 metering.product_seats
--
-- 【为什么】
-- owner 2026-09-27 四条裁定之①：「要明细表，每个产品清楚谁在当前使用」。
-- 席位的**上限**早就有地方存（`seat.max`，2026-10-28 给六个可订阅产品登记 + 全部套餐
-- 组件默认 1），**占用**却全库无处可查：`usage_events.end_user_id` 回答的是「谁用过」
-- （事后日志），不是「谁被授权」。没有占用数，`seat.max` 就只能是个显示值——事实上
-- 它至今没有任何读者。
--
-- 【本迁移不改变任何行为】
-- 只建表。没有任何代码写它、读它（授予/回收端点与硬拦是下一步）。表建出来是空的，
-- 生产上不会有一行——这是有意的顺序：先有权威（占用数存在哪），再有执行点。
--
-- 【三条不变式都放进库里，不靠应用层记得】
-- ① 占席位的人必须是该工作区成员，且**人走席位自动释放**
--    → 复合外键 (workspace_id, user_id) → tenancy.workspace_memberships，ON DELETE CASCADE。
--    移出工作区/移出租户两处都是硬 DELETE（pg-organization.repository 的 removeOrgMember
--    与 removeWorkspaceMember），所以级联真的会触发。
--    「人走了席位不会自己消失」是席位模型最容易漏的一条，后果是席位被幽灵占满、新人加不进来。
-- ② 同一人在同一产品上不能重复占位，但撤销后可以再次授予
--    → 部分唯一索引 uidx_product_seats_live ... WHERE revoked_at IS NULL。
-- ③ 退订即释放
--    → 触发器 trg_subscriptions_revoke_seats_on_cancel（与 2026-11-13 退役配额池同一条
--    不变式的另一半；同样只认 cancelled，不动 expired / suspended——那两种订阅还会回来）。
--
-- 【软撤销与级联硬删的取舍（已知缺口，不是疏漏）】
-- revoked_at 是软撤销，为的是「查得出谁占过」；但 ① 的级联是硬删，成员被移出时那些行
-- 连痕迹一起消失。两者冲突时选 ①：占用数正确比留痕重要，而「谁用过」仍可查 usage_events。
--
-- 【权限】
-- 28d 在迁移之后重放 98_column_locks.sql（列级锁会自动跟上），但**不重放 97_service_roles.sql**。
-- 新表的表级 SELECT/INSERT/DELETE 靠 97 的 ALTER DEFAULT PRIVILEGES —— 那条只对
-- 「执行它的那个角色所创建的对象」生效。这个前提不该靠猜，所以本迁移**显式补授**，
-- 角色清单不手写：照 metering.subscriptions 现有的授权面反推（谁能读订阅就能读席位，
-- 谁能写订阅就能写席位），并在审计段断言两个集合一致。
--
-- 重复执行安全：IF NOT EXISTS / duplicate_object 吞掉 / CREATE OR REPLACE。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS metering.product_seats (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid         NOT NULL,
    user_id         uuid         NOT NULL,
    product_id      uuid         NOT NULL,
    subscription_id uuid         NOT NULL REFERENCES metering.subscriptions(id),
    granted_by      uuid,
    granted_at      timestamptz  NOT NULL DEFAULT now(),
    revoked_at      timestamptz,
    revoked_by      uuid,
    CONSTRAINT chk_product_seats_revoked_by CHECK (revoked_at IS NOT NULL OR revoked_by IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_product_seats_live
  ON metering.product_seats (workspace_id, product_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_seats_member       ON metering.product_seats (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_product_seats_subscription ON metering.product_seats (subscription_id);
CREATE INDEX IF NOT EXISTS idx_product_seats_product      ON metering.product_seats (product_id);

-- ── 跨 schema 外键（对应 ddl/90_cross_schema_fk.sql）──────────────────────────
DO $$ BEGIN
  ALTER TABLE metering.product_seats ADD CONSTRAINT fk_product_seats_ws_member
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES tenancy.workspace_memberships (workspace_id, user_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.product_seats ADD CONSTRAINT fk_product_seats_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 退订即释放（对应 ddl/95_triggers.sql）────────────────────────────────────
CREATE OR REPLACE FUNCTION metering.revoke_seats_on_cancel() RETURNS trigger AS $$
BEGIN
  UPDATE metering.product_seats
     SET revoked_at = now()
   WHERE subscription_id = NEW.id AND revoked_at IS NULL;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subscriptions_revoke_seats_on_cancel ON metering.subscriptions;
CREATE TRIGGER trg_subscriptions_revoke_seats_on_cancel
  AFTER UPDATE OF status ON metering.subscriptions
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION metering.revoke_seats_on_cancel();

-- ── 表级授权：照订阅表的授权面逐项反推，不手写角色清单 ───────────────────────
-- 为什么**逐个权限**分别照抄，而不是「谁能读就给读写」：`platform_svc` 的 UPDATE 面由
-- 98_column_locks.sql 管（表级 REVOKE + 按列 GRANT），所以它在 subscriptions 上**没有**
-- 表级 UPDATE；逐项照抄自动把它排除在外。初版写成「有 INSERT 就给 INSERT,UPDATE,DELETE」，
-- 于是给 platform_svc 补回了表级 UPDATE ——把 98 刚锁上的九列全部打开，而且没有任何报错。
-- 在生产的 28d 里 98 随后重放会把它盖回去，但「靠后面那一步来纠正前面这一步」不是不变式，
-- 只是运气：换个执行顺序（全量 DDL 之后单跑本迁移）锁就是开的。本机新库上实测到的正是这一幕。
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'metering' AND table_name = 'subscriptions'
       AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
       AND grantee <> current_user AND grantee <> 'PUBLIC'
  LOOP
    EXECUTE format('GRANT %s ON metering.product_seats TO %I', r.privilege_type, r.grantee);
  END LOOP;
END $$;
COMMIT;

-- ── 审计：证明三条不变式**拦得住/放得过**，而不只是「建出来了」 ───────────────
-- 结构断言（外键在不在、confdeltype 是不是 'c'）只能证明形状对。级联、部分唯一、
-- 触发器这三件事的正确性只有跑一遍才知道，所以下面真的插行、真的删成员、真的把一条
-- 订阅改成 cancelled——全部包在一个子事务里，末尾用自定义错误码 VX001 主动抛出，
-- 让子事务整体回滚。用专属错误码而不是随便一个 RAISE：断言自己失败时抛的是 P0001，
-- **不会**被这个处理器吞掉，会照常让迁移红。
DO $$
DECLARE
  v_ws uuid; v_user uuid; v_sub uuid; v_prod uuid;
  v_seat uuid; v_left int; v_revoked timestamptz;
  dup_blocked boolean;
  probed boolean := false;
  fk_del char(1); fk_ref text;
  has_trg boolean;
  n_missing int;
BEGIN
  -- 候选：一条在用订阅 + 同工作区的一名成员。找不到就不实测（并且明说没测）。
  SELECT s.workspace_id, wm.user_id, s.id, s.product_id
    INTO v_ws, v_user, v_sub, v_prod
    FROM metering.subscriptions s
    JOIN tenancy.workspace_memberships wm ON wm.workspace_id = s.workspace_id
   WHERE s.deleted_at IS NULL
     AND s.product_id IS NOT NULL
     AND s.status IN ('active','trialing','expiring','overdue')
   LIMIT 1;

  IF v_ws IS NOT NULL THEN
    BEGIN
      INSERT INTO metering.product_seats (workspace_id, user_id, product_id, subscription_id)
      VALUES (v_ws, v_user, v_prod, v_sub)
      RETURNING id INTO v_seat;

      -- ② 同一人同一产品不能重复占位
      BEGIN
        INSERT INTO metering.product_seats (workspace_id, user_id, product_id, subscription_id)
        VALUES (v_ws, v_user, v_prod, v_sub);
        dup_blocked := false;
      EXCEPTION WHEN unique_violation THEN
        dup_blocked := true;
      END;
      IF NOT dup_blocked THEN
        RAISE EXCEPTION '[product-seats] 同一人在同一产品上竟能占两个席位——占用数从此不可信';
      END IF;

      -- ③ 退订即释放（触发器）
      UPDATE metering.subscriptions SET status = 'cancelled' WHERE id = v_sub;
      SELECT revoked_at INTO v_revoked FROM metering.product_seats WHERE id = v_seat;
      IF v_revoked IS NULL THEN
        RAISE EXCEPTION '[product-seats] 订阅已 cancelled，席位却还占着——触发器没生效';
      END IF;

      -- ② 的另一半：撤销之后同一人可以再次被授予（部分唯一索引，不是全表唯一）
      INSERT INTO metering.product_seats (workspace_id, user_id, product_id, subscription_id)
      VALUES (v_ws, v_user, v_prod, v_sub);

      -- ① 人走席位自动释放（复合外键 CASCADE）
      DELETE FROM tenancy.workspace_memberships WHERE workspace_id = v_ws AND user_id = v_user;
      SELECT count(*) INTO v_left FROM metering.product_seats
       WHERE workspace_id = v_ws AND user_id = v_user;
      IF v_left <> 0 THEN
        RAISE EXCEPTION '[product-seats] 成员已移出工作区，席位还剩 % 行——级联没生效，「人走席位留」', v_left;
      END IF;

      probed := true;
      RAISE EXCEPTION 'vx probe rollback' USING ERRCODE = 'VX001';
    EXCEPTION WHEN SQLSTATE 'VX001' THEN
      NULL;   -- 探针做的一切在此整体回滚
    END;
  END IF;

  -- 结构断言（无论实测有没有跑成都要过）
  SELECT c.confdeltype, cr.relname INTO fk_del, fk_ref
    FROM pg_constraint c JOIN pg_class cr ON cr.oid = c.confrelid
   WHERE c.conrelid = 'metering.product_seats'::regclass
     AND c.conname = 'fk_product_seats_ws_member';
  IF fk_del IS NULL THEN
    RAISE EXCEPTION '[product-seats] 指向成员表的复合外键不在';
  END IF;
  IF fk_del <> 'c' OR fk_ref <> 'workspace_memberships' THEN
    RAISE EXCEPTION '[product-seats] 外键指向 % / ON DELETE=%（应为 workspace_memberships / c）', fk_ref, fk_del;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'metering.subscriptions'::regclass
       AND t.tgname = 'trg_subscriptions_revoke_seats_on_cancel'
       AND NOT t.tgisinternal
  ) INTO has_trg;
  IF NOT has_trg THEN
    RAISE EXCEPTION '[product-seats] 退订释放席位的触发器不在';
  END IF;

  -- 授权面两条，都是**行为**断言：
  -- ① 能碰订阅的角色都要能碰席位表（97 不随迁移重放，见头注）——漏了就是运行时 42501。
  SELECT count(*) INTO n_missing FROM (
    SELECT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema='metering' AND table_name='subscriptions'
       AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
    EXCEPT
    SELECT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema='metering' AND table_name='product_seats'
       AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
  ) d;
  IF n_missing <> 0 THEN
    RAISE EXCEPTION '[product-seats] 有 % 个（角色, 权限）能碰订阅却碰不到席位表', n_missing;
  END IF;

  -- ② platform_svc 不得有**表级** UPDATE：它的可写列由 98_column_locks.sql 逐列授（只有
  --    revoked_at / revoked_by）。表级 UPDATE 一旦存在，那道列锁就整片失效——**而且没有报错**。
  --    这条不是假设出来的：本迁移初版的授权循环写成「有 INSERT 就给 INSERT,UPDATE,DELETE」，
  --    在本机新库上实测正是这个结果（九列全部可写）。写成断言，下一个人照抄时会被拦。
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='platform_svc')
     AND has_table_privilege('platform_svc','metering.product_seats','UPDATE') THEN
    RAISE EXCEPTION '[product-seats] platform_svc 拿到了表级 UPDATE —— 98 的列锁（只应放开 revoked_at/revoked_by）被整片打开';
  END IF;

  IF probed THEN
    RAISE NOTICE '[product-seats] OK —— 三条不变式实测通过（重复占位被拦、退订即释放、人走席位随之消失），探针已回滚';
  ELSE
    RAISE NOTICE '[product-seats] 表与约束就位；**级联/部分唯一/触发器没有实测**——库里找不到「在用订阅 + 同工作区成员」的候选（空库或纯目录库正常如此），只跑了结构断言';
  END IF;
END $$;
