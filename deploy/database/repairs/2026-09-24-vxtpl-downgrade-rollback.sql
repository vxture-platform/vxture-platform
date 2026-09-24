-- deploy/database/repairs/2026-09-24-vxtpl-downgrade-rollback.sql
--
-- 一次性数据修复：把 vxtpl 那条订阅从被误降的 Free 复原回 Starter。
--
-- **这不是迁移，不要放进 deploy/database/migrations/。** 迁移是全量重放的，而这是针对
-- 一个租户两张具体订单的修复；放进迁移目录会让它在每次部署时重跑，也会在新库上找不到
-- 那两个订单号而变成永久噪声。由 owner 手工执行一次。
--
-- ## 事故
--
-- 2026-09-24 10:44，一张 0 元 Free 单被当作「升级」，就地把付费 Starter 订阅改写成 Free：
--
--   ORD-202609-31DDD533C6  Starter  ¥0.01  2026-09-02 09:34  已收款   ← 真实付费订阅
--   ORD-202609-63E0E32517  Free     ¥0.00  2026-09-24 10:44  已结清   ← 误单，把上面那条顶掉
--
-- 同日下午 owner 又在 console 退订了那条（已成 Free 的）订阅，于是它现在是 cancelled、
-- 订阅列表里彻底消失。**所以本脚本要做的是「复活 + 回档 + 回周期」三件事，不只是回档。**
--
-- 根因与代码修复见同批 PR：客户端把「在用 + 别的档」一律算 upgrade（不看方向），服务端
-- upgrade 分支也只判「原订阅在用 + 目标套餐不同」，从不比较档位高低。
--
-- ## 先看，再改
--
-- 先只跑「DRY RUN」那一段，把三行输出贴给写这份脚本的人核对；确认无误再跑事务段。
-- 执行一律带 ON_ERROR_STOP：psql -v ON_ERROR_STOP=1 -f 本文件
--
-- ## 这份脚本不做的两件事（需要另外处理）
--
-- 1. **下游权益没有同步。** 误升级当时触发了 provisioning（版本变更 → 通知产品侧），
--    下游按 Free 授权。改库不会重发那个 webhook，所以修完必须让 vxtpl 侧重新按 Starter
--    授权一次。本仓没有找到「重放 provisioning」的现成入口（admin/opera 里都没有），
--    所以这一步要么手工调一次 provisioning，要么在 admin 对该订阅做一次 suspend→resume
--    看能否触发（**未验证，别在生产上试探**）。
-- 2. **周期按原账期复原，等于只剩 8 天。** Starter 那张单的账期是 2026-09-02 ~
--    2026-10-02，而今天已是 09-24。原样复原是「回到没出事的样子」，但出事的这 22 天里
--    客户拿到的是 Free 权益（后半段连订阅都没了）。要补就把 end_at 往后推相应天数：
--
--      update metering.subscriptions set end_at = end_at + interval '22 days' where id = ...;
--
--    **不在本脚本里替 owner 做这个决定**——补多少天是商务判断，不是数据修复。

\set ON_ERROR_STOP on

-- ────────────────────────────── DRY RUN ──────────────────────────────
-- 跑这一段不改任何数据。三行输出：现状、目标、以及那张误单。

\echo '--- 1/3 当前订阅现状 ---'
select s.id                as subscription_id,
       s.status,
       s.plan_version_id   as now_plan_version,
       pc.tier             as now_tier,
       s.start_at, s.end_at,
       s.current_order_id
  from metering.subscriptions s
  left join product.plan_components pc
    on pc.plan_version_id = s.plan_version_id
   and pc.component_role = 'primary'
 where s.id = (select subscription_id from billing.orders
                where order_no = 'ORD-202609-63E0E32517');

\echo '--- 2/3 应当复原到的目标（取自 Starter 那张单）---'
select o.id                as starter_order_id,
       o.plan_version_id   as target_plan_version,
       pc.tier             as target_tier,
       i.cycle_start_date, i.cycle_end_date
  from billing.orders o
  join product.plan_components pc
    on pc.plan_version_id = o.plan_version_id
   and pc.component_role = 'primary'
  left join billing.invoices i on i.order_id = o.id
 where o.order_no = 'ORD-202609-31DDD533C6';

\echo '--- 3/3 误单与它的账单 ---'
select o.order_no, o.status, o.intent, o.payable_amount,
       o.from_subscription_id, o.subscription_id,
       i.bill_no, i.bill_status
  from billing.orders o
  left join billing.invoices i on i.order_id = o.id
 where o.order_no = 'ORD-202609-63E0E32517';

-- ────────────────────────────── 修复 ──────────────────────────────
-- 上面三行核对无误后再跑下面。整段一个事务，任何一条断言不成立就整体回滚。

begin;

-- 两张单都必须**恰好一条**，且属于同一条订阅、同一个工作区。数量不对就不是这个现场，
-- 立刻停——盲改金融数据比不改坏得多。
do $$
declare
  bad_id      uuid;
  good_id     uuid;
  sub_id      uuid;
  good_sub_id uuid;
  n           int;
