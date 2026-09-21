-- ═══════════════════════════════════════════════════════════════════════════
-- 卡券第六型 `invite`：邀请订阅（owner 2026-09-21 定，2026-09-22 实施）。
--
-- ── 为什么不新建表 ──
-- 「邀请订阅」要的每一样，`promotion.vouchers` 都已经有：
--   谁能被邀请   assigned_user_id / assigned_workspace_id（定向发放）
--   有效期       expires_at（可覆盖批次有效期）
--   用掉即失效   max_uses / used_count
--   能否撤回     status 里本来就有 revoked
--   台账         voucher_redemptions（每次核销一行 + effect_snapshot）
-- 所以只需要在两处 kind 的 CHECK 里加一个值，其余全是既有机制。
--
-- ── 它和另外两条发放路径的分界 ──
--   邀请订阅 invite      运营发给指定账号/工作区 → 客户**自己下单、自己付钱**
--   运营发放 operator_grant  运营直接建订阅      → 客户什么都不做，无订单无钱
--   兑换码   redemption      批量发码            → 客户输码，券抵扣
-- **邀请只解锁「能买」，不改变「要付钱」**——这是它与另外两条的分界线。
--
-- ── effect 装什么 ──
-- `{"planCode": "...", "planVersionId": "...", "note": "..."}`：这张邀请解锁哪个
-- 套餐。kind 专属参数走 effect JSONB 是本 schema 的既有约定（§4），不拆列。
--
-- ── 消耗时刻 ──
-- **下单时**消耗（`assigned → redeemed`，非 discount 类的既定直达路径），并写一行
-- voucher_redemptions 当台账。不等到订阅创建：那要把 invite 一路从订单穿到
-- services/commerce/subscription，跨包；而「解锁能买」在下单那一刻就兑现了。
-- 代价：订单取消后邀请已烧掉，需运营重发——已知且接受。
--
-- 列锁无需变更：status / used_count / redeemed_at 都已在 98 的 GRANT 名单里。
-- 重复执行安全（先 DROP 再 ADD，两处同构）。
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE promotion.voucher_batches
  DROP CONSTRAINT IF EXISTS chk_voucher_batches_kind;
ALTER TABLE promotion.voucher_batches
  ADD CONSTRAINT chk_voucher_batches_kind
  CHECK (kind IN ('credit_voucher','recharge_card','redemption','discount','extension','invite'));

ALTER TABLE promotion.voucher_redemptions
  DROP CONSTRAINT IF EXISTS chk_voucher_redemptions_kind;
ALTER TABLE promotion.voucher_redemptions
  ADD CONSTRAINT chk_voucher_redemptions_kind
  CHECK (kind IN ('credit_voucher','recharge_card','redemption','discount','extension','invite'));
