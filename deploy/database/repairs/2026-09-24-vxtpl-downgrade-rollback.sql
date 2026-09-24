-- deploy/database/repairs/2026-09-24-vxtpl-downgrade-rollback.sql
--
-- 一次性数据修复：把 vxtpl 的服务恢复到 Starter 订单买的那个样子，并**彻底删除**那张
-- 不该存在的 Free 订单。
--
-- **这不是迁移，不要放进 deploy/database/migrations/。** 迁移是全量重放的，而这是针对
-- 一个租户两张具体订单的修复；放进迁移目录会让它每次部署重跑，也会在新库上找不到那两个
-- 订单号而变成永久噪声。由 owner 手工执行一次。
--
-- ## 事故
--
-- 2026-09-24 10:44 一张 0 元 Free 单被当作「升级」，就地把付费 Starter 订阅改写成 Free、
-- 周期重置；同日下午 owner 退订，那条订阅变成 cancelled、订阅列表里彻底消失。
--
--   ORD-202609-31DDD533C6  Starter  ¥0.01  09-02 09:34  已收款  ← 真实付费，订单本身没错
--   ORD-202609-63E0E32517  Free     ¥0.00  09-24 10:44  已结清  ← 不该存在
--
-- 根因（客户端与服务端都不判换档方向）与代码修复见 PR #486。
--
-- ## 修复思路（owner 2026-09-24 定）
--
-- **从服务的视角修，不重新买一次。** Starter 那张订单从来没错过，错的是它那条服务被顶掉
-- 了。所以：把服务改回「服务中」，周期与关联订单都回到 Starter 单买的那个样子；那张 Free
-- 订单彻底删除，因为它不应该出现和存在。
--
-- 曾经考虑过两个替代方案，都被否掉，理由记在这里免得后人重走：
--
--   · 把 Free 单标成 refunded 而不是删除 —— 客户在费用中心会看到一笔「已退款」，那是在
--     陈述一件没发生过的商业事实（没有人退过款）。它是 bug 造出来的幻影行。
--   · 重新下一张 Starter 单、走正常履约 —— 周期会从今天重新起算，且账面凭空多一张单。
--     订单还在，该修的是服务。
--
-- ## 一个曾经的顾虑，实测不成立
--
-- 误升级当时会按 Free 重发配额池（quota_pools.period_anchor = 订阅 start_at），所以
-- 「只改订阅行会得到写着 Starter 却拿 Free 额度的订阅」。**实测 vxtpl 一条配额池都没有**
-- （2026-09-24 生产配额页：存储与 AI Credits 的来源只有 arda，各产品明细 4 条全是 arda）。
-- 所以这一项在本产品上不存在。**换别的产品重用本脚本前必须重新量一次这件事。**
--
-- ## 先看，再改
--
-- 先只跑「DRY RUN」那一段，把输出贴给写这份脚本的人核对；确认无误再跑事务段。
-- 执行一律带 ON_ERROR_STOP：psql -v ON_ERROR_STOP=1 -f 本文件
--
-- ## 这份脚本不做的一件事
--
-- **下游权益没有同步。** 误升级当时触发过 provisioning（版本变更 → 通知产品侧），下游按
-- Free 授权。改库不会重发那个 webhook。本仓没有「重放 provisioning」的现成入口
-- （admin 订单页的「重试开通」对已 fulfilled 的单是幂等空操作）。vxtpl 侧要按 Starter
-- 重新授权一次，这一步要另外处理。

\set ON_ERROR_STOP on

-- ────────────────────────────── DRY RUN ──────────────────────────────

\echo '--- 1/4 服务现状（应当看到 cancelled + Free 那一版 + 被重置的周期）---'
select s.id as subscription_id, s.status,
       pc.tier as now_tier, s.start_at, s.end_at,
       o.order_no as current_order
  from metering.subscriptions s
  left join product.plan_components pc
    on pc.plan_version_id = s.plan_version_id and pc.component_role = 'primary'
  left join billing.orders o on o.id = s.current_order_id
 where s.id = (select subscription_id from billing.orders
                where order_no = 'ORD-202609-63E0E32517');