begin
  select count(*) into n from billing.orders where order_no in
    ('ORD-202609-63E0E32517','ORD-202609-31DDD533C6');
  if n <> 2 then
    raise exception '期望恰好 2 张点名订单，实际 %，现场与脚本不符，中止', n;
  end if;

  select id, subscription_id into bad_id, sub_id
    from billing.orders where order_no = 'ORD-202609-63E0E32517';
  select id, subscription_id into good_id, good_sub_id
    from billing.orders where order_no = 'ORD-202609-31DDD533C6';

  if sub_id is null or sub_id <> good_sub_id then
    raise exception '两张单指向的订阅不是同一条（误单 %, Starter 单 %），中止',
      sub_id, good_sub_id;
  end if;
end $$;

-- 1) 订阅复原：**复活 + 回档 + 回周期**。
--
--    2026-09-24 下午 owner 在 console 对那条（已被误改成 Free 的）订阅做了退订，于是它
--    现在是 cancelled、订阅列表里彻底看不到了。所以这一步不只是改档，还要把状态改回
--    active——本脚本第一版写的时候订阅还在，只是档位错了；现场变了，脚本跟着变。
--
--    套餐版本回 Starter **那一版**（不是「现在在售的 starter 版」——那会顺手把人迁到
--    新版本上去）；周期回 Starter 单的账期；代表订单回 Starter 单。
update metering.subscriptions s
   set plan_version_id  = g.plan_version_id,
       status           = 'active',
       start_at         = coalesce(gi.cycle_start_date::timestamptz, s.start_at),
       end_at           = coalesce(gi.cycle_end_date::timestamptz,   s.end_at),
       current_order_id = g.id,
       updated_at       = now()
  from billing.orders g
  left join billing.invoices gi on gi.order_id = g.id
 where g.order_no = 'ORD-202609-31DDD533C6'
   and s.id = g.subscription_id
   -- 幂等：档位与状态都已到位就不再动（重跑本脚本零改动）
   and (s.plan_version_id <> g.plan_version_id or s.status <> 'active');

-- 2) 误单作废。状态机（52_billing.sql 头注）只允许 fulfilled → refunded；
--    cancelled 仅限未付，所以这里必须是 refunded（退 ¥0）。
update billing.orders
   set status = 'refunded', updated_at = now()
 where order_no = 'ORD-202609-63E0E32517'
   and status = 'fulfilled';

-- 3) 误单的账单跟着作废，否则账单侧还挂着一笔「已结清」的 Free 订阅费。
update billing.invoices i
   set bill_status = 'cancelled', updated_at = now()
  from billing.orders o
 where o.order_no = 'ORD-202609-63E0E32517'
   and i.order_id = o.id
   and i.bill_status <> 'cancelled';

-- 4) 留痕。人工修正必须在订单事件流里看得见，否则半年后没人知道这条订阅为什么变过。
insert into billing.order_events
  (order_id, event_type, from_status, to_status, actor_type, actor_id, remark)
select o.id, 'refunded', 'fulfilled', 'refunded', 'operator', null,
       '人工修正：该 0 元 Free 单被误判为升级，就地改写了 ORD-202609-31DDD533C6 的 '
       'Starter 订阅。已将订阅复原到 Starter 原版本与原账期，本单作废。'
       '代码侧的方向判定见同批 PR（NOT_AN_UPGRADE）。'
  from billing.orders o
 where o.order_no = 'ORD-202609-63E0E32517'
   and not exists (
     select 1 from billing.order_events e
      where e.order_id = o.id and e.event_type = 'refunded'
   );

-- ────────────────────────────── 复原后自检 ──────────────────────────────
-- 三条断言：订阅回到 starter、误单已作废、账单已作废。任一不成立就整体回滚。
do $$
declare t text; st text; bs text;
begin
  select pc.tier into t
    from metering.subscriptions s
    join billing.orders o on o.order_no = 'ORD-202609-63E0E32517'
                        and o.subscription_id = s.id
    join product.plan_components pc on pc.plan_version_id = s.plan_version_id
                                  and pc.component_role = 'primary';
  if t is distinct from 'starter' then
    raise exception '复原后档位是 %，不是 starter，回滚', t;
  end if;

  -- 复活也要断言：档位对了但状态还是 cancelled，等于订阅仍然看不见。
  perform 1 from metering.subscriptions s
    join billing.orders o on o.order_no = 'ORD-202609-63E0E32517'
                        and o.subscription_id = s.id
   where s.status = 'active';
  if not found then
    raise exception '复原后订阅状态不是 active（仍未复活），回滚';
  end if;

  select status into st from billing.orders where order_no = 'ORD-202609-63E0E32517';
  if st <> 'refunded' then raise exception '误单状态是 %，回滚', st; end if;

  select i.bill_status into bs from billing.invoices i
    join billing.orders o on o.id = i.order_id
   where o.order_no = 'ORD-202609-63E0E32517';
  if bs is distinct from 'cancelled' then
    raise exception '误单账单状态是 %，回滚', bs;
  end if;
end $$;

commit;

\echo '修复完成。仍需：让 vxtpl 侧按 Starter 重新授权一次（见文件头「这份脚本不做的两件事」）。'
