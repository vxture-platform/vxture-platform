/*
 Navicat Premium Dump SQL

 Source Server         : mylocalhost-pg-develop
 Source Server Type    : PostgreSQL
 Source Server Version : 180003 (180003)
 Source Host           : localhost:5432
 Source Catalog        : vxture_beta
 Source Schema         : commerce

 Target Server Type    : PostgreSQL
 Target Server Version : 180003 (180003)
 File Encoding         : 65001

 Date: 21/04/2026 17:27:12
*/


-- ----------------------------
-- Table structure for tenant_invoice
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_invoice";
CREATE TABLE "commerce"."tenant_invoice" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "bill_no" varchar(64) COLLATE "pg_catalog"."default" NOT NULL,
  "subscription_id" uuid,
  "bill_cycle" varchar(8) COLLATE "pg_catalog"."default" NOT NULL,
  "cycle_start_date" date NOT NULL,
  "cycle_end_date" date NOT NULL,
  "total_amount" numeric(12,2) NOT NULL DEFAULT 0.0,
  "discount_amount" numeric(12,2) DEFAULT 0.0,
  "payable_amount" numeric(12,2) NOT NULL DEFAULT 0.0,
  "paid_amount" numeric(12,2) DEFAULT 0.0,
  "currency" varchar(16) COLLATE "pg_catalog"."default" DEFAULT 'CNY'::character varying,
  "bill_status" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'unpaid'::character varying,
  "bill_type" varchar(32) COLLATE "pg_catalog"."default" DEFAULT 'normal'::character varying,
  "paid_at" timestamptz(6),
  "payment_method" varchar(64) COLLATE "pg_catalog"."default",
  "transaction_no" varchar(128) COLLATE "pg_catalog"."default",
  "operator_id" uuid,
  "operate_remark" text COLLATE "pg_catalog"."default",
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;
COMMENT ON COLUMN "commerce"."tenant_invoice"."bill_type" IS '账单类型：normal=正常账单, adjust=调整单, supplement=补录单, prepaid=预付费';

-- ----------------------------
-- Table structure for tenant_invoice_item
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_invoice_item";
CREATE TABLE "commerce"."tenant_invoice_item" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "bill_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "agent_id" uuid,
  "feature_id" uuid,
  "subscription_id" uuid,
  "item_name" varchar(128) COLLATE "pg_catalog"."default" NOT NULL,
  "item_type" varchar(32) COLLATE "pg_catalog"."default" NOT NULL,
  "item_unit" varchar(64) COLLATE "pg_catalog"."default",
  "quantity" numeric(12,4) DEFAULT 1.0,
  "unit_price" numeric(12,2) DEFAULT 0.0,
  "total_amount" numeric(12,2) NOT NULL DEFAULT 0.0,
  "usage_record_id" uuid,
  "remark" varchar(512) COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;

-- ----------------------------
-- Table structure for tenant_invoice_receipt
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_invoice_receipt";
CREATE TABLE "commerce"."tenant_invoice_receipt" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "bill_id" uuid NOT NULL,
  "invoice_no" varchar(64) COLLATE "pg_catalog"."default" NOT NULL,
  "invoice_type" varchar(32) COLLATE "pg_catalog"."default" NOT NULL,
  "invoice_tax_type" varchar(32) COLLATE "pg_catalog"."default" NOT NULL,
  "invoice_title" varchar(256) COLLATE "pg_catalog"."default" NOT NULL,
  "tax_no" varchar(128) COLLATE "pg_catalog"."default",
  "company_info" jsonb NOT NULL,
  "bank_info" jsonb,
  "address_info" jsonb,
  "invoice_amount" numeric(12,2) NOT NULL,
  "tax_amount" numeric(12,2) DEFAULT 0.0,
  "currency" varchar(16) COLLATE "pg_catalog"."default" DEFAULT 'CNY'::character varying,
  "invoice_status" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'applying'::character varying,
  "status_remark" text COLLATE "pg_catalog"."default",
  "invoice_code" varchar(64) COLLATE "pg_catalog"."default",
  "invoice_electronic_no" varchar(64) COLLATE "pg_catalog"."default",
  "invoice_file_url" text COLLATE "pg_catalog"."default",
  "issued_at" timestamptz(6),
  "express_company" varchar(64) COLLATE "pg_catalog"."default",
  "express_no" varchar(64) COLLATE "pg_catalog"."default",
  "send_at" timestamptz(6),
  "created_by" uuid NOT NULL,
  "auditor_id" uuid,
  "audit_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;

