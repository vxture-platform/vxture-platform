#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-product-layer-family.mjs —— 分层蕴含类型族，五处同一张真值表（决策 3，owner 2026-10-04）
//
// ── 补的是哪个盲区 ──
// 「分层」此前在库里有三份编码（layer 列 / product_type 后缀族 / category_id），彼此没有任何
// 机械链路，于是 layer='L3' + product_type='general_platform' 库照收，admin 的绑定门、官网的
// 分区与详情页各读各的。现在裁定 **layer 是定位轴的唯一权威，类型族由它蕴含**：
//   L2 ⇒ *_platform，L3 ⇒ *_agent，`undefined` 型（占位）与任何层相容。
// 这条规矩写在五处，本守卫把它们钉成一张表：
//   ① deploy/database/ddl/40_product.sql           CONSTRAINT chk_products_layer_type_family CHECK (P)
//   ② deploy/database/migrations/2026-12-01-l3-layer-truth.sql   ADD CONSTRAINT … CHECK (P)，并以 NOT (P) 点名矛盾行
//   ③ deploy/database/seed/seed-catalog.mjs         PRODUCTS 里每一行的 type ↔ layer
//   ④ deploy/database/seed/seed-demo.mjs            DEMO_PRODUCTS 同上（本地联调预置的 L3）
//   ⑤ packages/core/utils/src/product-taxonomy.ts   PRODUCT_TYPE_DEFS：每个受管类型的 family
//
// ── 判据 ──
//   A. ①②的谓词 P **逐字相同**，①是单行（lint:column-locks 的解析器按行读）。②里 `NOT (P)` 至少
//      出现两次（审计段 + 停手段）——M3 会拒的行没有一条逃得过 M2 的点名，前提是两处同形。
//   B. ③④每一行：没给 layer 放行（umbra）；type 为 undefined 放行；否则 L2 必须 platform 族、
//      L3 必须 agent 族（归族按后缀，与 productTypeFamily 同判）。
//   C. ⑤里 family 为 "undefined" 的值**恰好只有 "undefined" 这一个**：新增一个既非 _platform 也非
//      _agent 的类型时红，逼人决定它蕴含哪一层（第一次运行就绿，不是「将来才红」）。并且每个值
//      声明的 family 与后缀推出来的一致——DDL 只认后缀，TS 表另说一套就是两处权威。
//   D. 自述一致：①②④与 docs/**/*.md 里凡提到本守卫，不得写一个根 package.json 没有的 pnpm 别名
//      `lint:product-layer-family`——第一版七处都这么写，读者照着跑是 Command not found。
//      哪天真加了这条 script，本段自动放行。
//
// ── 看不见什么 ──
//   · 不读库。运营手工登记的行（tenderforge / yucer 与十余个智能体）在生产库里，它们的对齐
//     由迁移 M0 审计 + M2 停手负责，不在这里。
//   · 不判 origin / category_id——前者是另一根正交轴，后者待退役（PR B）。
//   · 只扫 seed 里写成字面量对象的两张表（PRODUCTS / DEMO_PRODUCTS）；别处 insert 产品的代码不认。
//
// 用法：node scripts/guardrails/check-product-layer-family.mjs
//       node scripts/guardrails/check-product-layer-family.mjs --self-test
//   不走根 package.json 的 lint:* 入口（改根 package.json 触发全栈 14 镜像重建），
//   在 .github/workflows/ci.yml 里直接 `node` 跑。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(resolve(root, p), "utf8");

const DDL = "deploy/database/ddl/40_product.sql";
const MIGRATION = "deploy/database/migrations/2026-12-01-l3-layer-truth.sql";
const SEED_CATALOG = "deploy/database/seed/seed-catalog.mjs";
const SEED_DEMO = "deploy/database/seed/seed-demo.mjs";
const TAXONOMY = "packages/core/utils/src/product-taxonomy.ts";
const CONSTRAINT = "chk_products_layer_type_family";
const PACKAGE_JSON = "package.json";
const DOCS_DIR = "docs";
/** 本守卫若有 pnpm 别名会叫这个名；今天没有（头注说明为什么），所以哪里写了它哪里就是错话。 */
const ALIAS = "lint:product-layer-family";

