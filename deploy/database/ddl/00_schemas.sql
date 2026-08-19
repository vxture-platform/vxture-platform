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
-- 10 万用户规模设计（含僵尸），起点 6 位；旧 10 位方案（1000010000）已废。
CREATE SEQUENCE IF NOT EXISTS account.user_no_seq   AS bigint START WITH 100000 INCREMENT BY 1 MINVALUE 100000;
CREATE SEQUENCE IF NOT EXISTS tenancy.tenant_no_seq AS bigint START WITH 100000 INCREMENT BY 1 MINVALUE 100000;
CREATE SEQUENCE IF NOT EXISTS tenancy.workspace_no_seq AS bigint START WITH 100000 INCREMENT BY 1 MINVALUE 100000;