-- ----------------------------
-- Table structure for tenant_payment
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_payment";
CREATE TABLE "commerce"."tenant_payment" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "bill_id" uuid NOT NULL,
  "transaction_id" uuid NOT NULL,
  "pay_order_no" varchar(64) COLLATE "pg_catalog"."default" NOT NULL,
  "pay_source" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'online'::character varying,
  "pay_channel" varchar(32) COLLATE "pg_catalog"."default",
  "pay_method" varchar(32) COLLATE "pg_catalog"."default",
  "offline_pay_type" varchar(32) COLLATE "pg_catalog"."default",
  "offline_payer_name" varchar(128) COLLATE "pg_catalog"."default",
  "offline_pay_time" timestamptz(6),
  "offline_evidence_url" text COLLATE "pg_catalog"."default",
  "total_amount" numeric(12,2) NOT NULL,
  "paid_amount" numeric(12,2) DEFAULT 0.0,
  "currency" varchar(16) COLLATE "pg_catalog"."default" DEFAULT 'CNY'::character varying,
  "pay_status" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'pending'::character varying,
  "status_msg" text COLLATE "pg_catalog"."default",
  "channel_order_no" varchar(128) COLLATE "pg_catalog"."default",
  "channel_transaction_no" varchar(128) COLLATE "pg_catalog"."default",
  "channel_raw_data" jsonb,
  "pay_expire_at" timestamptz(6),
  "paid_at" timestamptz(6),
  "closed_at" timestamptz(6),
  "operator_id" uuid,
  "operate_remark" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Table structure for tenant_refund
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_refund";
CREATE TABLE "commerce"."tenant_refund" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "bill_id" uuid NOT NULL,
  "pay_record_id" uuid NOT NULL,
  "transaction_id" uuid NOT NULL,
  "refund_no" varchar(64) COLLATE "pg_catalog"."default" NOT NULL,
  "refund_amount" numeric(12,2) NOT NULL,
  "currency" varchar(16) COLLATE "pg_catalog"."default" DEFAULT 'CNY'::character varying,
  "refund_reason" varchar(512) COLLATE "pg_catalog"."default",
  "refund_type" varchar(32) COLLATE "pg_catalog"."default" DEFAULT 'normal'::character varying,
  "audit_status" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'pending'::character varying,
  "audit_remark" text COLLATE "pg_catalog"."default",
  "auditor_id" uuid,
  "audit_at" timestamptz(6),
  "channel_refund_no" varchar(128) COLLATE "pg_catalog"."default",
  "refund_status" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'pending'::character varying,
  "refund_at" timestamptz(6),
  "created_by" uuid NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Table structure for tenant_subscription
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_subscription";
CREATE TABLE "commerce"."tenant_subscription" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "cycle_type" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'monthly'::character varying,
  "start_at" timestamptz(6) NOT NULL,
  "end_at" timestamptz(6),
  "trial_end_at" timestamptz(6),
  "status" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'active'::character varying,
  "auto_renew" bool DEFAULT true,
  "order_no" varchar(128) COLLATE "pg_catalog"."default",
  "pay_amount" numeric(12,2),
  "currency" varchar(16) COLLATE "pg_catalog"."default" DEFAULT 'CNY'::character varying,
  "created_by" uuid NOT NULL,
  "updated_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;

-- ----------------------------
-- Table structure for tenant_subscription_history
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_subscription_history";
CREATE TABLE "commerce"."tenant_subscription_history" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "subscription_id" uuid NOT NULL,
  "change_type" varchar(32) COLLATE "pg_catalog"."default" NOT NULL,
  "from_plan_id" uuid,
  "to_plan_id" uuid,
  "from_status" varchar(32) COLLATE "pg_catalog"."default",
  "to_status" varchar(32) COLLATE "pg_catalog"."default",
  "operator_type" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'system'::character varying,
  "operator_id" uuid,
  "operator_remark" varchar(512) COLLATE "pg_catalog"."default",
  "client_ip" varchar(64) COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Table structure for tenant_subscription_override
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_subscription_override";
CREATE TABLE "commerce"."tenant_subscription_override" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "agent_id" uuid,
  "feature_id" uuid NOT NULL,
  "custom_quota" int8 NOT NULL DEFAULT 0,
  "is_unlimited" bool DEFAULT false,
  "is_enabled" bool DEFAULT true,
  "effective_start_at" timestamptz(6) NOT NULL DEFAULT now(),
  "effective_end_at" timestamptz(6),
  "reason" varchar(512) COLLATE "pg_catalog"."default",
  "operator_remark" text COLLATE "pg_catalog"."default",
  "created_by" uuid NOT NULL,
  "updated_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;

