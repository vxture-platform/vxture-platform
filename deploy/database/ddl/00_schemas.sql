-- ═══════════════════════════════════════════════════════════════════════════
-- 00_schemas.sql — 平台库 schema 与全局序列（apply 顺序第一）
-- 权威机制：手写 SQL DDL 单一权威（取代 prisma db push；见 data_platform_320）。
-- 平台库 vxturestudio_platform_main：19 schema（18 + sharing，M5 2026-07-07）。
-- 幂等：CREATE SCHEMA/SEQUENCE IF NOT EXISTS。
-- ═══════════════════════════════════════════════════════════════════════════

-- identity 域（9）
CREATE SCHEMA IF NOT EXISTS account;      -- 本地账号主体：你是谁
CREATE SCHEMA IF NOT EXISTS identity;     -- 联邦身份：外部如何识别你
CREATE SCHEMA IF NOT EXISTS credential;   -- 本地凭据 / 验证 / 登录风控
CREATE SCHEMA IF NOT EXISTS kyc;          -- 实名 / 认证策略
CREATE SCHEMA IF NOT EXISTS tenancy;      -- 租户 / 工作空间 / 成员
CREATE SCHEMA IF NOT EXISTS access;       -- 客户治理 RBAC（role/permission）
CREATE SCHEMA IF NOT EXISTS appoidc;      -- Vxture 作 IdP：oidc client / 签名密钥 / consent
CREATE SCHEMA IF NOT EXISTS session;      -- 会话 / refresh token（realm 隔离，对 account 裸 UUID）
CREATE SCHEMA IF NOT EXISTS loyalty;      -- 成长：等级 / 积分 / 任务

-- commerce 域（4）
CREATE SCHEMA IF NOT EXISTS metering;     -- 订阅 / 配额 / 用量计量内核
CREATE SCHEMA IF NOT EXISTS billing;      -- 账单 / 发票 / 支付 / 退款 / 不可变流水
CREATE SCHEMA IF NOT EXISTS provisioning; -- 开通生命周期 / webhook 投递
CREATE SCHEMA IF NOT EXISTS promotion;    -- 卡券 / 兑换 / 核销

-- 其余（5）
CREATE SCHEMA IF NOT EXISTS product;      -- 产品矩阵 / 套餐 / 定价
CREATE SCHEMA IF NOT EXISTS model;        -- AI 模型目录 / 授权 / 计价（平台侧）
CREATE SCHEMA IF NOT EXISTS safety;       -- 内容审核（结构占位）
CREATE SCHEMA IF NOT EXISTS support;      -- 工单 / 中央审计 / 通知
CREATE SCHEMA IF NOT EXISTS admin;        -- 运营身份（operator_*）+ 平台治理

-- sharing 域（1，M5/ADR-12：SharingGrant 策略 SoT + 物化可见集）
CREATE SCHEMA IF NOT EXISTS sharing;      -- org 内共享授权（grants SoT / visible_set 物化）

-- ── 全局可视码序列（铁律二：外部可视码，永不做 FK 目标）──────────────────────
-- ── 主体可视码 定版 v4「三号解耦」(2026-09-05 owner 定案,取代 v3「人租同号」)────
-- 三个主体号(user_no / tenant_no / workspace_no)**各自独立取号,互不推导**。
-- 归属关系只走 uuid 外键(tenants.owner_user_id / workspaces.tenant_id / 成员表),
-- 号里不再烧任何关系——这是架构铁律二(可视码永不做关联键)的回归:v3 把
-- 「个人租户号 = owner 的 user_no」「空间号 = 租户号×1000+序号」写进号里,等于隐式外键,
-- 于是个人转组织必须换号、空间号必须跟着改、每租户空间数被三位序号卡死 999。v4 全部取消。
--
-- 号形:10 位 = 类别位(1) + 随机段(8) + Luhn 校验位(1)。
--   类别位 1=用户 2=租户 3=工作空间(**是这个对象自身的类别,不是归属**;个人↔组织同为租户,
--   类别位不变,故转换不动号)。范围 [class×10^9, (class+1)×10^9),恒 10 位,JSON 安全。
--   随机段直取随机(不走序列):号不承载先后,别人拿两个号推不出增长量。
--   Luhn 校验位:客服手输错一位当场可查(生成/校验见下方 public 函数)。
--   每类容量 1 亿;唯一约束兜底,分配器重试(见 95 触发器)。
-- 规格权威:data_identity_200_schema.md §11。
--
-- v3 的 account.principal_no_seq 已随之退役(迁移 2026-09-12 里 DROP)。

-- Luhn 校验位:对 p_digits(不含校验位)算出应附加的一位。
CREATE OR REPLACE FUNCTION public.luhn_check_digit(p_digits text) RETURNS int
  LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  v_sum int := 0;
  v_i   int;
  v_d   int;
  v_dbl boolean := true;   -- 自右向左,紧邻校验位的那位起加倍
BEGIN
  FOR v_i IN REVERSE length(p_digits)..1 LOOP
    v_d := substr(p_digits, v_i, 1)::int;
    IF v_dbl THEN
      v_d := v_d * 2;
      IF v_d > 9 THEN v_d := v_d - 9; END IF;
    END IF;
    v_sum := v_sum + v_d;
    v_dbl := NOT v_dbl;
  END LOOP;
  RETURN (10 - (v_sum % 10)) % 10;
END;
$$;

-- 主体码合法性:落在类别区间内、恰好 10 位、末位 Luhn 通过。供三张表的 CHECK 复用。
CREATE OR REPLACE FUNCTION public.principal_no_valid(p_no bigint, p_class int) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  v_text text;
BEGIN
  IF p_no < p_class::bigint * 1000000000
     OR p_no >= (p_class::bigint + 1) * 1000000000 THEN
    RETURN false;
  END IF;
  v_text := p_no::text;   -- 区间保证首位非 0,恒 10 位
  RETURN substr(v_text, 10, 1)::int = public.luhn_check_digit(substr(v_text, 1, 9));
END;
$$;

-- 取一个新主体码(不查重;查重与重试在各表的分配器里,见 95 触发器)。
CREATE OR REPLACE FUNCTION public.new_principal_no(p_class int) RETURNS bigint
  LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
  v_body text;
BEGIN
  IF p_class NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION '主体码类别位只能是 1(用户)/2(租户)/3(工作空间),收到 %', p_class;
  END IF;
  v_body := p_class::text || lpad(floor(random() * 100000000)::bigint::text, 8, '0');
  RETURN (v_body || public.luhn_check_digit(v_body)::text)::bigint;
END;
$$;
