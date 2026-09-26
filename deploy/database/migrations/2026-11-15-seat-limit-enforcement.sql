-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 席位上限硬拦（owner 裁定②「超限硬拦截，席位已满」）
--
-- 【为什么】
-- `seat.max` 自 2026-10-28 登记至今**全仓没有任何读者**：上限存在，没人拦。
-- 2026-11-14 建了占用表，本份给上限第一个读者，并把判据放进库里。
--
-- 【判据放库里而不是写路径】
-- 席位有两个写入方（console 客户自助指派、admin 运营代操作），挂在任何一条上都会
-- 给另一条留门——与同批 retire_pools_on_cancel / revoke_seats_on_cancel 同一个理由。
--
-- 【两个自定义错误码，应用层据此给文案】
--   VX409 = 席位已满（带上限数字）      → BFF 映射 409
--   VX404 = 该工作区没有在服务中的订阅覆盖这个产品 → BFF 映射 404
--
-- 【"在服务中"复用既有集合，不造第三个】
-- ('active','trialing','expiring','overdue')——「还在服务中，只是临近到期或欠费」。
-- 席位问的是谁被授权，不是此刻烧不烧得动配额；一张迟付的发票不该连带把团队的指派搞乱。
-- suspended 不在内（「已停止提供服务」）。
--
-- 【"他已经有席位了" 让唯一索引去报】
-- BEFORE 触发器跑在唯一索引之前。不放行同一人的重复授予，报出来的会是「席位已满」，
-- 把原因说错。放行之后由 uidx_product_seats_live 报 23505。
-- 这同时是 **2026-11-14 那份能继续重放**的前提：迁移全量重放，它跑的时候本触发器已存在。
--
-- 重复执行安全：CREATE OR REPLACE + DROP TRIGGER IF EXISTS。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION metering.resolve_seat_max(p_workspace_id uuid, p_product_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  -- NULL = 该工作区没有在服务中的订阅覆盖这个产品；-1 = 无限（沿用目录的哨兵约定）
  SELECT CASE
           WHEN count(*) = 0                        THEN NULL
           WHEN bool_or(coalesce(v, 0) = -1)        THEN -1
           ELSE max(coalesce(v, 0))
         END
    FROM (
      SELECT (pc.quota->>'seat.max')::int AS v
        FROM metering.subscriptions s
        JOIN product.plan_components pc ON pc.plan_version_id = s.plan_version_id
       WHERE s.workspace_id = p_workspace_id
         AND pc.product_id  = p_product_id
         AND s.deleted_at IS NULL
         AND s.status IN ('active','trialing','expiring','overdue')
    ) t;
$$;

CREATE OR REPLACE FUNCTION metering.enforce_seat_limit() RETURNS trigger AS $$
DECLARE
  v_max  int;
  v_live int;
BEGIN
  /* 撤销/已撤销的行不占席位，不必检查。 */
  IF NEW.revoked_at IS NOT NULL THEN RETURN NEW; END IF;
  /* UPDATE 且本来就是活的 ⇒ 占用数没变（其余列都是锚点，98 不授权改）。 */
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL THEN RETURN NEW; END IF;

  /* 同一人已持有活席位 ⇒ 让部分唯一索引去报，它的原因说得准。 */
  IF EXISTS (
    SELECT 1 FROM metering.product_seats
     WHERE workspace_id = NEW.workspace_id
       AND product_id   = NEW.product_id
       AND user_id      = NEW.user_id
       AND revoked_at IS NULL
       AND (TG_OP = 'INSERT' OR id <> NEW.id)
  ) THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.workspace_id::text || ':' || NEW.product_id::text, 0));

  v_max := metering.resolve_seat_max(NEW.workspace_id, NEW.product_id);
  IF v_max IS NULL THEN
    RAISE EXCEPTION 'no live subscription covers this product in this workspace'
      USING ERRCODE = 'VX404';
  END IF;
  IF v_max = -1 THEN RETURN NEW; END IF;   -- 无限

  SELECT count(*) INTO v_live
    FROM metering.product_seats
   WHERE workspace_id = NEW.workspace_id
     AND product_id   = NEW.product_id
     AND revoked_at IS NULL
     AND (TG_OP = 'INSERT' OR id <> NEW.id);
  IF v_live >= v_max THEN
    RAISE EXCEPTION 'product seats are full (limit %)', v_max USING ERRCODE = 'VX409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_seats_enforce_limit ON metering.product_seats;
