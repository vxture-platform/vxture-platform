-- 2026-09-30-product-icons.sql
-- 产品图标改为平台托管（owner 2026-09-11 裁定 A：上传，没有则回落默认）
--
-- ══ 为什么不再用「产品域名/icon.png」 ══
-- 此前 `products.icon_url` 是一个指向**产品自己域名**的外链。五个问题：
--
--   ① 可用性倒挂——产品站点挂了，console 的磁贴就缺图；而用户此刻来控制台，
--      恰恰是因为产品出问题了。平台界面不该在产品不可用时跟着退化。
--   ② 第三方产品的域名不在我们手上，对方换图我们不可控——而那张图显示在**我们的**
--      控制台里，用户会当它是平台背书的。
--   ③ 尺寸与格式不可控（一张 2MB 的 PNG 就是磁贴要加载的 2MB）。
--   ④ 换图不换 URL 时缓存对不齐；换 URL 又得回平台改配置。
--   ⑤ 将来私有化部署时产品的公网域名不可达。
--
-- 图标是**平台界面的构件**，不是产品内容。谁的界面，谁持有构件。
--
-- ══ 为什么存库而不是对象存储或文件系统 ══
-- 平台目前**没有任何上传基础设施**（BFF 里没有 multipart、没有 OSS/S3 客户端）。
-- nginx 的 html 目录是**只读挂载**且没有 BFF 容器共享它，写文件系统要改部署拓扑。
--
-- 而图标很小：单个 ≤256KB、每产品一张，二十几个产品合计几 MB。存库零新增基础设施、
-- 随库一起备份、私有化部署也成立。将来有了对象存储（发票、附件、工单截图迟早要），
-- 再整体迁过去——那时这张表就是现成的迁移源。
--
-- ══ 为什么不收 SVG ══
-- **SVG 可以带 `<script>`。** 从 console 自己的域名把用户提交的 SVG 发出去，等于
-- 存储型 XSS，且带着客户的会话 cookie。加 CSP / nosniff 能缓解，但各浏览器对内联
-- SVG 的处理并不一致，而这一层的收益只是"图标可以是矢量的"。
-- 只收位图，把这一整类风险去掉；要矢量就先栅格化。

CREATE TABLE IF NOT EXISTS product.product_icons (
    -- 一产品一张。用 product_id 直接做主键而不是另起 id：这张表没有"多行"的语义，
    -- 加一个代理键只会让"到底哪张是当前的"变成一个要回答的问题。
    product_id  uuid         PRIMARY KEY REFERENCES product.products(id) ON DELETE CASCADE,
    mime_type   varchar(64)  NOT NULL,
    bytes       bytea        NOT NULL,
    -- 冗余存一份长度：列出图标清单时不必把 bytea 拖出来算 length()。
    byte_size   int          NOT NULL,
    -- 内容哈希，给 HTTP 的 ETag 用——浏览器带 If-None-Match 来就回 304，不重发字节。
    checksum    varchar(64)  NOT NULL,
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_product_icons_mime CHECK (mime_type IN ('image/png','image/webp','image/jpeg')),
    -- 256KB。磁贴用的图标远小于这个数；给上限是为了让"传错文件"在入口就停，
    -- 而不是变成一张被所有 console 用户下载的大图。
    CONSTRAINT chk_product_icons_size CHECK (byte_size > 0 AND byte_size <= 262144)
);

COMMENT ON TABLE product.product_icons IS
  '产品图标（平台托管）。一产品一张，位图；不收 SVG（存储型 XSS）。没有行时界面回落到产品字母牌。';

-- ── 列级锁（TD-018）──────────────────────────────────────────────────────────
-- 98 是**白名单** GRANT：新表不写进去，platform_svc 就写不了它，症状是生产上一句
-- 42501、整条事务回滚。98_column_locks.sql 同步已改。
--
-- product_id 是锚点（主键），不进 UPDATE 白名单：换图是覆盖同一行的内容，
-- 不是把这一行改挂到另一个产品上。
REVOKE UPDATE ON product.product_icons FROM platform_svc;
GRANT UPDATE (mime_type, bytes, byte_size, checksum, updated_at)
  ON product.product_icons TO platform_svc;
GRANT SELECT, INSERT, DELETE ON product.product_icons TO platform_svc;

-- ── icon_url 保留，不删 ─────────────────────────────────────────────────────
-- 存量产品可能已经填了外链，而且 console-bff 的两处查询在读它。这一批只新增托管
-- 这条路；读取优先级（有托管的用托管、没有的看 icon_url、再没有回落字母牌）由应用层
-- 决定。等所有产品都迁过来，再单独退役那一列——**同一批里既加新路又删旧列，
-- 回滚时会发现两头都不完整。**
