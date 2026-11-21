-- Verify declared column permissions without DDL or temporary relations.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category deployment-verification
-- @author AI-Generated
-- @date 2026-11-22
\set ON_ERROR_STOP on

-- The client reads only the mounted policy. Base64 preserves SQL quotes and
-- line boundaries without requiring server-file access or temporary tables.
\set column_locks_base64 `base64 /ddl/98_column_locks.sql`
SET vx.column_locks_base64 = :'column_locks_base64';

-- ============================================================================
-- Compare both directions and reject a missing or unparseable policy.
-- ============================================================================
DO $$
DECLARE
  declared_n bigint;
  missing_txt text;
  extra_txt text;
BEGIN
  WITH lockfile_lines AS (
    SELECT regexp_split_to_table(
      convert_from(decode(current_setting('vx.column_locks_base64'), 'base64'), 'UTF8'),
      E'\r?\n') AS line
  ), declared_grants AS (
    SELECT tbl, col FROM (
      SELECT lower((regexp_match(line,
        'ON[[:space:]]+([a-z0-9_]+\.[a-z0-9_]+)[[:space:]]+TO[[:space:]]+platform_svc', 'i'))[1]) AS tbl,
        unnest(string_to_array(regexp_replace(
          (regexp_match(line, 'GRANT[[:space:]]+UPDATE[[:space:]]*\(([^)]*)\)', 'i'))[1],
          '[[:space:]]', '', 'g'), ',')) AS col
      FROM lockfile_lines
      WHERE line ~* '^[[:space:]]*GRANT[[:space:]]+UPDATE[[:space:]]*\('
    ) t WHERE tbl IS NOT NULL AND col <> ''
  ), actual_grants AS (
    SELECT table_schema || '.' || table_name AS tbl, column_name AS col
    FROM information_schema.column_privileges
    WHERE grantee = 'platform_svc' AND privilege_type = 'UPDATE'
  ), missing_grants AS (
    SELECT d.tbl || ': ' || string_agg(d.col, ', ' ORDER BY d.col) AS detail
    FROM declared_grants d
    LEFT JOIN actual_grants a ON a.tbl = d.tbl AND a.col = d.col
    WHERE a.col IS NULL GROUP BY d.tbl
  ), extra_grants AS (
    SELECT a.tbl || ': ' || string_agg(a.col, ', ' ORDER BY a.col) AS detail
    FROM actual_grants a
    LEFT JOIN declared_grants d ON d.tbl = a.tbl AND d.col = a.col
    WHERE d.col IS NULL
      AND EXISTS (SELECT 1 FROM declared_grants y WHERE y.tbl = a.tbl)
    GROUP BY a.tbl
  ) SELECT (SELECT count(*) FROM declared_grants),
      (SELECT string_agg(detail, E'\n  ' ORDER BY detail) FROM missing_grants),
      (SELECT string_agg(detail, E'\n  ' ORDER BY detail) FROM extra_grants)
    INTO declared_n, missing_txt, extra_txt;

  IF declared_n = 0 THEN
    RAISE EXCEPTION '[column-locks-drift] No declared column grants parsed; verification refused';
  END IF;
  IF missing_txt IS NOT NULL OR extra_txt IS NOT NULL THEN
    RAISE EXCEPTION E'[column-locks-drift] Column grants differ from 98_column_locks.sql.\n  Missing:\n  %\n  Extra:\n  %',
      coalesce(missing_txt, '(none)'), coalesce(extra_txt, '(none)');
  END IF;
  RAISE NOTICE '[column-locks-drift] OK: % declared column grants match the live catalog', declared_n;
END $$;