CREATE TRIGGER trg_product_seats_enforce_limit
  BEFORE INSERT OR UPDATE OF revoked_at ON metering.product_seats
  FOR EACH ROW EXECUTE FUNCTION metering.enforce_seat_limit();

COMMIT;

-- ── 审计：证明它**真的拦得住**，并且拦的时候说对了原因 ─────────────────────────
-- 结构断言只能证明触发器挂上了。上限、并发口径、以及「说错原因」那一条，只有跑一遍才
-- 知道。下面把某个工作区的席位一路授到上限、再授一个，断言拿到的是 VX409；同时断言
-- 重复授予拿到的是 23505 而**不是** VX409。全部包在子事务里，末尾 VX001 主动回滚。
DO $$
DECLARE
  v_ws uuid; v_prod uuid; v_sub uuid; v_max int;
  v_users uuid[]; v_extra uuid; v_code text;
  probed boolean := false; has_trg boolean;
BEGIN
  -- 候选：一个「在服务中订阅 + 成员数 > seat.max」的工作区，才拦得出东西来。
  SELECT s.workspace_id, pc.product_id, s.id,
         metering.resolve_seat_max(s.workspace_id, pc.product_id)
    INTO v_ws, v_prod, v_sub, v_max
    FROM metering.subscriptions s
    JOIN product.plan_components pc ON pc.plan_version_id = s.plan_version_id
   WHERE s.deleted_at IS NULL
     AND s.status IN ('active','trialing','expiring','overdue')
     AND metering.resolve_seat_max(s.workspace_id, pc.product_id) > 0
     AND (SELECT count(*) FROM tenancy.workspace_memberships wm
           WHERE wm.workspace_id = s.workspace_id)
         > metering.resolve_seat_max(s.workspace_id, pc.product_id)
   LIMIT 1;

  IF v_ws IS NOT NULL THEN
    BEGIN
      SELECT array_agg(user_id) INTO v_users FROM (
        SELECT user_id FROM tenancy.workspace_memberships
         WHERE workspace_id = v_ws ORDER BY user_id LIMIT v_max
      ) t;
      SELECT user_id INTO v_extra FROM tenancy.workspace_memberships
       WHERE workspace_id = v_ws AND NOT (user_id = ANY(v_users))
       ORDER BY user_id LIMIT 1;

      -- 授到上限：每一个都该成功
      INSERT INTO metering.product_seats (workspace_id, user_id, product_id, subscription_id)
      SELECT v_ws, u, v_prod, v_sub FROM unnest(v_users) AS u;

      -- 再授一个 ⇒ VX409
      BEGIN
        INSERT INTO metering.product_seats (workspace_id, user_id, product_id, subscription_id)
        VALUES (v_ws, v_extra, v_prod, v_sub);
        v_code := 'none';
      EXCEPTION WHEN OTHERS THEN
        v_code := SQLSTATE;
      END;
      IF v_code <> 'VX409' THEN
        RAISE EXCEPTION '[seat-limit] 超出上限 % 的那一次授予拿到 %（应为 VX409）', v_max, v_code;
      END IF;

      -- 重复授予已持有者 ⇒ 23505，**不是** VX409（原因要说对）
      BEGIN
        INSERT INTO metering.product_seats (workspace_id, user_id, product_id, subscription_id)
        VALUES (v_ws, v_users[1], v_prod, v_sub);
        v_code := 'none';
      EXCEPTION WHEN OTHERS THEN
        v_code := SQLSTATE;
      END;
      IF v_code <> '23505' THEN
        RAISE EXCEPTION '[seat-limit] 重复授予拿到 %（应为 23505「他已经有席位了」，不是 VX409）', v_code;
      END IF;

      probed := true;
      RAISE EXCEPTION 'vx probe rollback' USING ERRCODE = 'VX001';
    EXCEPTION WHEN SQLSTATE 'VX001' THEN
      NULL;
    END;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'metering.product_seats'::regclass
       AND t.tgname = 'trg_product_seats_enforce_limit'
       AND NOT t.tgisinternal
  ) INTO has_trg;
  IF NOT has_trg THEN
    RAISE EXCEPTION '[seat-limit] 硬拦触发器不在';
  END IF;

  IF probed THEN
    RAISE NOTICE '[seat-limit] OK —— 上限 % 实测拦住了第 % 个（VX409），重复授予仍报 23505；探针已回滚', v_max, v_max + 1;
  ELSE
    RAISE NOTICE '[seat-limit] 触发器就位，但**没有实测拦截**——库里找不到「在服务中订阅 + 成员数 > seat.max」的工作区（本机/新库正常如此），只跑了结构断言';
  END IF;
END $$;
