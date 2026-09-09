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
do $$
begin
  begin
    insert into tenancy.invitations
      (scope, target_type, target, role_id, role_scope, status, token_hash, expires_at, created_by)
    values
      ('org', 'email', 'probe@invalid', gen_random_uuid(), 'tenant',
       'not_a_real_status', 'probe-' || gen_random_uuid()::text, now(), gen_random_uuid());
    raise exception '约束失效：未知状态被写进去了';
  exception
    when check_violation then null;  -- 期望走到这里
  end;
end $$;

commit;
