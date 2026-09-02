/*
 Navicat Premium Dump SQL

 Source Server         : mylocalhost-pg-develop
 Source Server Type    : PostgreSQL
 Source Server Version : 180003 (180003)
 Source Host           : localhost:5432
 Source Catalog        : vxture_beta
 Source Schema         : product

 Target Server Type    : PostgreSQL
 Target Server Version : 180003 (180003)
 File Encoding         : 65001

 Date: 21/04/2026 17:27:39
*/


-- ----------------------------
-- Table structure for agent
-- ----------------------------
DROP TABLE IF EXISTS "product"."agent";
CREATE TABLE "product"."agent" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "agent_code" varchar(64) COLLATE "pg_catalog"."default" NOT NULL,
  "agent_name" varchar(128) COLLATE "pg_catalog"."default" NOT NULL,
  "description" text COLLATE "pg_catalog"."default",
  "agent_type" varchar(32) COLLATE "pg_catalog"."default" DEFAULT 'chat'::character varying,
  "status" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'draft'::character varying,
  "visibility" varchar(32) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'public'::character varying,
  "agent_category" int4 DEFAULT 0,
  "tags" text[] COLLATE "pg_catalog"."default" DEFAULT '{}'::text[],
  "sort" int4 DEFAULT 0,
  "icon_url" varchar(512) COLLATE "pg_catalog"."default",
  "config_json" jsonb,
  "version" int4 NOT NULL DEFAULT 1,
  "created_by" uuid NOT NULL,
  "updated_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;