\echo '--- 2/4 应当恢复成什么（取自 Starter 那张单）---'
select o.order_no, o.status, pc.tier as target_tier,
       i.cycle_start_date, i.cycle_end_date
  from billing.orders o
  join product.plan_components pc
    on pc.plan_version_id = o.plan_version_id and pc.component_role = 'primary'
  left join billing.invoices i on i.order_id = o.id
 where o.order_no = 'ORD-202609-31DDD533C6';

\echo '--- 3/4 要删的那张单，以及挂在它下面的行 ---'
select o.order_no, o.status,
       (select count(*) from billing.order_events e where e.order_id = o.id) as events,
       (select count(*) from billing.invoices i    where i.order_id = o.id) as invoices,
       (select count(*) from billing.refunds r
          join billing.invoices i2 on i2.id = r.bill_id where i2.order_id = o.id) as refunds,
       (select count(*) from billing.payments p
          join billing.invoices i3 on i3.id = p.bill_id where i3.order_id = o.id) as payments
  from billing.orders o
 where o.order_no = 'ORD-202609-63E0E32517';

\echo '--- 4/4 这张单有没有被别的订阅引用（应当只有那一条）---'
select s.id, s.status from metering.subscriptions s
 where s.current_order_id = (select id from billing.orders
                              where order_no = 'ORD-202609-63E0E32517');

-- ────────────────────────────── 修复 ──────────────────────────────
-- 上面四段核对无误后再跑。整段一个事务，任何一条断言不成立就整体回滚。

begin;

-- 前置断言：两张单各恰好一条，且指向同一条订阅。数量不对就不是这个现场，立刻停——
-- 盲改金融数据比不改坏得多。
do $$
declare bad_sub uuid; good_sub uuid; n int;
begin
  select count(*) into n from billing.orders
   where order_no in ('ORD-202609-63E0E32517','ORD-202609-31DDD533C6');
  if n <> 2 then
    raise exception '期望恰好 2 张点名订单，实际 %，现场与脚本不符，中止', n;
  end if;

  select subscription_id into bad_sub  from billing.orders where order_no = 'ORD-202609-63E0E32517';
  select subscription_id into good_sub from billing.orders where order_no = 'ORD-202609-31DDD533C6';
  if bad_sub is null or bad_sub <> good_sub then
    raise exception '两张单指向的订阅不是同一条（% / %），中止', bad_sub, good_sub;
  end if;
end $$;

-- 1) 服务恢复：状态回 active、套餐回 Starter **那一版**（不是「现在在售的 starter 版」
--    ——那会顺手把人迁到新版本上去）、周期与代表订单都回 Starter 单。
update metering.subscriptions s
   set status           = 'active',
       plan_version_id  = g.plan_version_id,
       start_at         = coalesce(gi.cycle_start_date::timestamptz, s.start_at),
       end_at           = coalesce(gi.cycle_end_date::timestamptz,   s.end_at),
       current_order_id = g.id,
       updated_at       = now()
  from billing.orders g
  left join billing.invoices gi on gi.order_id = g.id
 where g.order_no = 'ORD-202609-31DDD533C6'
   and s.id = g.subscription_id
   -- 幂等：三项都已到位就不动（重跑零改动）
   and (s.plan_version_id <> g.plan_version_id
        or s.status <> 'active'
        or s.current_order_id is distinct from g.id);

-- 2) 留痕：删掉的那张单不会留下任何记录，所以把这次修复记在 **Starter 单**的事件流上
--    ——事情确实发生在它那条服务上。放在删除之前，因为下面还要用到那张单的 id。
insert into billing.order_events
  (order_id, event_type, from_status, to_status, actor_type, actor_id, remark)
