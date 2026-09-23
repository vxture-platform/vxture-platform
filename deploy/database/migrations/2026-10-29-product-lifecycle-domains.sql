-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-29-product-lifecycle-domains.sql
-- 批 1 · 数据与值域 —— 产品上架链路重构的地基（owner 2026-09-23 三条裁定）
--
-- 本迁移是**纯值域改动，不改变任何行为**。四件事：
--   ① product.products.status 加一档 `developing`
--   ② release_stage 从「成熟度」改写成「承诺等级」：三档改名 + 加一档 sunset
--   ③ tenancy.tenants 加 `purpose`（两值，只区分「有没有那条特权」）
--   ④ 退役上架检查项 verification_policy / pricing_set
--
-- 消费方（官网放开 developing、售卖态派生、可订性换判据、认证编排）都在后续批次。
-- 值域权威在 packages/core/utils 与 packages/shared，一动就触发全栈重建
-- （DOCKER_GLOBAL_RULES），所以所有值域改动挤在这一批一次做完，不分两次。
--
-- ── ① 为什么 `developing` 要进 status，而「待发售」不进 ─────────────────────
-- owner 2026-09-23：「草稿停留在 opera，需要一个状态——如『开发中』——才能到
-- admin/website」。
--   `draft`      = 刚登记、信息不全，**只在 opera 可见**；
--   `developing` = 有人决定「这个产品确认要做了，可以对外露面了」——**一个意图**，
--                  没有任何查询能算出这句话，只能有人说。意图进 status。
-- 对照：「待发售」是**一个事实**（有没有在售套餐），一句 SQL 就有答案，所以它是
-- 派生的售卖态，不落列。两者的分界线就在「算不算得出来」。
--
-- 顺带解掉一处撞名：`status='draft'` 此前对外显示成「开发中」，而 release_stage
-- 里另有一个 `developing` 也叫「开发中」。改完之后「开发中」只有一个意思。
--
-- ── ② 承诺等级：GA 是对的术语，但它答错了问题 ──────────────────────────────
-- GA = General Availability，标准的**工程发布**术语（alpha → beta → RC → GA → EOL）。
-- 它准确，但它回答的是「代码走到第几个里程碑」；客户在应用中心看徽标，想知道的是
-- 「我买了之后你承诺什么」。所以这根轴改写成**承诺等级**，用承诺说话：
--
--   preview 预览版  功能仍在快速演进，接口可能变更，不承诺 SLA
--   beta    公测版  功能成形，接口不再破坏性变更，SLA 尽力而为
--   stable  正式版  完整 SLA，任何变更有通知期
--   sunset  停售中  已购客户的服务与续订不受影响，不再接受新订阅   ← 新增
--
-- **缺的是尾巴不是头。** 头部不缺：产品还没开售时「敬请期待 / 即将开放」由售卖态
-- 回答，不需要承诺等级再说一遍。尾部是真缺：产品要退役时，「老客户继续用」和
-- 「新客户不能买」是两件事，今天只能一刀切停用、所有人一起断。
--
-- 码也改（ga → stable / developing → preview）而不是只改中文显示名：`ga` 是缩写，
-- 库里存着看不出含义；只改显示名会让库里存 `ga` 而屏幕上写别的，读库的人要自己
-- 在脑子里做一次映射——这类映射攒够三处就开始出错。
--
-- **本批不改可订性判据。** `preview` 的 subscribable 保持 false（与改名前的
-- `developing` 逐字等价），所以这一步对「谁能下单」零影响。判据换成「存在在售公开
-- 套餐」是批 4 的事；提前放开会在两批之间开一个窗口，让开发中的产品可被下单。
--
-- ── 全量重放的坑（本迁移最要紧的一段）────────────────────────────────────
-- `28d-apply-migrations.sh` **全量重放** migrations/ 下所有文件，按文件名排序。
-- 所以改名迁移必须同时管住**前序迁移里的字面量**：
--   `2026-09-01-product-release-stage-and-marketing.sql` 里
--     · 第 10 行 `ALTER COLUMN release_stage SET DEFAULT 'developing'` —— 无条件执行；
--     · 第 38 行起 INSERT 12 个产品，硬写 `'developing'`。
--   存量库上它们是 no-op（列已在、行已在，ON CONFLICT DO NOTHING），但**新库**走
--   「28 全量 DDL → 28d 迁移 → seed」，那时 DDL 的 CHECK 已经是新值域，前序迁移
--   插 `'developing'` 会当场违反 CHECK，整条 migrate 红。
-- 所以那份前序迁移里的两个字面量已同步改成 `'preview'`（改的是**将来重放的行为**，
-- 不是改历史：它对已应用过的库逐行 no-op）。本迁移末尾的断言会把这件事钉住。
--
-- ── ③ tenants.purpose：只区分「有没有那条特权」──────────────────────────
-- 两值，不是三值也不是四值：
--   customer      真实租户（含我们自有的测试租户、受邀客户）。无特权，计入全部口径。
--   certification 接入认证沙箱。有且只有一条特权：认证订阅可指向**未发布**版本。
--
-- 判据是「有没有特权 × 计不计入对外口径」的 2×2，其中「有特权 + 计入」那一格禁止
-- （一个能订未发布版本的租户如果还计进收入，那份收入是凭空的）。
-- 「自有测试」「受邀参与」都落在 customer 那一格：它们不改变任何行为或数字，前者是
-- 标签（库里查不出来），后者是 promotion.voucher_redemptions 已经记全的
-- (租户 × 产品) 关系——**查得出来的东西不占轴**。
--
-- 不挪用现成的列：`type`（personal/organization）是**主体形态**，一个认证租户仍然是
-- organization 形态，变的是它为什么存在；`status` 是生命周期；`tenant_no` 的类别位
-- 固定是 2，那是主体码的种类位。三者都不是用途。
--
-- DEFAULT 'customer' ⇒ 存量零迁移，且两条自助注册路径的 INSERT 不带这一列，客户
-- 天然造不出带特权的租户。
--
-- **本列有意不进 98 的 UPDATE 白名单**（末尾有断言）：没有任何人工场景需要改它，
-- 排除在 GRANT 之外就堵死了「手改一行把普通租户变成能订未发布版本的租户」。
-- 列级锁平时是个坑，这里正好是想要的东西。可变的是标签，不是这一列。
--
-- ── ④ 退役两个上架检查项 ──────────────────────────────────────────────────
-- `verification_policy` / `pricing_set` 都是 owner='admin'、is_required、gate='publish'。
-- 实查：opera 的检查单读写两个端点都写死 `WHERE i.owner = 'opera'`，admin-bff 对
-- `product_launch_statuses` **只有一条 SELECT**（发布门自己那一查）——**全仓没有任何
-- 人能勾上它们**，它们永远是 false。这就是「门变成墙」。
--
-- 处置是退役，不是补一个录入面。再看一层：`verification_policy` 的 baseline seed 建的
-- 是 `product_id IS NULL` 的**平台默认行**（personal / organization 各一条），任何产品
-- 都解析得到，所以「解析得出适用策略」这个判据**恒为真**——留着它只是放一个假装在
-- 把关的检查项。`pricing_set` 同理：有没有价格行是发布时一查就知道的事实，不是一个勾。
-- 补录入面是错的方向，那会让每接一个产品就多一项必填。
--
-- 发布时该现算的两件事（这一版有没有价格行、这个产品解析得出哪条认证策略）落在
-- 批 4 的发布门里，作为**现算判据**而不是检查项。
--
-- 删除顺序照 `2026-10-09-checklist-data-plane-retire.sql`：`product_launch_statuses`
-- 的 item_code 有 FK 指向字典表，先清存量状态行、再删字典行。
--
-- ── 没做的一件事 ───────────────────────────────────────────────────────────
-- 设计里那个 `tenancy.customer_tenants` 视图**本批不建**：它此刻零消费方，而仓里
-- 至今没有任何视图先例。零消费方的产物会被后来的人当成「已经在用」，且 `SELECT *`
-- 建的视图会把列表冻在建视图那一刻。等第一个读它的批次一起做。
--
-- 幂等：全部 IF NOT EXISTS / DROP-ADD / 点名 UPDATE / 无条件 DELETE，可重复执行。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① products.status 加一档 developing ────────────────────────────────────
ALTER TABLE product.products DROP CONSTRAINT IF EXISTS chk_products_status;
ALTER TABLE product.products
  ADD CONSTRAINT chk_products_status
  CHECK (status IN ('draft','developing','active','inactive','deprecated'));