-- ----------------------------
-- Table structure for tenant_subscription_quota
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_subscription_quota";
CREATE TABLE "commerce"."tenant_subscription_quota" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "subscription_id" uuid,
  "max_users" int4 NOT NULL DEFAULT 10,
  "max_api_keys" int4 NOT NULL DEFAULT 5,
  "max_workflows" int4 NOT NULL DEFAULT 20,
  "max_concurrent" int4 NOT NULL DEFAULT 5,
  "rate_limit_per_minute" int4 NOT NULL DEFAULT 60,
  "period_tokens" int8 NOT NULL DEFAULT 1000000,
  "quota_cycle" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'monthly'::character varying,
  "allowed_models" text[] COLLATE "pg_catalog"."default" DEFAULT '{}'::text[],
  "allow_custom_model" bool NOT NULL DEFAULT false,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "effective_at" timestamptz(6) NOT NULL,
  "expires_at" timestamptz(6)
)
;
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."tenant_id" IS '关联的租户 ID';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."subscription_id" IS '关联的订阅 ID，NULL 表示平台手动配置';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."max_users" IS '最大坐席数';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."max_api_keys" IS '最大API数量';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."max_workflows" IS '最大工作流数量';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."max_concurrent" IS '最大当前链接数';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."rate_limit_per_minute" IS '每分钟限速';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."period_tokens" IS '周期内授权 token 总量，单位：token';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."quota_cycle" IS '配额周期：monthly=按月 | yearly=按年 | once=一次性';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."allowed_models" IS '允许使用的模型列表，空数组表示使用平台默认';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."allow_custom_model" IS '是否允许接入自部署模型';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."created_by" IS '创建人，NULL 表示系统自动生成';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."effective_at" IS '本条配置的生效时间';
COMMENT ON COLUMN "commerce"."tenant_subscription_quota"."expires_at" IS '到期时间，NULL 表示永久有效';
COMMENT ON TABLE "commerce"."tenant_subscription_quota" IS '订阅授权额度，纯静态配置，随订阅变更写入，不存消耗数据';

-- ----------------------------
-- Table structure for tenant_transaction
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_transaction";
CREATE TABLE "commerce"."tenant_transaction" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "bill_id" uuid,
  "transaction_no" varchar(64) COLLATE "pg_catalog"."default" NOT NULL,
  "trade_type" varchar(32) COLLATE "pg_catalog"."default" NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "currency" varchar(16) COLLATE "pg_catalog"."default" DEFAULT 'CNY'::character varying,
  "balance_before" numeric(12,2) NOT NULL,
  "balance_after" numeric(12,2) NOT NULL,
  "trade_status" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'success'::character varying,
  "related_no" varchar(128) COLLATE "pg_catalog"."default",
  "remark" varchar(512) COLLATE "pg_catalog"."default",
  "operator_id" uuid,
  "client_ip" varchar(64) COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL
)
;
COMMENT ON COLUMN "commerce"."tenant_transaction"."created_by" IS '创建人：关联 platform_admin.id，系统自动创建则为 SYSTEM 用户ID';

-- ----------------------------
-- Table structure for tenant_usage_event
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_usage_event";
CREATE TABLE "commerce"."tenant_usage_event" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "feature_id" uuid NOT NULL,
  "user_id" uuid,
  "used_quota" int8 NOT NULL DEFAULT 0,
  "input_quota" int8 DEFAULT 0,
  "output_quota" int8 DEFAULT 0,
  "request_id" varchar(128) COLLATE "pg_catalog"."default",
  "business_id" varchar(128) COLLATE "pg_catalog"."default",
  "usage_type" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'normal'::character varying,
  "cycle_date" date NOT NULL,
  "cycle_month" varchar(8) COLLATE "pg_catalog"."default" NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "model_code" varchar(64) COLLATE "pg_catalog"."default",
  "latency_ms" int4
)
;
COMMENT ON COLUMN "commerce"."tenant_usage_event"."user_id" IS '操作用户，NULL 表示系统/API Key 调用';
COMMENT ON COLUMN "commerce"."tenant_usage_event"."used_quota" IS '本次总消耗 token 数，恒等于 input_quota + output_quota，CHECK 约束保证一致性';
COMMENT ON COLUMN "commerce"."tenant_usage_event"."input_quota" IS '输入 token 数（Prompt tokens）';
COMMENT ON COLUMN "commerce"."tenant_usage_event"."output_quota" IS '输出 token 数（Completion tokens）';
COMMENT ON COLUMN "commerce"."tenant_usage_event"."request_id" IS '请求唯一 ID，用于去重和追踪';
COMMENT ON COLUMN "commerce"."tenant_usage_event"."business_id" IS '业务侧幂等 ID，防止重复计费';
COMMENT ON COLUMN "commerce"."tenant_usage_event"."usage_type" IS 'normal=正常调用 | retry=重试 | test=测试';
COMMENT ON COLUMN "commerce"."tenant_usage_event"."cycle_date" IS '消耗自然日，冗余存储便于按天聚合';
COMMENT ON COLUMN "commerce"."tenant_usage_event"."cycle_month" IS '消耗自然月 YYYYMM，冗余存储便于按月聚合';
COMMENT ON COLUMN "commerce"."tenant_usage_event"."model_code" IS '实际调用的模型标识，如 claude-sonnet-4-6，用于按模型维度计费';
COMMENT ON COLUMN "commerce"."tenant_usage_event"."latency_ms" IS '本次请求端到端耗时（毫秒），用于 SLA 分析和异常检测，超时或系统调用可为 NULL';
COMMENT ON TABLE "commerce"."tenant_usage_event" IS '消耗明细流水，每次 API 调用追加，不更新不删除';

