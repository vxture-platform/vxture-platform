-- ════════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 通知偏好主题 `security` 改名拆两行（owner 2026-09-29 裁定 2）
--
-- 代码那一半已经改了：`security` 改名成 `security_event` 并拆出 `login_activity`
-- （services/identity/account/.../notification-preferences.service.ts 的 NOTIFICATION_TOPICS）。
-- 本迁移管库里存着的那一半。
--
-- 偏好不是独立表，而是 `account.user_profiles.preferences` 这一列 jsonb 里的 `notifications`
-- 子键（那一列是共享的，别的功能也往里写）。所以**只改这一个子键**，其余键
-- 原样保留——整列覆写会静默清掉别人的数据。形状照 2026-09-08-notification-topics-remap.sql。
--
-- ── 库里真的有行带着 `security` 这个键（不是“可能有”）──
--   `replace()` 存的是 `normalize()` 补齐后的**完整矩阵**（`defaults()` 按 NOTIFICATION_TOPICS
--   逐个铺开，再 `JSON.stringify` 整个写回），而 `security` 从 2026-08 落库那一版起就在那张
--   清单里，直到本批才改名。所以：**凡存过一次通知偏好的账号，那一行就带着这个键**。
--   而 `normalize()` **丢弃未知主题**，不迁就是：旧键静默消失，两个新主题回落默认值。
--
-- ── 搬什么：**只搬开着的那几档**（这是本迁移与先例唯一不同的地方，理由写在这里）──
--   先例是把旧值**整个**搬到新键上的，理由是「老用户关掉的东西不能被我们重新打开」。
--   那条理由只对**客户真能关掉的档**成立。逐版查过旧那一行的历史：
--     · 站内档一直在 LOCKED 里被强制为 true，存下来的**只能是** true——服务端按的，不是
--       客户选的。所以它**一档都不搬**：新的 `security_event` 同样把站内锁为 true，
--       `login_activity` 的站内默认也是 true，搬过去是一行不改变任何结果的噪音。
--     · 邮件 / 短信两档的默认值在每一版里都是 false（`security` 从未进过
--       TOPIC_DEFAULT_OVERRIDES），而 2026-09-08 重排之后它被标成「开发中」、三个开关全部
--       disabled，根本点不动。所以库里的 false **与「从没动过的默认值」无法区分**，
--       它不是一个选择；反过来，true 是可证的选择（2026-09-08 之前那一行的开关是能点的）。
--   而两个新主题的邮件档默认**开**，那是 owner 裁定 1 的安全兜底（被锁定的客户打不开
--   收件箱，站内那一个通道在这一档上本身不可信）。把一个置灰开关里的 false 搬上去，
--   等于给**每一个访过设置页的存量客户**静默关掉安全邮件——那比丢了旧键更坏，而且
--   没有任何客户要求过它。所以：**true 搬、false 不搬**。可证的选择一个不丢，没人选过的
--   默认值交回给代码那一份权威（`TOPIC_DEFAULT_OVERRIDES`）。默认值因此仍然只住一处，
--   本文件里一个默认值都没写。
--   （写出来的新键因此可能是**残缺对象**，如 {"sms": true}。`normalize()` 对这种形状是
--    现成的：缺的档按默认补齐，只认布尔。所以不必在这里把矩阵填完。）
--
--   搬到哪里：两个新主题**同值复制**，理由与先例的一拆二同一条——客户当时在那一行上
--   打开的是「账号安全」这整一档，拆开后只搬一半等于我们替他关掉了另一半。
--
-- ── 幂等（本目录被**全量重放**，每次 migrate 都会再跑一遍）──
--   只改 `notifications` 里**还带旧键**的行。第二遍时旧键已不存在，命中 0 行、不动
--   `updated_at`。另外 `||` 的方向是「已有的新键胜」：万一哪一行既带旧键又带新键
--   （今天不可能——改名上线后任何一次保存都会把旧键丢掉），也不覆盖客户真正选过的那份。
--
-- 用法（生产，以 owner 身份）：
--   CONFIRM_MIGRATE=yes bash deploy/scripts/28d-apply-migrations.sh
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  n_before  bigint;
  n_after   bigint;
  n_carried bigint;
BEGIN
  SELECT count(*) INTO n_before
    FROM account.user_profiles
   WHERE preferences -> 'notifications' ? 'security';

  WITH old AS (
    SELECT user_id,
           preferences -> 'notifications' AS notifications,
           CASE
             WHEN jsonb_typeof(preferences -> 'notifications' -> 'security')
                  = 'object'
             THEN preferences -> 'notifications' -> 'security'
             ELSE '{}'::jsonb
           END AS sec
      FROM account.user_profiles
     WHERE preferences -> 'notifications' ? 'security'
  ), carried AS (
    SELECT user_id,
           notifications,
           -- 只留客户自己能选、且真的选了的：邮件 / 短信两档的 true。站内那一档是
           -- 服务端锁的，一档都不搬。理由见报头。
           jsonb_strip_nulls(jsonb_build_object(
             'email', CASE WHEN sec -> 'email' = to_jsonb(true)
                           THEN to_jsonb(true) END,
             'sms',   CASE WHEN sec -> 'sms'   = to_jsonb(true)
                           THEN to_jsonb(true) END
           )) AS kept
      FROM old
  )
  UPDATE account.user_profiles p
     SET preferences = p.preferences || jsonb_build_object(
           'notifications',
           CASE
             WHEN c.kept = '{}'::jsonb THEN '{}'::jsonb
             ELSE jsonb_build_object('security_event', c.kept,
                                     'login_activity', c.kept)
           END
           -- 右侧胜：剪掉旧键后的原矩阵永远盖在搬过来的值上面。
           || (c.notifications - 'security')
         ),
         updated_at = now()
    FROM carried c
   WHERE p.user_id = c.user_id;

  SELECT count(*) INTO n_after
    FROM account.user_profiles
   WHERE preferences -> 'notifications' ? 'security';

  SELECT count(*) INTO n_carried
    FROM account.user_profiles
   WHERE preferences -> 'notifications' ? 'security_event'
      OR preferences -> 'notifications' ? 'login_activity';

  RAISE NOTICE '[notification-topic-security] 带旧键的用户：% → %（应为 0）；带新键的共 % 行',
    n_before, n_after, n_carried;
  IF n_after <> 0 THEN
    RAISE EXCEPTION '[notification-topic-security] 仍有 % 行带旧键，迁移未完成', n_after;
  END IF;
END $$;

COMMIT;
