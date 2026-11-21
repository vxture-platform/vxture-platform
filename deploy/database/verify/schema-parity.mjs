/**
 * schema-parity.mjs - Compare actual installation and upgrade catalogs.
 * @package vxture-platform
 * @layer Infrastructure
 * @category release-verification
 * @author AI-Generated
 * @date 2026-11-21
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ===========================================================================
// Normalize only builtin varchar literals in an explicitly text-valued ANY test.
// Other casts, expressions, names, predicates and constraint flags remain exact.
// ===========================================================================
function definition(value) {
  return value.replace(
    /(::text = ANY \(ARRAY\[)((?:'[^']*'::character varying(?:::text)?(?:, )?)+)(\](?:::text\[\])?\))/g,
    (_match, before, literals, after) =>
      before +
      literals.replace(/::character varying(?:::text)?/g, "::text") +
      after.replace("::text[]", ""),
  );
}

function normalized(key, value) {
  if (
    value &&
    /^(constraint|index):/.test(key) &&
    typeof value.definition === "string"
  )
    return { ...value, definition: definition(value.definition) };
  return value;
}

function equal(left, right) {
  try {
    assert.deepEqual(left, right);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compare catalogs without permitting unexpected objects or arbitrary renames.
 * @param {Record<string, unknown>} actual - Migrated catalog.
 * @param {Record<string, unknown>} expected - Clean-install catalog.
 * @returns {{equivalent: boolean, differences: object[], correspondences: object[]}}
 *   Exact differences and the narrowly proven representation correspondences.
 * @throws {Error} When a catalog is absent or malformed.
 */
export function compareSchemaCatalogs(actual, expected) {
  assert.ok(
    actual && expected && !Array.isArray(actual) && !Array.isArray(expected),
  );
  assert.equal(typeof actual, "object");
  assert.equal(typeof expected, "object");
  assert.ok(Object.keys(actual).length && Object.keys(expected).length);
  const mapped = { ...actual };
  const correspondences = [];
  for (const table of ["account.user_profiles", "tenancy.tenant_contacts"]) {
    const name = table.split(".")[1];
    const oldKey = `constraint:${table}.chk_${name}_gender`;
    const newKey = `constraint:${table}.${name}_gender_check`;
    if (
      Object.hasOwn(mapped, oldKey) &&
      !Object.hasOwn(mapped, newKey) &&
      !Object.hasOwn(expected, oldKey) &&
      Object.hasOwn(expected, newKey) &&
      equal(
        normalized(oldKey, mapped[oldKey]),
        normalized(newKey, expected[newKey]),
      )
    ) {
      mapped[newKey] = mapped[oldKey];
      delete mapped[oldKey];
      correspondences.push({
        actual: oldKey,
        expected: newKey,
        reason: "exact-gender-constraint-definition-and-flags",
      });
    }
  }
  const differences = [];
  for (const key of [
    ...new Set([...Object.keys(mapped), ...Object.keys(expected)]),
  ].sort()) {
    const found = Object.hasOwn(mapped, key);
    const wanted = Object.hasOwn(expected, key);
    if (found && wanted && equal(mapped[key], expected[key])) continue;
    if (
      found &&
      wanted &&
      equal(normalized(key, mapped[key]), normalized(key, expected[key]))
    ) {
      correspondences.push({
        actual: key,
        expected: key,
        reason: "builtin-varchar-literal-text-membership",
      });
      continue;
    }
    differences.push({
      object: key,
      actual: found ? mapped[key] : null,
      expected: wanted ? expected[key] : null,
    });
  }
  return { equivalent: differences.length === 0, differences, correspondences };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  assert.equal(
    process.argv.length,
    4,
    "Usage: node schema-parity.mjs migrated.json canonical.json",
  );
  const read = (file) => JSON.parse(readFileSync(file, "utf8"));
  const result = compareSchemaCatalogs(
    read(process.argv[2]),
    read(process.argv[3]),
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.equivalent) process.exitCode = 1;
}