-- ----------------------------
-- Table structure for tenant_usage_summary
-- ----------------------------
DROP TABLE IF EXISTS "commerce"."tenant_usage_summary";
CREATE TABLE "commerce"."tenant_usage_summary" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "feature_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  "agent_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  "cycle_month" varchar(8) COLLATE "pg_catalog"."default" NOT NULL,
  "total_quota" int8 NOT NULL DEFAULT 0,
  "input_quota" int8 NOT NULL DEFAULT 0,
  "output_quota" int8 NOT NULL DEFAULT 0,
  "request_count" int8 NOT NULL DEFAULT 0,
  "last_synced_at" timestamptz(6) NOT NULL DEFAULT now(),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "stat_type" varchar(16) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'detail'::character varying
)
;
COMMENT ON COLUMN "commerce"."tenant_usage_summary"."feature_id" IS '关联 feature，00000000-...-0000 为哨兵值表示全部 feature 的汇总行';
COMMENT ON COLUMN "commerce"."tenant_usage_summary"."agent_id" IS '关联 agent，00000000-...-0000 为哨兵值表示全部 agent 的汇总行';
COMMENT ON COLUMN "commerce"."tenant_usage_summary"."total_quota" IS '周期内累计消耗 token 总量';
COMMENT ON COLUMN "commerce"."tenant_usage_summary"."input_quota" IS '周期内累计输入 token 数（Prompt tokens）';
COMMENT ON COLUMN "commerce"."tenant_usage_summary"."output_quota" IS '周期内累计输出 token 数（Completion tokens）';
COMMENT ON COLUMN "commerce"."tenant_usage_summary"."request_count" IS '周期内累计请求次数';
COMMENT ON COLUMN "commerce"."tenant_usage_summary"."last_synced_at" IS '最后一次从 usage 流水聚合的时间，用于增量同步';
COMMENT ON COLUMN "commerce"."tenant_usage_summary"."stat_type" IS 'detail=按 agent+feature 细分行 | summary=租户级周期汇总行（超额检查读此行）';
COMMENT ON TABLE "commerce"."tenant_usage_summary" IS '周期聚合统计缓存，由异步任务从 usage 流水聚合，超额检查和 Dashboard 读此表';