COMMENT ON COLUMN product.products.status IS
  '接入状态：draft=草稿（只在 opera 可见）/ developing=开发中（admin 可录营销、官网可预告）/ active=已上线 / inactive=已停用 / deprecated=已退役（终态）。';

-- ── ② release_stage 改写成承诺等级 ─────────────────────────────────────────
-- 先松 CHECK 再回填再收紧：回填期间新旧值并存，所以中间不能有约束挡着。
ALTER TABLE product.products DROP CONSTRAINT IF EXISTS chk_products_release_stage;

UPDATE product.products SET release_stage = 'preview' WHERE release_stage = 'developing';
UPDATE product.products SET release_stage = 'stable'  WHERE release_stage = 'ga';

ALTER TABLE product.products ALTER COLUMN release_stage SET DEFAULT 'preview';

ALTER TABLE product.products
  ADD CONSTRAINT chk_products_release_stage
  CHECK (release_stage IN ('preview','beta','stable','sunset'));

COMMENT ON COLUMN product.products.release_stage IS
  '承诺等级：preview=预览版（仍在演进，不承诺 SLA）/ beta=公测版（接口不再破坏性变更）/ stable=正式版（完整 SLA，变更有通知期）/ sunset=停售中（已购客户照用照续，不接受新订阅）。纯展示标签，单向前进；不参与「能不能订阅」的判定。';

-- ── ③ tenancy.tenants.purpose ──────────────────────────────────────────────
ALTER TABLE tenancy.tenants
  ADD COLUMN IF NOT EXISTS purpose varchar(16) NOT NULL DEFAULT 'customer';

