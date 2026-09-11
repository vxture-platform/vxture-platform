-- 2026-10-01-checklist-c1-s2s.sql
-- 上线检查单新增「C1 出站换票」——把一个此前谁都检查不到的义务变成一行。
--
-- ══ 为什么需要它 ══
-- `c1_identity` 的判据只有**入站**：
--   'OIDC client registered; RP implementation (login/callback/session) completed.'
-- 而智能体要用基础设施（模型走 Atlas、能力走 Runos、知识走 Karda）就必须做**出站**
-- 的 S2S 换票。那一半此前：
--   · 在《产品接入通则》里叫「C1b」并标着「要调别的产品才需要」——读起来像可选项，
--     而实际上几乎全部智能体都需要；
--   · 检查单里**没有任何一项覆盖它**，所以一个产品可以 c1_identity 通过、
--     而换票一行没写，上线闸门看不出来。
--
-- owner 2026-09-12 裁定：编号不顺延（C1/C2/C3 是库里的检查项码，改动要重写
-- product_launch_statuses 的存量行），改为把出站单列一项。
--
-- ══ 为什么它能机器判定 ══
-- `core-utils/launch-checklist.ts` 的判据是「一项检查只有在它的**全部内容**都被实测
-- 覆盖时才算机器判定」。`c1_identity` 不合格，因为 RP 实现是对方的事。
--
-- 出站合格：**换票就发生在平台上**，平台是签发方。auth-bff 每次成功换票已经往
-- `support.audit_logs` 写一条（product_210 §6 的 append-only 审计），带
-- `after.caller_product`。那条痕迹一直在写，只是从来没人读——本次把它接上，
-- 不新开任何写路径。
--
-- ══ sort = 45 ══
-- 紧跟 c1_identity（40）。两项是同一个身份面的入站与出站，中间不插别的。

INSERT INTO product.launch_checklist_items
  (item_code, item_name, item_name_key, description, description_key, is_required, sort)
VALUES
  ('c1_s2s', 'C1 出站换票', 'product.checklist.c1_s2s',
   'S2S token exchange wired: the product has obtained a delegated token to call Atlas/Runos/Karda.',
   'product.checklist.c1_s2s.desc', true, 45)
ON CONFLICT (item_code) DO NOTHING;

-- 不给存量产品预写 product_launch_statuses 行：
-- 这一项是机器判定的，值由复验写入。预写一行 false 与「没有行」在界面上都是「未满足」，
-- 但预写会带一个假的 checked_at——而 checked_at 的语义是「平台在那一刻实测过」。
-- 让它保持没有行，第一次跑复验时自然落位。

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM product.launch_checklist_items WHERE item_code = 'c1_s2s';
  IF n <> 1 THEN
    RAISE EXCEPTION '[checklist-c1-s2s] c1_s2s 没有落位（count=%）', n;
  END IF;
  RAISE NOTICE '[checklist-c1-s2s] C1 出站换票已登记（sort 45，机器判定，判据取自 support.audit_logs 的换票审计）';
END $$;