/** 与 @vxture/core-utils productTypeFamily 同判（SQL 不能 import TS，这里是那条链路的抄本）。 */
function familyOf(type) {
  if (type.endsWith("_platform")) return "platform";
  if (type === "agent" || type.endsWith("_agent")) return "agent";
  return "undefined";
}

/** 分层 ↔ 类型族相容？与 DDL 的 P 同一张真值表（活行视角：deleted_at 支不在 seed 里）。 */
function compatible(layer, type) {
  if (layer === null || layer === undefined) return true;
  if (type === "undefined") return true;
  const family = familyOf(type);
  return (
    (layer === "L2" && family === "platform") ||
    (layer === "L3" && family === "agent")
  );
}

/**
 * 从 `CHECK (` 起按括号配平取出谓词文本；返回 null = 这一行上没配平（约束被拆成多行）。
 */
function predicateOnLine(line, marker) {
  const at = line.indexOf(marker);
  if (at < 0) return null;
  const open = at + marker.length - 1; // 指向 `(`
  let depth = 0;
  for (let i = open; i < line.length; i += 1) {
    if (line[i] === "(") depth += 1;
    else if (line[i] === ")") {
      depth -= 1;
      if (depth === 0) return line.slice(open + 1, i);
    }
  }
  return null;
}

/** DDL：找 `CONSTRAINT <name> CHECK (` 所在行，取 P。 */
function ddlPredicate(src) {
  const line = src.split("\n").find((l) => l.includes(`CONSTRAINT ${CONSTRAINT} CHECK (`));
  if (!line) return { error: `${DDL}：找不到 CONSTRAINT ${CONSTRAINT} CHECK (` };
  const p = predicateOnLine(line, `CONSTRAINT ${CONSTRAINT} CHECK (`);
  if (p === null) return { error: `${DDL}：${CONSTRAINT} 没写成单行（lint:column-locks 的解析器按行读 CONSTRAINT）` };
  return { predicate: p };
}

/** 迁移：取 `ADD CONSTRAINT <name> CHECK (` 的 P，并数 `NOT (P)` 出现几次。 */
function migrationPredicate(src, ddlP) {
  const line = src.split("\n").find((l) => l.includes(`ADD CONSTRAINT ${CONSTRAINT} CHECK (`));
  if (!line) return { error: `${MIGRATION}：找不到 ADD CONSTRAINT ${CONSTRAINT} CHECK (` };
  const p = predicateOnLine(line, `ADD CONSTRAINT ${CONSTRAINT} CHECK (`);
  if (p === null) return { error: `${MIGRATION}：ADD CONSTRAINT ${CONSTRAINT} 没写成单行` };
  const negated = src.split(`NOT (${ddlP})`).length - 1;
  return { predicate: p, negated };
}

/**
 * 从 seed 源码里取 `const <name> = [ {…}, {…} ];` 的每个对象的 code / type / layer。
 * 对象是扁平的（没有嵌套大括号），按 `{…}` 逐个取；取不到 code 或 type 的对象算错——不猜。
 */
