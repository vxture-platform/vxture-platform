-- 2026-09-25 · 邀请新增 declined 状态（被邀请人自己拒绝）
--
-- 背景（owner 2026-09-09）：按用户号邀请是站内送达、由本人同意才加入。既然要
-- 「同意」，就必须能「不同意」——一条只能靠过期消失的邀请会永远挂在对方的
-- 「待办与消息」里，与「处理完才消失」的口径相反。
--
-- 为什么不复用 revoked：revoked 的语义是**邀请人撤回**。把对方的拒绝也写成
-- revoked，邀请台账就会把「对方不来」显示成「我撤回了」——那是在对邀请人说谎。
--
-- 只动 CHECK，不加列：status 已在 98_column_locks.sql 的 GRANT UPDATE 列表里，
-- 无需改授权。

begin;

alter table tenancy.invitations
  drop constraint if exists chk_invitations_status;

alter table tenancy.invitations
  add constraint chk_invitations_status
  check (status in ('pending','accepted','expired','revoked','declined'));

-- 自检 1：新状态确实被接受。
do $$
declare ok boolean;
begin
  select pg_get_constraintdef(oid) like '%declined%'
    into ok
    from pg_constraint
   where conrelid = 'tenancy.invitations'::regclass
     and conname = 'chk_invitations_status';
  if ok is distinct from true then
    raise exception 'chk_invitations_status 未包含 declined';
  end if;
end $$;

-- 自检 2：约束仍然在挡未知状态——放宽一个枚举时最容易顺手把门也卸了。
--
-- 探针的外键列取**真实存在的行**，不是随机 uuid：`invitations` 上有
-- `fk_invitations_created_by` 与复合的 `fk_invitations_role (role_id, role_scope)`。
-- 用随机 uuid 时这一条也能过，但过的理由是「PG 先评 CHECK、后评 FK」——
-- 那是评估顺序的巧合，不是判据。真要有人把 CHECK 拆了，探针会撞上 FK 抛
-- foreign_key_violation，而下面只接 check_violation，于是迁移以一个
-- 看不懂的错误失败，而不是那句「约束失效」。
do $$
declare
  v_role  uuid;
  v_scope text;
  v_user  uuid;
begin
  select id, scope into v_role, v_scope from access.roles limit 1;
  select id into v_user from account.users limit 1;
  if v_role is null or v_user is null then
    -- 空库（首次 DDL 之后、seed 之前）没有可用的外键目标：跳过探针而不是假装通过。
    raise notice '跳过约束探针：access.roles 或 account.users 为空';
    return;
  end if;
  begin
    insert into tenancy.invitations
      (scope, target_type, target, role_id, role_scope, status, token_hash, expires_at, created_by)
    values
      ('org', 'email', 'probe@invalid', v_role, v_scope,
       'not_a_real_status', 'probe-' || gen_random_uuid()::text, now(), v_user);
    raise exception '约束失效：未知状态被写进去了';
  exception
    when check_violation then null;  -- 期望走到这里：唯一能挡住它的只剩 CHECK
  end;
end $$;

commit;
