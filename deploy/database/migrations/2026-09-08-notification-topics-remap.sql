-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 通知偏好主题重排（owner 2026-09-08）
--
-- 主题从 6 个改成 11 个，键全部换名。normalize 会丢弃未知键，所以**不迁移也不会炸**
-- ——但老用户手动关过的开关会静默回到默认，那等于替他们改了选择。本迁移按下表把旧值
-- 搬到新键上。
--
--   旧键            新键                              说明
--   ------------    ------------------------------    --------------------------
--   subscription →  subscription_expiry               到期/续费提醒
--                +  provision_result                  开通结果（一拆二，同值复制）
--   billing      →  payment_due                       待付订单
--                +  refund_progress                   退款进度（一拆二，同值复制）
--   product      →  announcement                      平台公告
--   security     →  security                          原样保留（键名未变）
--   account      →  （丢弃）                          从来没有模板落到它头上
--   usage        →  （丢弃）                          同上；新的 quota_alert 是新主题
--
-- **一拆二为什么同值复制**：老用户关掉「账单与发票」时，关掉的是那一档下的全部通知
-- （催款 + 退款）。拆开后如果只迁一个、另一个回默认（事务性默认开邮件），等于我们
-- 替他重新打开了他关过的东西。
--
-- 未在旧值里出现的新主题不写入——留给 normalize 按默认值补齐（含事务性的默认开邮件）。
--
-- **存放位置**：偏好不是独立表，而是 `account.user_profiles.preferences` 这一列 jsonb
-- 里的 `notifications` 键（那一列是共享的，别的功能也往里写）。所以只改这一个子键，
-- `preferences` 的其余键必须原样保留——整列覆写会静默清掉别人的数据。
--
-- 幂等：只改 `notifications` 里**还带旧键**的行；跑第二遍时旧键已不存在，命中 0 行。
--
-- 用法（生产，以 owner 身份）：
--   CONFIRM_MIGRATE=yes bash deploy/scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  n_before bigint;
  n_after  bigint;
BEGIN
  SELECT count(*) INTO n_before
    FROM account.user_profiles
   WHERE preferences -> 'notifications'
         ?| array['subscription','billing','product','account','usage'];

  UPDATE account.user_profiles
     SET preferences = preferences || jsonb_build_object(
           'notifications',
           -- 先剥掉全部旧键，再把要保留的值以新键写回。`security` 不在剥离列表里，
           -- 键名没变，原样留着。
           ((preferences -> 'notifications')
              - 'subscription' - 'billing' - 'product' - 'account' - 'usage')
           || coalesce(
                jsonb_strip_nulls(
                  jsonb_build_object(
                    'subscription_expiry', preferences -> 'notifications' -> 'subscription',
                    'provision_result',    preferences -> 'notifications' -> 'subscription',
                    'payment_due',         preferences -> 'notifications' -> 'billing',
                    'refund_progress',     preferences -> 'notifications' -> 'billing',
                    'announcement',        preferences -> 'notifications' -> 'product'
                  )
                ),
                '{}'::jsonb
              )
         ),
         updated_at = now()
   WHERE preferences -> 'notifications'
         ?| array['subscription','billing','product','account','usage'];

  SELECT count(*) INTO n_after
    FROM account.user_profiles
   WHERE preferences -> 'notifications'
         ?| array['subscription','billing','product','account','usage'];

  RAISE NOTICE '[notification-topics] 带旧键的用户：% → %（应为 0）', n_before, n_after;
  IF n_after <> 0 THEN
    RAISE EXCEPTION '[notification-topics] 仍有 % 行带旧键，迁移未完成', n_after;
  END IF;
END $$;

COMMIT;
