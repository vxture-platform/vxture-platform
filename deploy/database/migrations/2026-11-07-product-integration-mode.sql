-- ─────────────────────────────────────────────────────────────────────────────
-- product.products.integration_mode —— 把「这个产品收不收平台下发」从推断改成声明
--
-- ## 补的是哪个盲区
--
-- admin 的接入态（「已接入 / 联调中 / 待配置 / 无需接入」）此前**靠「有没有
-- product_webhooks 行」去推**。而那是**沉默**，沉默同时兼容两件相反的事：
--
--   · 「还没配」          —— 该显示「待配置」，确实有事等人做
--   · 「按设计不需要」    —— 该显示「无需接入」，那是终态
--
-- 2026-09-24 一天之内两种猜法都上线过，各错一批产品：
--
--   · 原来全判 `not_required`（「无需接入」）：12 个只填了信息、什么都没建的智能体
--     被说成不需要接入。owner 当场指出「很多产品仅仅填写了信息，还没有开发和部署
--     任何内容，应该谈不上接入」。
--   · 于是改成全判 `config_required`（「待配置」）：反过来冤了 umbra —— 它只做账号
--     统一登录，其余全在它自己那边（owner：「只做账号统一登录，其他的都在 umbra
--     自己管理，不调用平台的任何内容」），**没有任何配置在等人做**，而界面在催一件
--     不存在的工作。
--
-- 一个笼统答案换另一个笼统答案。缺的不是更好的推断，是**一处声明**。
--
-- ## 为什么不拿 origin 当代理
--
-- 实测 umbra 是唯一 `origin='third_party'` 的产品，所以「按来源判」当天恰好只框中它。
-- 那是巧合：合作方产品照样可以收平台下发，自建产品也可以只用统一登录。接入方式是
-- **接入契约**的属性，不是**来源**的属性。用 origin 会在接第二个合作方产品那天错。
--
-- ## 回填
--
-- 默认 `platform_managed`（绝大多数产品如此），然后把 umbra 单独置为 `login_only`。
-- 这一句**按产品码点名**，是有意的：它不是一条规则，是一次**已知事实的登记**
-- （owner 2026-09-24 当面说明）。写成规则反而是编一个不存在的判据。此后新产品由
-- opera 的接入方式下拉声明，不再有人去猜。
--
-- migrate 是全量重放，所以每一步都 IF NOT EXISTS / 幂等；本机真库上跑过两遍。
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE product.products
  ADD COLUMN IF NOT EXISTS integration_mode varchar(24) NOT NULL DEFAULT 'platform_managed';

COMMENT ON COLUMN product.products.integration_mode IS
  '接入方式轴：platform_managed=收平台下发(开通/权益/用量回调)，没登记回调即「待配置」；login_only=只用统一登录，平台不下发任何东西，没有回调是终态而非缺配置。值域权威源在 @vxture-platform/shared 的 PRODUCT_INTEGRATION_MODES（lint:catalog-domains 锁它与本列 CHECK 一致）。';

ALTER TABLE product.products DROP CONSTRAINT IF EXISTS chk_products_integration_mode;
ALTER TABLE product.products
  ADD CONSTRAINT chk_products_integration_mode
  CHECK (integration_mode IN ('platform_managed', 'login_only'));

-- ── 回填：umbra 只做统一登录（owner 2026-09-24 当面说明的已知事实）────────────
DO $$
DECLARE
  n int;
BEGIN
  UPDATE product.products
     SET integration_mode = 'login_only', updated_at = now()
   WHERE product_code = 'umbra'
     AND integration_mode <> 'login_only';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE '[integration-mode] umbra → login_only（% 行）', n;
  ELSE
    -- 0 行有两种情形，都正常：已经是 login_only（重放），或这个库里没有 umbra（全新库）。
    RAISE NOTICE '[integration-mode] umbra 无需回填（已是 login_only 或本库无此产品）';
  END IF;
END $$;

-- ── 列级锁：存量库的 GRANT 靠迁移补，98 文件只在建库时跑 ──────────────────────
-- 漏了这一句的症状：生产上 platform_svc 写这一列时 42501，**整条 UPDATE 回滚**，
-- 而静态守卫只比源码清单故全绿（活库 GRANT 滞后于 98 文件，看不见——要直接问
-- information_schema）。DO 块包一层：本机开发库没有 platform_svc 这个角色。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    GRANT UPDATE (integration_mode) ON product.products TO platform_svc;
    RAISE NOTICE '[integration-mode] GRANT UPDATE(integration_mode) → platform_svc';
  ELSE
    RAISE NOTICE '[integration-mode] 本库没有 platform_svc 角色，跳过 GRANT（开发库）';
  END IF;
END $$;

COMMIT;

-- ── 事后断言（在事务外，失败即整条 migrate 红）────────────────────────────────
DO $$
DECLARE
  bad int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'product' AND table_name = 'products'
       AND column_name = 'integration_mode'
  ) THEN
    RAISE EXCEPTION '[integration-mode] 列没建出来';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'product.products'::regclass
       AND conname = 'chk_products_integration_mode'
  ) THEN
    RAISE EXCEPTION '[integration-mode] CHECK 约束不在';
  END IF;

  -- 值域之外的行：CHECK 装上之后不该存在；这一条是在证 CHECK 真的在管事，
  -- 而不是只证它「被建出来了」。
  SELECT count(*) INTO bad
    FROM product.products
   WHERE integration_mode NOT IN ('platform_managed', 'login_only');
  IF bad > 0 THEN
    RAISE EXCEPTION '[integration-mode] % 行的值在值域之外', bad;
  END IF;

  RAISE NOTICE '[integration-mode] OK —— 声明式接入方式已就位（默认 platform_managed）';
END $$;