// ===========================================================================
// Actual structure and effective application grants; no stored baseline shortcut.
// ===========================================================================
export const schemaCatalogSql = `-- Compare actual catalogs without treating a stored baseline hash as proof.
-- @package vxture-platform
-- @layer Infrastructure
-- @category release-verification
-- @author AI-Generated
-- @date 2026-11-21
SET search_path = pg_catalog;
SET TIME ZONE 'UTC';
WITH namespaces AS (
  SELECT oid,nspname FROM pg_namespace
  WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
), relations AS (
  SELECT c.*,n.nspname FROM pg_class c JOIN namespaces n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','S','f')
), records AS (
  SELECT 'schema:'||nspname key,jsonb_build_object('name',nspname) value FROM namespaces
  UNION ALL
  SELECT 'relation:'||nspname||'.'||relname,
    jsonb_build_object('kind',relkind,'persistence',relpersistence,'rls',relrowsecurity,
      'forceRls',relforcerowsecurity,'partition',relispartition,
      'partitionKey',CASE WHEN relkind='p' THEN pg_get_partkeydef(oid) END,
      'partitionBound',CASE WHEN relispartition THEN pg_get_expr(relpartbound,oid,true) END,
      'parents',(SELECT coalesce(jsonb_agg(pn.nspname||'.'||p.relname ORDER BY pn.nspname,p.relname),'[]')
        FROM pg_inherits i JOIN pg_class p ON p.oid=i.inhparent JOIN pg_namespace pn ON pn.oid=p.relnamespace WHERE i.inhrelid=r.oid))
    FROM relations r
  UNION ALL
  SELECT 'column:'||r.nspname||'.'||r.relname||'.'||a.attname,
    jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
      'default',pg_get_expr(d.adbin,d.adrelid,true),'identity',a.attidentity,'generated',a.attgenerated,
      'collation',CASE WHEN a.attcollation<>0 THEN a.attcollation::regcollation::text END)
    FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
    WHERE a.attnum>0 AND NOT a.attisdropped AND r.relkind<>'S'
  UNION ALL
  SELECT 'constraint:'||n.nspname||'.'||r.relname||'.'||c.conname,
    jsonb_build_object('type',c.contype,'definition',pg_get_constraintdef(c.oid,true),
      'deferrable',c.condeferrable,'deferred',c.condeferred,'validated',c.convalidated)
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN namespaces n ON n.oid=r.relnamespace
  UNION ALL
  SELECT 'index:'||n.nspname||'.'||c.relname,
    jsonb_build_object('definition',pg_get_indexdef(i.indexrelid,0,true),'unique',i.indisunique,
      'primary',i.indisprimary,'valid',i.indisvalid,'ready',i.indisready)
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN namespaces n ON n.oid=c.relnamespace
  UNION ALL
  SELECT 'trigger:'||n.nspname||'.'||r.relname||'.'||t.tgname,
    jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled)
    FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN namespaces n ON n.oid=r.relnamespace
    WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'routine:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    jsonb_build_object('definition',pg_get_functiondef(p.oid),'securityDefiner',p.prosecdef,
      'config',p.proconfig,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel)
    FROM pg_proc p JOIN namespaces n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')
      AND NOT EXISTS(SELECT FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
  UNION ALL
  SELECT 'view:'||nspname||'.'||relname,jsonb_build_object('definition',pg_get_viewdef(oid,true))
    FROM relations WHERE relkind IN ('v','m')
  UNION ALL
  SELECT 'sequence:'||r.nspname||'.'||r.relname,
    jsonb_build_object('type',format_type(s.seqtypid,NULL),'start',s.seqstart,'increment',s.seqincrement,
      'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle)
    FROM relations r JOIN pg_sequence s ON s.seqrelid=r.oid
  UNION ALL
  SELECT 'enum:'||n.nspname||'.'||t.typname,
    jsonb_build_object('labels',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid))
    FROM pg_type t JOIN namespaces n ON n.oid=t.typnamespace WHERE t.typtype='e'
  UNION ALL
  SELECT 'policy:'||n.nspname||'.'||c.relname||'.'||p.polname,
    jsonb_build_object('permissive',p.polpermissive,'command',p.polcmd,
      'roles',(SELECT jsonb_agg(CASE WHEN x=0 THEN 'public' ELSE pg_get_userbyid(x)::text END ORDER BY x) FROM unnest(p.polroles) x),
      'using',pg_get_expr(p.polqual,p.polrelid,true),'check',pg_get_expr(p.polwithcheck,p.polrelid,true))
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN namespaces n ON n.oid=c.relnamespace
  UNION ALL
  SELECT 'rights:'||role.rolname||':'||r.nspname||'.'||r.relname,
    jsonb_build_object('select',has_table_privilege(role.oid,r.oid,'SELECT'),
      'insert',has_table_privilege(role.oid,r.oid,'INSERT'),'update',has_table_privilege(role.oid,r.oid,'UPDATE'),
      'delete',has_table_privilege(role.oid,r.oid,'DELETE'),'truncate',has_table_privilege(role.oid,r.oid,'TRUNCATE'),
      'updateColumns',(SELECT coalesce(jsonb_agg(a.attname ORDER BY a.attname),'[]') FROM pg_attribute a
        WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(role.oid,r.oid,a.attnum,'UPDATE')))
    FROM relations r CROSS JOIN pg_roles role
    WHERE r.relkind IN ('r','p','v','m') AND r.nspname<>'public'
      AND role.rolname IN ('platform_svc','reporting_ro','svc_admin_bff','svc_console_bff','svc_platform_api','svc_auth_bff')
)
SELECT coalesce(jsonb_object_agg(key,value ORDER BY key),'{}') FROM records;
`;
