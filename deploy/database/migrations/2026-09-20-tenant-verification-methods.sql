-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 企业认证三种方式(owner 2026-09-06)
--
-- 认证从「一条轻量路径」扩成一条**方式轴**,与既有的主体轴(individual/enterprise)正交:
--   lite      简易企业实名认证 —— 企业名称 + 统一社会信用代码 + 法定代表人姓名
--                                 (可订阅,**不可开票**;本期唯一开放的方式)
--   face      法人扫脸实名认证 —— 开发中,页面占位禁用
--   documents 提交资料实名认证 —— 开发中,页面占位禁用
-- 两列:
--   kyc.tenant_verifications.verification_method  NOT NULL DEFAULT 'lite' + CHECK
--   kyc.tenant_verifications.company_name         申报的企业名称(方式一必填)
--
-- 存量:历史申请都走的就是简易路径 → method 保持 'lite'(DEFAULT 即落位);
-- company_name 从 tenancy.tenants.name 回填 **pending / verified 两态**——这两态的
-- 租户名此刻仍是当时申报并被核过的名字(改名即作废原认证,见 2026-09-13 迁移);
-- rejected / superseded 的当时申报名不可考,留空、页面显示「—」,不编。
--
-- 表在 98 列锁之下:两列都不是锚点(非 PK / 非 `_no` / 非 created_*),补进
-- platform_svc 的列级 GRANT(DDL 98 已同步)。
-- 幂等:整份可重跑。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE kyc.tenant_verifications
  ADD COLUMN IF NOT EXISTS verification_method varchar(32) NOT NULL DEFAULT 'lite';
ALTER TABLE kyc.tenant_verifications
  ADD COLUMN IF NOT EXISTS company_name varchar(128);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_tenant_verifications_method'
       AND conrelid = 'kyc.tenant_verifications'::regclass
  ) THEN
    ALTER TABLE kyc.tenant_verifications
      ADD CONSTRAINT chk_tenant_verifications_method
      CHECK (verification_method IN ('lite','face','documents'));
  END IF;
END $$;

-- 存量企业名称回填(只回填名字此刻仍然作数的两态;已回填过的不动)
UPDATE kyc.tenant_verifications v
   SET company_name = t.name
  FROM tenancy.tenants t
 WHERE t.id = v.tenant_id
   AND v.company_name IS NULL
   AND v.status IN ('pending', 'verified');

GRANT UPDATE (verification_method, company_name) ON kyc.tenant_verifications TO platform_svc;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema = 'kyc' AND table_name = 'tenant_verifications'
     AND column_name IN ('verification_method', 'company_name');
  IF v <> 2 THEN RAISE EXCEPTION '[verification-methods] 两个新列未就位(实到 %)', v; END IF;

  SELECT count(*) INTO v FROM pg_constraint
   WHERE conname = 'chk_tenant_verifications_method'
     AND conrelid = 'kyc.tenant_verifications'::regclass;
  IF v = 0 THEN RAISE EXCEPTION '[verification-methods] 方式 CHECK 未就位'; END IF;

  SELECT count(*) INTO v FROM information_schema.column_privileges
   WHERE table_schema = 'kyc' AND table_name = 'tenant_verifications'
     AND column_name IN ('verification_method', 'company_name')
     AND privilege_type = 'UPDATE' AND grantee = 'platform_svc';
  IF v <> 2 THEN RAISE EXCEPTION '[verification-methods] platform_svc 列级 UPDATE 未授全(实到 %)', v; END IF;

  SELECT count(*) INTO v FROM kyc.tenant_verifications
   WHERE verification_method NOT IN ('lite', 'face', 'documents');
  IF v > 0 THEN RAISE EXCEPTION '[verification-methods] 存在非法方式值 % 行', v; END IF;

  RAISE NOTICE '[verification-methods] verification_method(lite/face/documents)与 company_name 已就位,存量按 lite 落位、企业名称已回填,列级 UPDATE 已授';
END $$;

COMMIT;
