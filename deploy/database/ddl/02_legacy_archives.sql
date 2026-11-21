-- Preserve the historical principal-number archive in both installation paths.
-- @package vxture-platform
-- @layer Infrastructure
-- @category ddl
-- @author AI-Generated
-- @date 2026-11-21
-- Fresh installations keep this archive empty. Upgrades retain the original rows.
-- The public schema survives the development reset runner; never replace its rows.
CREATE TABLE IF NOT EXISTS public.vx_principal_no_backup_v3 (
  entity varchar(16) NOT NULL,
  row_id uuid NOT NULL,
  old_no bigint NOT NULL,
  new_no bigint NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_vx_principal_no_backup_v3 PRIMARY KEY (entity, row_id)
);
DO $$
BEGIN
  IF (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull)
      ORDER BY a.attnum) FROM pg_attribute a
      WHERE a.attrelid='public.vx_principal_no_backup_v3'::regclass
        AND a.attnum>0 AND NOT a.attisdropped)
    IS DISTINCT FROM '[["entity","character varying(16)",true],
      ["row_id","uuid",true],["old_no","bigint",true],
      ["new_no","bigint",true],["migrated_at","timestamp with time zone",true]]'::jsonb
    OR NOT EXISTS (SELECT FROM pg_constraint
      WHERE conrelid='public.vx_principal_no_backup_v3'::regclass
        AND conname='pk_vx_principal_no_backup_v3' AND contype='p'
        AND pg_get_constraintdef(oid)='PRIMARY KEY (entity, row_id)') THEN
    RAISE EXCEPTION 'LEGACY_PRINCIPAL_ARCHIVE_STRUCTURE_DRIFT';
  END IF;
END $$;
