-- ═══════════════════════════════════════════════════════════════════════════
-- 给 13 个通用计量键补中文名与一句话说明（owner 2026-09-22 逐条过目定稿）。
--
-- ── 为什么走迁移而不是让运营一个个点 ──
-- 这 13 个是**通用键**（资源、上限、周期类），名字与产品无关，逐个点进 opera 要开
-- 十几次对话框，而且每次都可能敲出不一样的措辞。产品专属的那几个不在此列，见下。
--
-- ── ON CONFLICT DO NOTHING 是必需的，不是保险 ──
-- migrate 是**全量重放**：每次 migrate 都会再跑一遍本文件。若写成 DO UPDATE，
-- 运营后来在 opera 里改过的名字会在下一次 migrate 被悄悄冲回这里的字面量——
-- 那是「运营改了又变回去」这类最难查的问题。DO NOTHING 让本文件只负责**初值**。
--
-- ── 故意不写的 6 个 ──
-- karda.ask / karda.ingest / karda.search / varda.enabled / varda.readonly：
--   产品专属。`varda.enabled` 该叫「Varda 开关」还是「智能体启用」，只有产品自己
--   知道，平台替它命名必然错。留空 ⇒ 界面回落显示 metric_key 本身，不阻塞。
-- member.max：正在等席位设计的裁定（data_commerce_250 §5-④）——它可能整个改名成
--   seat.max，现在命名等于给一个将要改名的东西起名。
--
-- 措辞口径：max 策略写「上限」，pool 策略写「次数」并点明按月重置，
-- tiered 策略写「按档位开放」。单位与重置周期取自 product_metrics / platform_metrics
-- 的实际值，不是凭印象写的。
--
-- 重复执行安全。
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO product.metric_catalog (metric_key, display_name, description)
VALUES
  -- 第一组：平台级共享资源（有成本，platform_metrics）
  ('ai.credit',           'AI 额度',        '调用模型消耗的额度，每月重置'),
  ('compute.cpu',         'CPU 算力',       '可使用的 CPU 计算资源'),
  ('compute.gpu',         'GPU 算力',       '可使用的 GPU 计算资源'),
  ('storage.bytes',       '存储空间',       '可占用的存储容量'),
  ('ingress.bytes',       '入站流量',       '上传到平台的数据量'),
  ('egress.bytes',        '出站流量',       '从平台流出的数据量'),
  -- 第二组：通用配额项（product_metrics）
  ('dataset.max',         '数据集上限',     '最多可创建的数据集数'),
  ('datasource.max',      '数据源上限',     '最多可接入的数据源数'),
  ('service_endpoint.max','服务端点上限',   '最多可开放的服务端点数'),
  ('retention.days',      '数据保留天数',   '数据在平台留存的天数'),
  ('sync.frequency',      '数据同步频率',   '按档位开放的同步频率'),
  ('service.api.call',    '接口调用次数',   '每月可发起的接口调用次数，按月重置'),
  ('quality.check.run',   '质量检查次数',   '每月可执行的质量检查次数，按月重置')
ON CONFLICT (metric_key) DO NOTHING;

DO $$
DECLARE named int; pending int; pending_keys text;
BEGIN
  SELECT count(*) INTO named FROM product.metric_catalog WHERE display_name IS NOT NULL;

  WITH k AS (
    SELECT metric_key FROM product.product_metrics
    UNION
    SELECT metric_key FROM product.platform_metrics
  )
  SELECT count(*), string_agg(k.metric_key, ', ' ORDER BY k.metric_key)
    INTO pending, pending_keys
    FROM k LEFT JOIN product.metric_catalog c ON c.metric_key = k.metric_key
   WHERE c.display_name IS NULL;

  RAISE NOTICE '[metric-names] 已命名 % 个；仍未命名 % 个：%',
    named, pending, coalesce(pending_keys, '（无）');
  RAISE NOTICE '[metric-names] 未命名的按设计留空（产品专属名归产品定；member.max 等席位裁定），界面回落显示 metric_key';
END $$;