function seedRows(src, constName, file) {
  const start = src.indexOf(`const ${constName} = [`);
  if (start < 0) return { error: `${file}：找不到 const ${constName} = [` };
  const end = src.indexOf("\n  ];", start);
  if (end < 0) return { error: `${file}：${constName} 没有以 \`  ];\` 收尾` };
  /* 先剥注释再找对象：seed 里的注释会写 `product.product.{code}.desc` 这类带花括号的话，
     不剥的话它会被当成一个「取不到 code / type」的对象。行注释只认前面是空白或行首的 `//`，
     免得误伤字符串里的 `://`。 */
  const body = src
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  const rows = [];
  for (const m of body.matchAll(/\{([^{}]*)\}/g)) {
    const obj = m[1];
    const take = (k) => {
      const mm = new RegExp(`(?:^|[\\s,])${k}:\\s*(?:"([^"]*)"|'([^']*)'|(null))`).exec(obj);
      if (!mm) return undefined;
      return mm[3] ? null : (mm[1] ?? mm[2]);
    };
    const code = take("code");
    const type = take("type");
    if (code === undefined || type === undefined) {
      return { error: `${file}：${constName} 里有一项取不到 code / type：${obj.trim().slice(0, 80)}` };
    }
    rows.push({ code, type, layer: take("layer") ?? null });
  }
  if (rows.length === 0) return { error: `${file}：${constName} 解析到 0 行——判据瞎了不是通过` };
  return { rows };
}

/** 受管类型表：`{ value: "...", family: "..." }` 逐项。 */
function taxonomyDefs(src) {
  const start = src.indexOf("export const PRODUCT_TYPE_DEFS");
  if (start < 0) return { error: `${TAXONOMY}：找不到 PRODUCT_TYPE_DEFS` };
  const end = src.indexOf("] as const;", start);
  if (end < 0) return { error: `${TAXONOMY}：PRODUCT_TYPE_DEFS 没有以 \`] as const;\` 收尾` };
  const body = src.slice(start, end);
  const defs = [];
  for (const m of body.matchAll(/\{([^{}]*)\}/g)) {
    const value = /value:\s*"([^"]+)"/.exec(m[1])?.[1];
    const family = /family:\s*"([^"]+)"/.exec(m[1])?.[1];
    if (!value || !family) return { error: `${TAXONOMY}：有一项取不到 value / family：${m[1].trim().slice(0, 80)}` };
    defs.push({ value, family });
  }
  if (defs.length === 0) return { error: `${TAXONOMY}：PRODUCT_TYPE_DEFS 解析到 0 项——判据瞎了不是通过` };
  return { defs };
}

/**
 * 全部判据。入参是五份源码文本 + 根 package.json 的 script 名 + 会提到本守卫的文本
 * （{ file, text }[]），便于自检喂反例。返回问题清单（空 = 绿）。
 */
export function collectProblems({ ddl, migration, seedCatalog, seedDemo, taxonomy, packageScripts, citations }) {
  const problems = [];

  // A. ①② 同一谓词
  const d = ddlPredicate(ddl);
  if (d.error) problems.push(d.error);
  const m = d.predicate ? migrationPredicate(migration, d.predicate) : { error: null };
  if (m.error) problems.push(m.error);
  if (d.predicate && m.predicate) {
    if (d.predicate !== m.predicate) {
      problems.push(
        `谓词不同形：\n      DDL      ${d.predicate}\n      migration ${m.predicate}\n    （M3 会拒而 M2 不点名的行就藏在这个差里）`,
      );
    }
    if (m.negated < 2) {
      problems.push(
        `${MIGRATION}：\`NOT (P)\` 只出现 ${m.negated} 次（审计段 + 停手段应各一次，且 P 与 DDL 逐字相同）`,
      );
    }
  }

  // B. seed 两张表
  for (const [src, name, file] of [
    [seedCatalog, "PRODUCTS", SEED_CATALOG],
    [seedDemo, "DEMO_PRODUCTS", SEED_DEMO],
  ]) {
    const r = seedRows(src, name, file);
    if (r.error) {
      problems.push(r.error);
      continue;
    }
    for (const row of r.rows) {
      if (!compatible(row.layer, row.type)) {
        problems.push(
          `${file} ${name}：${row.code} 的 layer=${row.layer} 与 type=${row.type}（${familyOf(row.type)} 族）矛盾——L2 ⇒ *_platform，L3 ⇒ *_agent`,
        );
      }
    }
  }

  // C. 受管类型表
  const t = taxonomyDefs(taxonomy);
  if (t.error) {
    problems.push(t.error);
  } else {
    const undefinedFamily = t.defs.filter((x) => x.family === "undefined").map((x) => x.value);
    if (undefinedFamily.length !== 1 || undefinedFamily[0] !== "undefined") {
      problems.push(
        `${TAXONOMY}：family 为 "undefined" 的类型应恰好只有 "undefined"，实为 [${undefinedFamily.join(", ")}]——新类型要么带 _platform / _agent 后缀（蕴含出层），要么别进受管枚举`,
      );
    }
    for (const def of t.defs) {
      if (familyOf(def.value) !== def.family) {
        problems.push(
          `${TAXONOMY}：${def.value} 声明 family=${def.family}，按后缀推出来是 ${familyOf(def.value)}——DDL 只认后缀，两处不能各说各的`,
        );
      }
    }
  }

  // D. 自述一致：没有这条 pnpm script 时，谁写了它谁就在指一个不存在的机制
  if (!packageScripts.includes(ALIAS)) {
    for (const c of citations) {
      const hits = c.text.split(ALIAS).length - 1;
      if (hits > 0) {
        problems.push(
          `${c.file}：写了 \`${ALIAS}\`（${hits} 处），根 package.json 没有这条 script——本守卫在 ci.yml 里直跑 node，读者照着跑是 Command not found；写 check-product-layer-family.mjs`,
        );
      }
    }
  }

  return problems;
}