-- ----------------------------
-- Function structure for set_updated_at
-- ----------------------------
DROP FUNCTION IF EXISTS "commerce"."set_updated_at"();
CREATE FUNCTION "commerce"."set_updated_at"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Indexes structure for table tenant_invoice
-- ----------------------------
CREATE INDEX "idx_tenant_bill_tenant_cycle" ON "commerce"."tenant_invoice" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "bill_cycle" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ti_cycle" ON "commerce"."tenant_invoice" USING btree (
  "bill_cycle" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ti_deleted_at" ON "commerce"."tenant_invoice" USING btree (
  "deleted_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ti_invoice_no" ON "commerce"."tenant_invoice" USING btree (
  "bill_no" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ti_status" ON "commerce"."tenant_invoice" USING btree (
  "bill_status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ti_tenant_id" ON "commerce"."tenant_invoice" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table tenant_invoice
-- ----------------------------
CREATE TRIGGER "trg_tenant_invoice_updated" BEFORE UPDATE ON "commerce"."tenant_invoice"
FOR EACH ROW
EXECUTE PROCEDURE "tenancy"."set_updated_at"();

-- ----------------------------
-- Uniques structure for table tenant_invoice
-- ----------------------------
ALTER TABLE "commerce"."tenant_invoice" ADD CONSTRAINT "tenant_bill_bill_no_key" UNIQUE ("bill_no");

-- ----------------------------
-- Checks structure for table tenant_invoice
-- ----------------------------
ALTER TABLE "commerce"."tenant_invoice" ADD CONSTRAINT "chk_tb_status" CHECK (bill_status::text = ANY (ARRAY['unpaid'::character varying, 'paying'::character varying, 'paid'::character varying, 'partial'::character varying, 'cancelled'::character varying, 'overdue'::character varying]::text[]));

-- ----------------------------
-- Primary Key structure for table tenant_invoice
-- ----------------------------
ALTER TABLE "commerce"."tenant_invoice" ADD CONSTRAINT "tenant_bill_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tenant_invoice_item
-- ----------------------------
CREATE INDEX "idx_tii_agent_id" ON "commerce"."tenant_invoice_item" USING btree (
  "agent_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tii_deleted_at" ON "commerce"."tenant_invoice_item" USING btree (
  "deleted_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tii_invoice_id" ON "commerce"."tenant_invoice_item" USING btree (
  "bill_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tii_item_type" ON "commerce"."tenant_invoice_item" USING btree (
  "item_type" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tii_tenant_id" ON "commerce"."tenant_invoice_item" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table tenant_invoice_item
-- ----------------------------
CREATE TRIGGER "trg_tenant_invoice_item_updated" BEFORE UPDATE ON "commerce"."tenant_invoice_item"
FOR EACH ROW
EXECUTE PROCEDURE "tenancy"."set_updated_at"();

-- ----------------------------
-- Primary Key structure for table tenant_invoice_item
-- ----------------------------
ALTER TABLE "commerce"."tenant_invoice_item" ADD CONSTRAINT "tenant_bill_item_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tenant_invoice_receipt
-- ----------------------------
CREATE INDEX "idx_tbi_invoice_no" ON "commerce"."tenant_invoice_receipt" USING btree (
  "invoice_no" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tbi_invoice_status" ON "commerce"."tenant_invoice_receipt" USING btree (
  "invoice_status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table tenant_invoice_receipt
-- ----------------------------
CREATE TRIGGER "trg_tenant_invoice_receipt_updated" BEFORE UPDATE ON "commerce"."tenant_invoice_receipt"
FOR EACH ROW
EXECUTE PROCEDURE "tenancy"."set_updated_at"();

-- ----------------------------
-- Uniques structure for table tenant_invoice_receipt
-- ----------------------------
ALTER TABLE "commerce"."tenant_invoice_receipt" ADD CONSTRAINT "tenant_bill_invoice_invoice_no_key" UNIQUE ("invoice_no");

-- ----------------------------
-- Checks structure for table tenant_invoice_receipt
-- ----------------------------
ALTER TABLE "commerce"."tenant_invoice_receipt" ADD CONSTRAINT "chk_tbi_status" CHECK (invoice_status::text = ANY (ARRAY['applying'::character varying, 'auditing'::character varying, 'issued'::character varying, 'sending'::character varying, 'finished'::character varying, 'rejected'::character varying, 'red'::character varying]::text[]));

-- ----------------------------
-- Primary Key structure for table tenant_invoice_receipt
-- ----------------------------
ALTER TABLE "commerce"."tenant_invoice_receipt" ADD CONSTRAINT "tenant_bill_invoice_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tenant_payment
-- ----------------------------
CREATE INDEX "idx_tp_invoice_id" ON "commerce"."tenant_payment" USING btree (
  "bill_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tp_pay_order_no" ON "commerce"."tenant_payment" USING btree (
  "pay_order_no" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tp_pay_status" ON "commerce"."tenant_payment" USING btree (
  "pay_status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tp_tenant_id" ON "commerce"."tenant_payment" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table tenant_payment
-- ----------------------------
CREATE TRIGGER "trg_tenant_payment_updated" BEFORE UPDATE ON "commerce"."tenant_payment"
FOR EACH ROW
EXECUTE PROCEDURE "tenancy"."set_updated_at"();

-- ----------------------------
-- Uniques structure for table tenant_payment
-- ----------------------------
ALTER TABLE "commerce"."tenant_payment" ADD CONSTRAINT "tenant_bill_payment_pay_order_no_key" UNIQUE ("pay_order_no");

-- ----------------------------
-- Checks structure for table tenant_payment
-- ----------------------------
ALTER TABLE "commerce"."tenant_payment" ADD CONSTRAINT "chk_tbp_status" CHECK (pay_status::text = ANY (ARRAY['pending'::character varying, 'pending_verify'::character varying, 'paid'::character varying, 'failed'::character varying, 'closed'::character varying, 'refunding'::character varying]::text[]));
ALTER TABLE "commerce"."tenant_payment" ADD CONSTRAINT "chk_tbp_offline" CHECK (offline_pay_type IS NULL OR (offline_pay_type::text = ANY (ARRAY['bank_transfer'::character varying, 'cash'::character varying, 'other'::character varying]::text[])));
ALTER TABLE "commerce"."tenant_payment" ADD CONSTRAINT "chk_tbp_source" CHECK (pay_source::text = ANY (ARRAY['online'::character varying, 'offline'::character varying]::text[]));

-- ----------------------------
-- Primary Key structure for table tenant_payment
-- ----------------------------
ALTER TABLE "commerce"."tenant_payment" ADD CONSTRAINT "tenant_bill_payment_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tenant_refund
-- ----------------------------
CREATE INDEX "idx_tr_audit_status" ON "commerce"."tenant_refund" USING btree (
  "audit_status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tr_refund_no" ON "commerce"."tenant_refund" USING btree (
  "refund_no" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tr_tenant_id" ON "commerce"."tenant_refund" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table tenant_refund
-- ----------------------------
CREATE TRIGGER "trg_tenant_refund_updated" BEFORE UPDATE ON "commerce"."tenant_refund"
FOR EACH ROW
EXECUTE PROCEDURE "tenancy"."set_updated_at"();

-- ----------------------------
-- Uniques structure for table tenant_refund
-- ----------------------------
ALTER TABLE "commerce"."tenant_refund" ADD CONSTRAINT "tenant_bill_refund_refund_no_key" UNIQUE ("refund_no");

-- ----------------------------
-- Checks structure for table tenant_refund
-- ----------------------------
ALTER TABLE "commerce"."tenant_refund" ADD CONSTRAINT "chk_tbr_audit" CHECK (audit_status::text = ANY (ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying]::text[]));
ALTER TABLE "commerce"."tenant_refund" ADD CONSTRAINT "chk_tbr_status" CHECK (refund_status::text = ANY (ARRAY['pending'::character varying, 'processing'::character varying, 'success'::character varying, 'failed'::character varying]::text[]));

-- ----------------------------
-- Primary Key structure for table tenant_refund
-- ----------------------------
ALTER TABLE "commerce"."tenant_refund" ADD CONSTRAINT "tenant_bill_refund_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tenant_subscription
-- ----------------------------
CREATE INDEX "idx_ts_deleted_at" ON "commerce"."tenant_subscription" USING btree (
  "deleted_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ts_end_at" ON "commerce"."tenant_subscription" USING btree (
  "end_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ts_plan_id" ON "commerce"."tenant_subscription" USING btree (
  "plan_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ts_status" ON "commerce"."tenant_subscription" USING btree (
  "status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ts_tenant_id" ON "commerce"."tenant_subscription" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table tenant_subscription
-- ----------------------------
CREATE TRIGGER "trg_tenant_subscription_updated" BEFORE UPDATE ON "commerce"."tenant_subscription"
FOR EACH ROW
EXECUTE PROCEDURE "tenancy"."set_updated_at"();

-- ----------------------------
-- Checks structure for table tenant_subscription
-- ----------------------------
ALTER TABLE "commerce"."tenant_subscription" ADD CONSTRAINT "chk_ts_status" CHECK (status::text = ANY (ARRAY['active'::character varying, 'expired'::character varying, 'suspended'::character varying, 'cancelled'::character varying, 'trial'::character varying]::text[]));
ALTER TABLE "commerce"."tenant_subscription" ADD CONSTRAINT "chk_ts_cycle" CHECK (cycle_type::text = ANY (ARRAY['monthly'::character varying, 'yearly'::character varying, 'once'::character varying]::text[]));

-- ----------------------------
-- Primary Key structure for table tenant_subscription
-- ----------------------------
ALTER TABLE "commerce"."tenant_subscription" ADD CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tenant_subscription_history
-- ----------------------------
CREATE INDEX "idx_tscl_change_type" ON "commerce"."tenant_subscription_history" USING btree (
  "change_type" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tscl_created_at" ON "commerce"."tenant_subscription_history" USING btree (
  "created_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tscl_subscription_id" ON "commerce"."tenant_subscription_history" USING btree (
  "subscription_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tscl_tenant_id" ON "commerce"."tenant_subscription_history" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table tenant_subscription_history
-- ----------------------------
CREATE TRIGGER "trg_tenant_sub_change_log_updated" BEFORE UPDATE ON "commerce"."tenant_subscription_history"
FOR EACH ROW
EXECUTE PROCEDURE "tenancy"."set_updated_at"();

-- ----------------------------
-- Primary Key structure for table tenant_subscription_history
-- ----------------------------
ALTER TABLE "commerce"."tenant_subscription_history" ADD CONSTRAINT "tenant_sub_change_logs_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tenant_subscription_override
-- ----------------------------
CREATE INDEX "idx_tsc_agent_id" ON "commerce"."tenant_subscription_override" USING btree (
  "agent_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tsc_deleted_at" ON "commerce"."tenant_subscription_override" USING btree (
  "deleted_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tsc_feature_id" ON "commerce"."tenant_subscription_override" USING btree (
  "feature_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tsc_is_enabled" ON "commerce"."tenant_subscription_override" USING btree (
  "is_enabled" "pg_catalog"."bool_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tsc_tenant_id" ON "commerce"."tenant_subscription_override" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table tenant_subscription_override
-- ----------------------------
CREATE TRIGGER "trg_tenant_sub_custom_updated" BEFORE UPDATE ON "commerce"."tenant_subscription_override"
FOR EACH ROW
EXECUTE PROCEDURE "tenancy"."set_updated_at"();

-- ----------------------------
-- Uniques structure for table tenant_subscription_override
-- ----------------------------
ALTER TABLE "commerce"."tenant_subscription_override" ADD CONSTRAINT "tenant_sub_customs_tenant_id_agent_id_feature_id_key" UNIQUE ("tenant_id", "agent_id", "feature_id");

-- ----------------------------
-- Primary Key structure for table tenant_subscription_override
-- ----------------------------
ALTER TABLE "commerce"."tenant_subscription_override" ADD CONSTRAINT "tenant_sub_customs_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tenant_subscription_quota
-- ----------------------------
CREATE INDEX "idx_tsq_subscription_id" ON "commerce"."tenant_subscription_quota" USING btree (
  "subscription_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tsq_tenant_id" ON "commerce"."tenant_subscription_quota" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table tenant_subscription_quota
-- ----------------------------
CREATE TRIGGER "trg_tenant_subscription_quota_updated" BEFORE UPDATE ON "commerce"."tenant_subscription_quota"
FOR EACH ROW
EXECUTE PROCEDURE "commerce"."set_updated_at"();

-- ----------------------------
-- Uniques structure for table tenant_subscription_quota
-- ----------------------------
ALTER TABLE "commerce"."tenant_subscription_quota" ADD CONSTRAINT "tenant_sub_quota_tenant_id_key" UNIQUE ("tenant_id");

-- ----------------------------
-- Checks structure for table tenant_subscription_quota
-- ----------------------------
ALTER TABLE "commerce"."tenant_subscription_quota" ADD CONSTRAINT "chk_tsq_cycle" CHECK (quota_cycle::text = ANY (ARRAY['monthly'::character varying::text, 'yearly'::character varying::text, 'once'::character varying::text]));

-- ----------------------------
-- Primary Key structure for table tenant_subscription_quota
-- ----------------------------
ALTER TABLE "commerce"."tenant_subscription_quota" ADD CONSTRAINT "tenant_sub_quota_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tenant_transaction
-- ----------------------------
CREATE INDEX "idx_tt_tenant_id" ON "commerce"."tenant_transaction" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tt_trade_type" ON "commerce"."tenant_transaction" USING btree (
  "trade_type" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tt_transaction_no" ON "commerce"."tenant_transaction" USING btree (
  "transaction_no" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table tenant_transaction
-- ----------------------------
ALTER TABLE "commerce"."tenant_transaction" ADD CONSTRAINT "tenant_bill_transaction_transaction_no_key" UNIQUE ("transaction_no");

-- ----------------------------
-- Checks structure for table tenant_transaction
-- ----------------------------
ALTER TABLE "commerce"."tenant_transaction" ADD CONSTRAINT "chk_tbt_status" CHECK (trade_status::text = ANY (ARRAY['wait'::character varying, 'success'::character varying, 'fail'::character varying, 'closed'::character varying]::text[]));
ALTER TABLE "commerce"."tenant_transaction" ADD CONSTRAINT "chk_tbt_type" CHECK (trade_type::text = ANY (ARRAY['pay'::character varying, 'refund'::character varying, 'recharge'::character varying, 'deduct'::character varying, 'freeze'::character varying, 'unfreeze'::character varying]::text[]));

-- ----------------------------
-- Rules structure for table tenant_transaction
-- ----------------------------
CREATE RULE "tenant_bill_transaction_no_update" AS ON UPDATE TO "commerce"."tenant_transaction" DO INSTEAD NOTHING;;
CREATE RULE "tenant_bill_transaction_no_delete" AS ON DELETE TO "commerce"."tenant_transaction" DO INSTEAD NOTHING;;

-- ----------------------------
-- Primary Key structure for table tenant_transaction
-- ----------------------------
ALTER TABLE "commerce"."tenant_transaction" ADD CONSTRAINT "tenant_bill_transaction_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tenant_usage_event
-- ----------------------------
CREATE INDEX "idx_tue_agent_id" ON "commerce"."tenant_usage_event" USING btree (
  "agent_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tue_cycle_date" ON "commerce"."tenant_usage_event" USING btree (
  "cycle_date" "pg_catalog"."date_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tue_cycle_month" ON "commerce"."tenant_usage_event" USING btree (
  "cycle_month" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tue_feature_id" ON "commerce"."tenant_usage_event" USING btree (
  "feature_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tue_model_code" ON "commerce"."tenant_usage_event" USING btree (
  "model_code" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tue_request_id" ON "commerce"."tenant_usage_event" USING btree (
  "request_id" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tue_tenant_id" ON "commerce"."tenant_usage_event" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tue_tenant_month" ON "commerce"."tenant_usage_event" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "cycle_month" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tue_user_id" ON "commerce"."tenant_usage_event" USING btree (
  "user_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Checks structure for table tenant_usage_event
-- ----------------------------
ALTER TABLE "commerce"."tenant_usage_event" ADD CONSTRAINT "chk_tue_used_quota_sum" CHECK (used_quota = (COALESCE(input_quota, 0::bigint) + COALESCE(output_quota, 0::bigint)));
ALTER TABLE "commerce"."tenant_usage_event" ADD CONSTRAINT "chk_tsu_usage_type" CHECK (usage_type::text = ANY (ARRAY['normal'::character varying::text, 'retry'::character varying::text, 'test'::character varying::text]));

-- ----------------------------
-- Primary Key structure for table tenant_usage_event
-- ----------------------------
ALTER TABLE "commerce"."tenant_usage_event" ADD CONSTRAINT "tenant_sub_usage_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tenant_usage_summary
-- ----------------------------
CREATE INDEX "idx_tus_agent_id" ON "commerce"."tenant_usage_summary" USING btree (
  "agent_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tus_cycle_month" ON "commerce"."tenant_usage_summary" USING btree (
  "cycle_month" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tus_feature_id" ON "commerce"."tenant_usage_summary" USING btree (
  "feature_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tus_stat_type" ON "commerce"."tenant_usage_summary" USING btree (
  "stat_type" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tus_tenant_id" ON "commerce"."tenant_usage_summary" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_tus_tenant_month" ON "commerce"."tenant_usage_summary" USING btree (
  "tenant_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "cycle_month" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table tenant_usage_summary
-- ----------------------------
CREATE TRIGGER "trg_tenant_usage_summary_updated" BEFORE UPDATE ON "commerce"."tenant_usage_summary"
FOR EACH ROW
EXECUTE PROCEDURE "commerce"."set_updated_at"();

-- ----------------------------
-- Uniques structure for table tenant_usage_summary
-- ----------------------------
ALTER TABLE "commerce"."tenant_usage_summary" ADD CONSTRAINT "tenant_usage_summary_unique" UNIQUE ("tenant_id", "feature_id", "agent_id", "cycle_month", "stat_type");

-- ----------------------------
-- Checks structure for table tenant_usage_summary
-- ----------------------------
ALTER TABLE "commerce"."tenant_usage_summary" ADD CONSTRAINT "chk_tus_stat_type" CHECK (stat_type::text = ANY (ARRAY['detail'::character varying::text, 'summary'::character varying::text]));

-- ----------------------------
-- Primary Key structure for table tenant_usage_summary
-- ----------------------------
ALTER TABLE "commerce"."tenant_usage_summary" ADD CONSTRAINT "tenant_sub_usage_stat_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Foreign Keys structure for table tenant_invoice
-- ----------------------------
ALTER TABLE "commerce"."tenant_invoice" ADD CONSTRAINT "fk_tb_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenancy"."tenant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table tenant_invoice_item
-- ----------------------------
ALTER TABLE "commerce"."tenant_invoice_item" ADD CONSTRAINT "fk_tbi_bill" FOREIGN KEY ("bill_id") REFERENCES "commerce"."tenant_invoice" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "commerce"."tenant_invoice_item" ADD CONSTRAINT "fk_tbi_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenancy"."tenant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table tenant_invoice_receipt
-- ----------------------------
ALTER TABLE "commerce"."tenant_invoice_receipt" ADD CONSTRAINT "fk_tbi_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenancy"."tenant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table tenant_payment
-- ----------------------------
ALTER TABLE "commerce"."tenant_payment" ADD CONSTRAINT "fk_tbp_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenancy"."tenant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "commerce"."tenant_payment" ADD CONSTRAINT "fk_tenant_bill_payment_bill" FOREIGN KEY ("bill_id") REFERENCES "commerce"."tenant_invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------
-- Foreign Keys structure for table tenant_refund
-- ----------------------------
ALTER TABLE "commerce"."tenant_refund" ADD CONSTRAINT "fk_tbr_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenancy"."tenant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table tenant_subscription_history
-- ----------------------------
ALTER TABLE "commerce"."tenant_subscription_history" ADD CONSTRAINT "fk_tscl_sub" FOREIGN KEY ("subscription_id") REFERENCES "commerce"."tenant_subscription" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "commerce"."tenant_subscription_history" ADD CONSTRAINT "fk_tscl_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenancy"."tenant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table tenant_subscription_override
-- ----------------------------
ALTER TABLE "commerce"."tenant_subscription_override" ADD CONSTRAINT "fk_tsc_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenancy"."tenant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table tenant_transaction
-- ----------------------------
ALTER TABLE "commerce"."tenant_transaction" ADD CONSTRAINT "fk_tbt_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenancy"."tenant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