select g.id, 'service_restored', null, null, 'operator', null,
       '人工修复：0 元 Free 单 ORD-202609-63E0E32517 被误判为升级，'
       '就地把本单的 Starter 服务改写成 Free 并重置周期；owner 随后退订，服务消失。'
       '本次已将服务恢复为 active + Starter 原版本 + 原账期，并彻底删除那张 Free 单。'
       '代码侧方向判定见 PR #486（NOT_AN_UPGRADE）。'
  from billing.orders g
 where g.order_no = 'ORD-202609-31DDD533C6'
   and not exists (select 1 from billing.order_events e
                    where e.order_id = g.id and e.event_type = 'service_restored');

-- 3) 彻底删除那张 Free 单。**按外键顺序**：subscriptions.current_order_id 是跨 schema
--    真 FK（90_cross_schema_fk.sql），order_events 是 ON DELETE RESTRICT，所以引用必须
--    先断开、子行必须先删，否则删不动。
--
--    注意：schema 的原意是「金融行不删，作废走 status」（52_billing.sql 头注：无
--    deleted_at）。这里删除是 owner 明确的裁定——那张单是 bug 造出来的幻影，不是一笔
--    真实交易；把它标成 refunded 等于宣称发生过一次退款。这条偏离记在这里。
do $$
declare bad_id uuid;
begin
  select id into bad_id from billing.orders where order_no = 'ORD-202609-63E0E32517';
  if bad_id is null then
    raise notice '那张 Free 单已不存在（本脚本此前跑过），跳过删除。';
    return;
  end if;

  -- 还被订阅引用就不能删：上一步应当已经把 current_order_id 指回 Starter 单。
  if exists (select 1 from metering.subscriptions where current_order_id = bad_id) then
    raise exception '仍有订阅的 current_order_id 指向这张单，第 1 步没生效，中止';
  end if;

  delete from billing.payments p using billing.invoices i
   where p.bill_id = i.id and i.order_id = bad_id;
  delete from billing.refunds r using billing.invoices i
   where r.bill_id = i.id and i.order_id = bad_id;
  delete from billing.order_events where order_id = bad_id;
  delete from billing.invoices     where order_id = bad_id;
  delete from billing.orders       where id = bad_id;
end $$;

-- ────────────────────────────── 复原后自检 ──────────────────────────────
do $$
declare t text; st text; n int;
begin
  select pc.tier, s.status into t, st
    from metering.subscriptions s
    join billing.orders g on g.order_no = 'ORD-202609-31DDD533C6' and g.subscription_id = s.id
    join product.plan_components pc
      on pc.plan_version_id = s.plan_version_id and pc.component_role = 'primary';
  if t is distinct from 'starter' then raise exception '复原后档位是 %，回滚', t; end if;
  if st <> 'active' then raise exception '复原后服务状态是 %，回滚', st; end if;

  select count(*) into n from billing.orders where order_no = 'ORD-202609-63E0E32517';
  if n <> 0 then raise exception '那张 Free 单还在（% 条），回滚', n; end if;

  -- 库级不变式：一个 workspace × product 至多一条在用订阅
  -- （uidx_subscriptions_live_per_product）。复原之后它必须仍然成立，否则我们刚制造了
  -- 它本来要防的东西。
  select count(*) into n
    from metering.subscriptions s
    join product.plan_components pc
      on pc.plan_version_id = s.plan_version_id and pc.component_role = 'primary'
    join product.products p on p.id = pc.product_id and p.product_code = 'vxtpl'
   where s.workspace_id = (select workspace_id from billing.orders
                            where order_no = 'ORD-202609-31DDD533C6')
     and s.status in ('active','trialing','expiring','overdue')
     and s.deleted_at is null;
  if n <> 1 then raise exception 'vxtpl 在用订阅数是 %，应当恰好 1，回滚', n; end if;
end $$;

commit;

\echo '修复完成。仍需：让 vxtpl 侧按 Starter 重新授权一次（见文件头最后一节）。'