function walkMd(dir, out) {
  for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walkMd(p, out);
    else if (e.name.endsWith(".md")) out.push({ file: p, text: read(p) });
  }
  return out;
}

function loadSources() {
  const ddl = read(DDL);
  const migration = read(MIGRATION);
  const seedDemo = read(SEED_DEMO);
  return {
    ddl,
    migration,
    seedCatalog: read(SEED_CATALOG),
    seedDemo,
    taxonomy: read(TAXONOMY),
    packageScripts: Object.keys(JSON.parse(read(PACKAGE_JSON)).scripts ?? {}),
    citations: walkMd(DOCS_DIR, [
      { file: DDL, text: ddl },
      { file: MIGRATION, text: migration },
      { file: SEED_DEMO, text: seedDemo },
    ]),
  };
}

if (process.argv.includes("--self-test")) {
  let bad = 0;
  const say = (ok, msg) => {
    if (!ok) bad += 1;
    console.log(`${ok ? "✓" : "✗"} ${msg}`);
  };
  console.log("══ 自检：五处对账的每一条判据都会动 ══\n");
  const good = loadSources();
  const run = (over) => collectProblems({ ...good, ...over });
  const P = ddlPredicate(good.ddl).predicate;

  say(run({}).length === 0, "正例：仓里现状 → 0 条");
  say(
    run({ migration: good.migration.replace(`ADD CONSTRAINT ${CONSTRAINT} CHECK (${P})`, `ADD CONSTRAINT ${CONSTRAINT} CHECK (${P.replace("'L3'", "'L2'")})`) }).some((x) => x.includes("谓词不同形")),
    "反例一：迁移里的 P 改一个字 → 报谓词不同形",
  );
  say(
    run({ migration: good.migration.replace(`WHERE NOT (${P})`, "WHERE layer = 'L3' AND product_type = 'general_platform'") }).some((x) => x.includes("NOT (P)")),
    "反例二：停手段改成手写条件、不再是 NOT (P) → 报出现次数不足",
  );
  say(
    run({ ddl: good.ddl.replace(`CONSTRAINT ${CONSTRAINT} CHECK (${P})`, `CONSTRAINT ${CONSTRAINT} CHECK (deleted_at IS NOT NULL OR\n        layer IS NULL)`) }).some((x) => x.includes("单行")),
    "反例三：DDL 约束拆成两行 → 报没写成单行",
  );
  say(
    run({ seedCatalog: good.seedCatalog.replace('code: "vxtpl",\n      type: "general_agent",', 'code: "vxtpl",\n      type: "general_platform",') }).some((x) => x.includes("vxtpl") && x.includes("矛盾")),
    "反例四：seed-catalog 把 vxtpl 改成 general_platform（layer 仍 L3）→ 点名 vxtpl",
  );
  say(
    run({ seedDemo: good.seedDemo.replace("layer: 'L3',\n      cat: 1,\n      origin: 'self',\n      name: '标书智能体'", "layer: 'L2',\n      cat: 1,\n      origin: 'self',\n      name: '标书智能体'") }).some((x) => x.includes("tenderforge") && x.includes("矛盾")),
    "反例五：seed-demo 把 tenderforge 改成 L2（type 仍 industry_agent）→ 点名 tenderforge",
  );
  say(
    run({ seedCatalog: good.seedCatalog.replace('code: "vxtpl",\n      type: "general_agent",', 'code: "vxtpl",\n      type: "undefined",') }).length === 0,
    "正例二：vxtpl 改成 undefined 型（layer 仍 L3）→ 相容，0 条（D10 吸收）",
  );
  say(
    run({ taxonomy: good.taxonomy.replace('    value: "undefined",\n    family: "undefined",', '    value: "service",\n    family: "undefined",\n  },\n  {\n    value: "undefined",\n    family: "undefined",') }).some((x) => x.includes('family 为 "undefined"')),
    "反例六：受管枚举加一个既非 _platform 也非 _agent 的 service → 报 undefined 族不止一个",
  );
  say(
    run({ taxonomy: good.taxonomy.replace('    value: "industry_agent",\n    family: "agent",', '    value: "industry_agent",\n    family: "platform",') }).some((x) => x.includes("industry_agent") && x.includes("后缀")),
    "反例七：industry_agent 声明成 platform 族 → 报与后缀不符",
  );
  say(
    run({ seedDemo: good.seedDemo.replace("const DEMO_PRODUCTS = [", "const DEMO_PRODUCTS_X = [") }).some((x) => x.includes("DEMO_PRODUCTS")),
    "反例八：seed-demo 的表改名/消失 → 报找不到，不是通过",
  );
  say(
    run({ citations: [...good.citations, { file: "docs/x.md", text: `守卫 \`${ALIAS}\` 锁蕴含` }] }).some((x) => x.includes("docs/x.md") && x.includes("Command not found")),
    "反例九：某份文档写了 pnpm 别名而根 package.json 没有这条 script → 点名那份文档",
  );
  say(
    run({ citations: [...good.citations, { file: "docs/x.md", text: `守卫 \`${ALIAS}\` 锁蕴含` }], packageScripts: [...good.packageScripts, ALIAS] }).length === 0,
    "正例三：同一份文档，但根 package.json 真有这条 script → 放行",
  );
  say(run({}).length === 0, "复原：又是 0 条");

  console.log(`\n── 汇总 ──\n看得见 ${12 - bad}/12 项`);
  if (bad) {
    console.log("error: 自检有判据不会动——先修守卫再谈守卫");
    process.exit(1);
  }
  process.exit(0);
}

const problems = collectProblems(loadSources());
console.log("── 汇总 ──");
if (problems.length) {
  console.log(`error: ${problems.length}\n  ✗ ${problems.join("\n  ✗ ")}`);
  console.log(
    "\n修复：layer 是定位轴的唯一权威——L2 ⇒ *_platform，L3 ⇒ *_agent，undefined 相容。改 seed 的 layer 或 type，或把 DDL 与迁移的谓词改回逐字相同。",
  );
  process.exit(1);
}
console.log(`error: 0   (DDL ↔ 迁移谓词逐字相同；seed-catalog / seed-demo 产品行与受管类型表均与分层蕴含一致；没有人把本守卫写成不存在的 pnpm 别名)`);