-- ----------------------------
-- Table structure for agent_feature
-- ----------------------------
DROP TABLE IF EXISTS "product"."agent_feature";
CREATE TABLE "product"."agent_feature" (
  "agent_id" uuid NOT NULL,
  "feature_id" uuid NOT NULL,
  "is_required" bool DEFAULT false,
  "status" bool DEFAULT true,
  "created_by" uuid NOT NULL,
  "updated_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;

-- ----------------------------
-- Table structure for feature
-- ----------------------------
DROP TABLE IF EXISTS "product"."feature";
CREATE TABLE "product"."feature" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "feature_code" varchar(128) COLLATE "pg_catalog"."default" NOT NULL,
  "feature_name" varchar(128) COLLATE "pg_catalog"."default" NOT NULL,
  "parent_code" varchar(128) COLLATE "pg_catalog"."default",
  "feature_type" varchar(32) COLLATE "pg_catalog"."default" DEFAULT 'function'::character varying,
  "description" text COLLATE "pg_catalog"."default",
  "status" bool DEFAULT true,
  "created_by" uuid NOT NULL,
  "updated_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;

-- ----------------------------
-- Table structure for plan
-- ----------------------------
DROP TABLE IF EXISTS "product"."plan";
CREATE TABLE "product"."plan" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "plan_code" varchar(64) COLLATE "pg_catalog"."default" NOT NULL,
  "plan_name" varchar(128) COLLATE "pg_catalog"."default" NOT NULL,
  "description" text COLLATE "pg_catalog"."default",
  "plan_type" varchar(32) COLLATE "pg_catalog"."default" DEFAULT 'normal'::character varying,
  "level" int4 DEFAULT 0,
  "is_free" bool DEFAULT false,
  "is_public" bool DEFAULT true,
  "status" bool DEFAULT true,
  "created_by" uuid NOT NULL,
  "updated_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;

-- ----------------------------
-- Table structure for plan_agent
-- ----------------------------
DROP TABLE IF EXISTS "product"."plan_agent";
CREATE TABLE "product"."plan_agent" (
  "plan_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "is_allowed" bool DEFAULT true,
  "created_by" uuid NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;

-- ----------------------------
-- Table structure for plan_feature
-- ----------------------------
DROP TABLE IF EXISTS "product"."plan_feature";
CREATE TABLE "product"."plan_feature" (
  "plan_id" uuid NOT NULL,
  "feature_id" uuid NOT NULL,
  "quota_value" int8 DEFAULT 0,
  "is_unlimited" bool DEFAULT false,
  "config_json" jsonb,
  "created_by" uuid NOT NULL,
  "updated_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;

-- ----------------------------
-- Table structure for plan_price
-- ----------------------------
DROP TABLE IF EXISTS "product"."plan_price";
CREATE TABLE "product"."plan_price" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" uuid NOT NULL,
  "price" numeric(12,2) NOT NULL,
  "original_price" numeric(12,2),
  "currency" varchar(10) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'CNY'::character varying,
  "period_type" varchar(20) COLLATE "pg_catalog"."default" NOT NULL,
  "period_value" int4 NOT NULL,
  "sort" int4 DEFAULT 100,
  "status" bool DEFAULT true,
  "is_default" bool DEFAULT false,
  "created_by" uuid,
  "updated_by" uuid,
  "deleted_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "deleted_at" timestamptz(6)
)
;

-- ----------------------------
-- Function structure for set_updated_at
-- ----------------------------
DROP FUNCTION IF EXISTS "product"."set_updated_at"();
CREATE FUNCTION "product"."set_updated_at"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Indexes structure for table agent
-- ----------------------------
CREATE INDEX "idx_agents_agent_category" ON "product"."agent" USING btree (
  "agent_category" "pg_catalog"."int4_ops" ASC NULLS LAST
);
CREATE INDEX "idx_agents_agent_code" ON "product"."agent" USING btree (
  "agent_code" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_agents_created_by" ON "product"."agent" USING btree (
  "created_by" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_agents_deleted_at" ON "product"."agent" USING btree (
  "deleted_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_agents_status" ON "product"."agent" USING btree (
  "status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_agents_visibility" ON "product"."agent" USING btree (
  "visibility" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table agent
-- ----------------------------
CREATE TRIGGER "trg_agent_updated" BEFORE UPDATE ON "product"."agent"
FOR EACH ROW
EXECUTE PROCEDURE "product"."set_updated_at"();

-- ----------------------------
-- Uniques structure for table agent
-- ----------------------------
ALTER TABLE "product"."agent" ADD CONSTRAINT "agent_code_key" UNIQUE ("agent_code");

-- ----------------------------
-- Checks structure for table agent
-- ----------------------------
ALTER TABLE "product"."agent" ADD CONSTRAINT "chk_agent_status" CHECK (status::text = ANY (ARRAY['draft'::character varying, 'active'::character varying, 'disabled'::character varying, 'archived'::character varying]::text[]));
ALTER TABLE "product"."agent" ADD CONSTRAINT "chk_agent_visibility" CHECK (visibility::text = ANY (ARRAY['public'::character varying, 'private'::character varying, 'internal'::character varying]::text[]));

-- ----------------------------
-- Primary Key structure for table agent
-- ----------------------------
ALTER TABLE "product"."agent" ADD CONSTRAINT "agent_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table agent_feature
-- ----------------------------
CREATE INDEX "idx_paf_agent_id" ON "product"."agent_feature" USING btree (
  "agent_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_paf_deleted_at" ON "product"."agent_feature" USING btree (
  "deleted_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_paf_feature_id" ON "product"."agent_feature" USING btree (
  "feature_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table agent_feature
-- ----------------------------
CREATE TRIGGER "trg_agent_feature_updated" BEFORE UPDATE ON "product"."agent_feature"
FOR EACH ROW
EXECUTE PROCEDURE "product"."set_updated_at"();

-- ----------------------------
-- Primary Key structure for table agent_feature
-- ----------------------------
ALTER TABLE "product"."agent_feature" ADD CONSTRAINT "agent_feature_pkey" PRIMARY KEY ("agent_id", "feature_id");

-- ----------------------------
-- Indexes structure for table feature
-- ----------------------------
CREATE INDEX "idx_features_deleted_at" ON "product"."feature" USING btree (
  "deleted_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_features_feature_code" ON "product"."feature" USING btree (
  "feature_code" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_features_parent_code" ON "product"."feature" USING btree (
  "parent_code" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table feature
-- ----------------------------
CREATE TRIGGER "trg_feature_updated" BEFORE UPDATE ON "product"."feature"
FOR EACH ROW
EXECUTE PROCEDURE "product"."set_updated_at"();

-- ----------------------------
-- Uniques structure for table feature
-- ----------------------------
ALTER TABLE "product"."feature" ADD CONSTRAINT "feature_code_key" UNIQUE ("feature_code");

-- ----------------------------
-- Primary Key structure for table feature
-- ----------------------------
ALTER TABLE "product"."feature" ADD CONSTRAINT "feature_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table plan
-- ----------------------------
CREATE INDEX "idx_plans_deleted_at" ON "product"."plan" USING btree (
  "deleted_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_plans_plan_code" ON "product"."plan" USING btree (
  "plan_code" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_plans_status" ON "product"."plan" USING btree (
  "status" "pg_catalog"."bool_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table plan
-- ----------------------------
CREATE TRIGGER "trg_plan_updated" BEFORE UPDATE ON "product"."plan"
FOR EACH ROW
EXECUTE PROCEDURE "product"."set_updated_at"();

-- ----------------------------
-- Uniques structure for table plan
-- ----------------------------
ALTER TABLE "product"."plan" ADD CONSTRAINT "plan_code_key" UNIQUE ("plan_code");

-- ----------------------------
-- Primary Key structure for table plan
-- ----------------------------
ALTER TABLE "product"."plan" ADD CONSTRAINT "plan_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table plan_agent
-- ----------------------------
CREATE INDEX "idx_ppa_agent_id" ON "product"."plan_agent" USING btree (
  "agent_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ppa_deleted_at" ON "product"."plan_agent" USING btree (
  "deleted_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ppa_plan_id" ON "product"."plan_agent" USING btree (
  "plan_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Primary Key structure for table plan_agent
-- ----------------------------
ALTER TABLE "product"."plan_agent" ADD CONSTRAINT "plan_agent_pkey" PRIMARY KEY ("agent_id", "plan_id");

-- ----------------------------
-- Indexes structure for table plan_feature
-- ----------------------------
CREATE INDEX "idx_ppf_deleted_at" ON "product"."plan_feature" USING btree (
  "deleted_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ppf_feature_id" ON "product"."plan_feature" USING btree (
  "feature_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ppf_plan_id" ON "product"."plan_feature" USING btree (
  "plan_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table plan_feature
-- ----------------------------
CREATE TRIGGER "trg_plan_feature_updated" BEFORE UPDATE ON "product"."plan_feature"
FOR EACH ROW
EXECUTE PROCEDURE "product"."set_updated_at"();

-- ----------------------------
-- Primary Key structure for table plan_feature
-- ----------------------------
ALTER TABLE "product"."plan_feature" ADD CONSTRAINT "plan_feature_pkey" PRIMARY KEY ("plan_id", "feature_id");

-- ----------------------------
-- Indexes structure for table plan_price
-- ----------------------------
CREATE INDEX "idx_plan_price_deleted" ON "product"."plan_price" USING btree (
  "deleted_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_plan_price_plan_id" ON "product"."plan_price" USING btree (
  "plan_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_plan_price_status" ON "product"."plan_price" USING btree (
  "status" "pg_catalog"."bool_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table plan_price
-- ----------------------------
CREATE TRIGGER "trg_plan_price_updated" BEFORE UPDATE ON "product"."plan_price"
FOR EACH ROW
EXECUTE PROCEDURE "product"."set_updated_at"();

-- ----------------------------
-- Uniques structure for table plan_price
-- ----------------------------
ALTER TABLE "product"."plan_price" ADD CONSTRAINT "uk_plan_price_period" UNIQUE ("plan_id", "period_type", "deleted_at");

-- ----------------------------
-- Primary Key structure for table plan_price
-- ----------------------------
ALTER TABLE "product"."plan_price" ADD CONSTRAINT "plan_price_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Foreign Keys structure for table agent_feature
-- ----------------------------
ALTER TABLE "product"."agent_feature" ADD CONSTRAINT "fk_paf_agent" FOREIGN KEY ("agent_id") REFERENCES "product"."agent" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "product"."agent_feature" ADD CONSTRAINT "fk_paf_feature" FOREIGN KEY ("feature_id") REFERENCES "product"."feature" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table plan_agent
-- ----------------------------
ALTER TABLE "product"."plan_agent" ADD CONSTRAINT "fk_ppa_agent" FOREIGN KEY ("agent_id") REFERENCES "product"."agent" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "product"."plan_agent" ADD CONSTRAINT "fk_ppa_plan" FOREIGN KEY ("plan_id") REFERENCES "product"."plan" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table plan_feature
-- ----------------------------
ALTER TABLE "product"."plan_feature" ADD CONSTRAINT "fk_ppf_feature" FOREIGN KEY ("feature_id") REFERENCES "product"."feature" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "product"."plan_feature" ADD CONSTRAINT "fk_ppf_plan" FOREIGN KEY ("plan_id") REFERENCES "product"."plan" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table plan_price
-- ----------------------------
ALTER TABLE "product"."plan_price" ADD CONSTRAINT "plan_price_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "product"."plan" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