ALTER TABLE tenancy.tenants DROP CONSTRAINT IF EXISTS chk_tenants_purpose;
ALTER TABLE tenancy.tenants
  ADD CONSTRAINT chk_tenants_purpose CHECK (purpose IN ('customer','certification'));

CREATE INDEX IF NOT EXISTS idx_tenants_purpose ON tenancy.tenants (purpose);

COMMENT ON COLUMN tenancy.tenants.purpose IS
  '用途轴，只区分「有没有那条特权」：customer=真实租户（含自有测试租户、受邀客户），无特权、计入全部对外口径；certification=接入认证沙箱，唯一特权是认证订阅可指向未发布的套餐版本，不计入任何对外口径。有意不进 98 的 UPDATE 白名单——没有人工场景需要改它。';

-- ── ④ 退役 verification_policy / pricing_set ───────────────────────────────
-- 先清 FK 子行，再删字典行（两步都无条件执行；重放时 DELETE 影响 0 行照样成功）。
DELETE FROM product.product_launch_statuses
 WHERE item_code IN ('verification_policy','pricing_set');
DELETE FROM product.launch_checklist_items
 WHERE item_code IN ('verification_policy','pricing_set');

COMMIT;

-- ── 断言 ───────────────────────────────────────────────────────────────────
-- 一律「存在反例即抛」，不数全库总数：migrate 是全量重放，计数型断言会在一次与它
-- 无关的新增里突然炸掉（lint:migration-counts 守的就是这个）。
DO $$
DECLARE
  bad_stage    text;
  bad_status   int;
  n_item       int;
  n_status_row int;
  n_granted    int;
  col_default  text;
BEGIN
  -- ② 回填干净：不能有任何一行还留着旧码
  SELECT string_agg(DISTINCT release_stage, '、') INTO bad_stage
    FROM product.products
   WHERE release_stage NOT IN ('preview','beta','stable','sunset');
  IF bad_stage IS NOT NULL THEN
    RAISE EXCEPTION '[lifecycle-domains] release_stage 回填后仍有旧码：%', bad_stage;
  END IF;

  -- ② 列默认值必须是新码。这一条同时守住「全量重放」那个坑：前序迁移第 10 行
  -- 无条件 SET DEFAULT，它若还写着 'developing'，这里会在下一次 migrate 当场抓到。
  SELECT column_default INTO col_default
    FROM information_schema.columns
   WHERE table_schema='product' AND table_name='products' AND column_name='release_stage';
  IF col_default IS NULL OR col_default NOT LIKE '%preview%' THEN
    RAISE EXCEPTION
      '[lifecycle-domains] release_stage 的 DEFAULT 不是 preview（实为 %）——检查前序迁移里的字面量有没有跟着改',
      coalesce(col_default, 'NULL');
  END IF;

  -- ① 新状态值可写入（拿一行真表做反例验证，不只看 CHECK 的文本）
  SELECT count(*) INTO bad_status
    FROM pg_constraint
   WHERE conrelid = 'product.products'::regclass
     AND conname  = 'chk_products_status'
     AND pg_get_constraintdef(oid) LIKE '%developing%';
  IF bad_status <> 1 THEN
    RAISE EXCEPTION '[lifecycle-domains] chk_products_status 里没有 developing';
  END IF;

  -- ④ 退干净了（DELETE 影响 0 行也成功，只有回头数一次才分得清「本来没有」与「没删掉」）
  SELECT count(*) INTO n_item FROM product.launch_checklist_items
   WHERE item_code IN ('verification_policy','pricing_set');
  SELECT count(*) INTO n_status_row FROM product.product_launch_statuses
   WHERE item_code IN ('verification_policy','pricing_set');
  IF n_item <> 0 OR n_status_row <> 0 THEN
    RAISE EXCEPTION '[lifecycle-domains] 检查项没退干净：字典行 %，存量状态行 %', n_item, n_status_row;
  END IF;

  -- ③ purpose **不该**被授予 UPDATE。98_column_locks.sql 在迁移之后重放，所以它的
  -- 上一轮结果在这里看得见——将来谁把 purpose 加进 98 的 GRANT，下一次 migrate 就红。
  -- 没有 platform_svc 的环境（本机部分库）不计。
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='platform_svc') THEN 0
              ELSE (SELECT count(*) FROM information_schema.column_privileges
                     WHERE grantee='platform_svc' AND table_schema='tenancy'
                       AND table_name='tenants' AND privilege_type='UPDATE'
                       AND column_name='purpose') END
    INTO n_granted;
  IF n_granted <> 0 THEN
    RAISE EXCEPTION
      '[lifecycle-domains] tenancy.tenants.purpose 被授予了 UPDATE —— 它有意不进 98 白名单，请把它从 GRANT 里移除';
  END IF;

  RAISE NOTICE '[lifecycle-domains] status 加 developing ✓；release_stage 已是承诺等级四档、DEFAULT=preview ✓；tenants.purpose 就位且未授 UPDATE ✓；两个检查项已退役 ✓';
END $$;
