-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — P2-h 公告推送上线前：把存量已发布公告标成「已广播」
--
-- AnnouncementBroadcastJob 只推 meta.broadcast_at 为空的 published 公告。上线那一刻库里
-- 已有的公告是历史内容，不该在功能上线当天被当成新公告推给全部租户（站内 + 邮件）。
-- 本迁移一次性打标（meta.broadcast = {skipped: 'pre-P2-h'}）；之后新发布的公告正常推送。
-- 幂等：只碰 broadcast_at 为空的行；重放无副作用。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE admin.announcements
   SET meta = coalesce(meta, '{}'::jsonb)
              || jsonb_build_object('broadcast_at', now(), 'broadcast', jsonb_build_object('skipped', 'pre-P2-h')),
       updated_at = now()
 WHERE status = 'published'
   AND (meta IS NULL OR meta->>'broadcast_at' IS NULL);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM admin.announcements WHERE meta->>'broadcast_at' IS NOT NULL;
  RAISE NOTICE '[announcements-mark-broadcast] announcements marked as broadcast (all time)=%', n;
END $$;

COMMIT;
