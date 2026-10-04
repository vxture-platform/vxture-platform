#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-internal-auth-key-usage.mjs — 两把内部口令各归谁读，精确相等，多一个少一个都红
//
// ## 这条判据为什么存在（2026-10-04，内部面口令拆分）
//
// 同一个请求头 `x-vxture-internal-auth` 后面从今天起有两把钥匙：
//   · `AUTH_INTERNAL_TOKEN` —— **产品面**。platform-api 的 C2/C3 自助端点收它；console-bff 与
//     各产品后台发它。值发给了产品团队，本次不轮换。
//   · `IDP_INTERNAL_TOKEN` —— **内部面**。auth-bff 的 /internal/*（运营账号 / 客户账号管理、
//     step-up）只认它；admin / arche / opera-bff 发它。只注入这四个容器。
// 拆分的全部意义是「产品手里的值开不了运营管理面」。它会以两种方式静默失效：
//   1. 有人在 auth-bff 写回落 `IDP ?? AUTH`（或干脆读回旧键）——产品值重新开门，不报错；
//   2. 新键没接进 schema / 读者读了别的名字——`config.auth.IDP_INTERNAL_TOKEN` 永远 undefined，
//      内部面全 401，而 tsc 不会说一个字（本仓最常见的缺陷形状：做了没接）。
// 两种都只能静态守。
//
// ## 判据（按它做的事找，不按名字找）
//
// 扫 `bff/<pkg>`、`packages/core/<pkg>`、`services/<g>/<pkg>` **整个包目录**（不只 src：lib/、test/
// 夹具、根下的 .js 入口都算），文件类型 .ts / .tsx / .js / .mjs / .cjs（排除 spec/test、.d.ts、
// node_modules / dist / .next / coverage / build），加 `scripts/**/*.mjs`（排除本文件）。
// 此前只扫 `src/**/*.ts`：gateway-bff 的真实入口是 `src/main.mjs`，任何 BFF 里新放一个 .js 助手或
// src 之外的 .ts 都看不见——而设计要求 gateway / website 两把都不许读，那个盲区恰好盖着它们。
// 用 TypeScript 的解析器取 AST：**注释是 trivia、永远不是节点**，
// 字符串里的 `//` 也不会被当成注释——两类正则剥注释器各错各的，这里不用正则。
// 一处「读者」= 下面三种节点之一，文本**整体等于**键名：
//   · 标识符        `config.auth.IDP_INTERNAL_TOKEN`、`process.env.AUTH_INTERNAL_TOKEN`、schema 的属性名
//   · 字符串字面量  `process.env["AUTH_INTERNAL_TOKEN"]`、审计规则表里的 `"IDP_INTERNAL_TOKEN"`
//   · 无插值模板串  `` process.env[`IDP_INTERNAL_TOKEN`] ``
// 以**包**为粒度（bff/<x>、packages/core/<x>、services/<g>/<x>；scripts 下按文件）与 EXPECTED 表
// 做精确相等：表里有、命中为 0 → 红（判据瞎了，或读者被删而表没跟上）；表里没有、命中非 0 → 红；
// 表里的键集合与命中集合不等 → 红。auth-bff 若出现 AUTH_INTERNAL_TOKEN → 红，**这就是「回落不许活」**。
//
// ## 看不见什么（写下来，免得「绿了」被当成「没有这类问题」）
//
//   · 拼出来的 env 名：`process.env["AUTH_" + "INTERNAL_TOKEN"]` —— 字面量不整体等于键名，看不见；
//   · `process.env` 整体透传（`{ ...process.env }` 喂给子进程 / 库）—— 没有键名可数；
//   · 动态下标：`config.auth[key]`、`config.auth[name as keyof AuthConfig]` —— 同上；
//   · 键名出现在**更长的**字符串里（日志文案 `"AUTH_INTERNAL_TOKEN unset"`）—— 不算读者、不计数，
//     所以它也挡不住「读者藏在 eval/JSON.parse 的字符串里」这种形状。
//   本仓 2026-10-04 三条动态路径都没有（grep 核过）；自检里对第 1 条与第 4 条各留了一个夹具，
//   明说它们**不会**变红——那是判据的边，不是通过。
//
// ## EXPECTED 表怎么改
//
//   加一个读者 = 在表里登记它读哪把、为什么。删读者 = 同一个 PR 删掉表项（否则这里红：
//   期望非空、命中为 0）。`packages/core/auth` 那条就是这样留的：那里有一份零消费方的
//   `resolveInternalAuthToken`（死代码，另批删除）；删它的那个 PR 必须把那一行一起删。
//
// 运行：node scripts/guardrails/check-internal-auth-key-usage.mjs
//      node scripts/guardrails/check-internal-auth-key-usage.mjs --self-test
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SELF = "scripts/guardrails/check-internal-auth-key-usage.mjs";
const SKIP = new Set(["node_modules", "dist", ".next", "coverage", "build"]);

const AUTH = "AUTH_INTERNAL_TOKEN";
const IDP = "IDP_INTERNAL_TOKEN";
const KEYS = [AUTH, IDP];

/**
 * 谁读哪把。精确相等：表里每个包的键集合 == 扫描命中的键集合；不在表里的包命中必须为空。
 * @type {Map<string, { keys: string[]; why: string }>}
 */
const EXPECTED = new Map([
  // ── 产品面（旧值，不动）──
  [
    "bff/platform-api",
    {
      keys: [AUTH],
      why: "产品面接收方：PlatformAuthGuard 的旧头路径（C2/C3 自助端点）",
    },
  ],
  [
    "bff/console-bff",
    {
      keys: [AUTH],
      why: "产品面上唯一的平台发送方：C2 读权益（挪去 Bearer 是 D5，另开一线）",
    },
  ],
  // ── 内部面（新键）──
  [
    "bff/auth-bff",
    {
      keys: [IDP],
      why: "内部面接收方：InternalAuthGuard 只认它 + 启动时点名；出现 AUTH 即回落复活",
    },
  ],
  [
    "bff/admin-bff",
    { keys: [IDP], why: "内部面发送方：operator-admin / operator-stepup" },
  ],
  [
    "bff/arche-bff",
    { keys: [IDP], why: "内部面发送方：operator-admin / operator-stepup" },
  ],
  ["bff/opera-bff", { keys: [IDP], why: "内部面发送方：operator-stepup" }],
  // ── 两把都该出现 ──
  [
    "packages/core/config",
    {
      keys: [AUTH, IDP],
      why: "auth.schema 必须声明两把：没声明的键被 zod 剥掉 = 做了没接",
    },
  ],
  [
    "scripts/guardrails/boot-smoke.mjs",
    { keys: [AUTH, IDP], why: "smoke 的假 env 两把都喂，形状与生产一致" },
  ],
  [
    "scripts/guardrails/audit-env.mjs",
    { keys: [AUTH, IDP], why: "审计规则文本点名两把键（共享键集合 / idp-internal 规则）" },
  ],
  // ── 待删的死代码（E5 / PR B）──
  [
    "packages/core/auth",
    {
      keys: [AUTH],
      why:
        "死代码 resolveInternalAuthToken / assertInternalAuth / InternalAuthGuard（零消费方）。" +
        "PR B 删它们时**必须同时删掉本条**：本条留着而读者没了，这里会红（期望非空、命中 0）。",
    },
  ],
]);

const rel = (f) => relative(ROOT, f).replace(/\\/g, "/");

function walk(dir, pred, out = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, pred, out);
    else if (pred(n)) out.push(p);
  }
  return out;
}

/**
 * 包内源码：.ts / .tsx / .js / .mjs / .cjs，排除 spec/test 与 .d.ts。**整个包目录**而不只 src——
 * gateway-bff 的入口是 src/main.mjs，而 lib/ 与 test/ 夹具里的读者此前都在盲区里。
 */
const isSource = (n) =>
  /\.(ts|tsx|js|mjs|cjs)$/.test(n) && !/\.(spec|test)\.(ts|tsx|js|mjs|cjs)$/.test(n) && !/\.d\.ts$/.test(n);
const isMjs = (n) => /\.mjs$/.test(n);

/** 扫描范围：一组 (根目录, 文件谓词)。 */
function collectSources() {
  const files = [];
  for (const group of ["bff", "packages/core"]) {
    const base = join(ROOT, group);
    for (const pkg of safeList(base)) {
      files.push(...walk(join(base, pkg), isSource));
    }
  }
  for (const g of safeList(join(ROOT, "services"))) {
    for (const pkg of safeList(join(ROOT, "services", g))) {
      files.push(...walk(join(ROOT, "services", g, pkg), isSource));
    }
  }
  files.push(...walk(join(ROOT, "scripts"), isMjs));
  const sources = new Map();
  for (const f of files) {
    const r = rel(f);
    if (r === SELF) continue;
    sources.set(r, readFileSync(f, "utf8"));
  }
  return sources;
}

function safeList(dir) {
  try {
    return readdirSync(dir).filter((n) => {
      if (SKIP.has(n)) return false;
      try {
        return statSync(join(dir, n)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** 包粒度。 */
function packageOf(relPath) {
  let m;
  if ((m = /^(bff\/[^/]+)\//.exec(relPath))) return m[1];
  if ((m = /^(packages\/core\/[^/]+)\//.exec(relPath))) return m[1];
  if ((m = /^(services\/[^/]+\/[^/]+)\//.exec(relPath))) return m[1];
  if (/^scripts\//.test(relPath)) return relPath;
  return relPath;
}

/**
 * 一份源码里两把键的读者位置。用 TS 解析器：注释是 trivia，字符串里的 `//` 不是注释。
 * @returns {Map<string, string[]>} key → ["file:line", …]
 */
function readersIn(relPath, text) {
  const kind = /\.(js|mjs|cjs)$/.test(relPath)
    ? ts.ScriptKind.JS
    : relPath.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, kind);
  const found = new Map(KEYS.map((k) => [k, []]));
  const at = (n) => `${relPath}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (n) => {
    let name = null;
    if (ts.isIdentifier(n)) name = n.text;
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) name = n.text;
    if (name !== null && found.has(name)) found.get(name).push(at(n));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/**
 * 对一份源码表求判。纯函数：自检靠改表（不改盘）喂反例。
 * @param {Map<string, string>} sources relPath → text
 */
function evaluate(sources) {
  /** @type {Map<string, Map<string, string[]>>} pkg → key → locations */
  const hits = new Map();
  for (const [relPath, text] of sources) {
    const pkg = packageOf(relPath);
    const r = readersIn(relPath, text);
    for (const k of KEYS) {
      if (r.get(k).length === 0) continue;
      if (!hits.has(pkg)) hits.set(pkg, new Map());
      const byKey = hits.get(pkg);
      byKey.set(k, [...(byKey.get(k) ?? []), ...r.get(k)]);
    }
  }

  const violations = [];
  for (const [pkg, { keys }] of EXPECTED) {
    const got = hits.get(pkg) ?? new Map();
    for (const k of keys) {
      if (!got.has(k)) {
        violations.push(
          `${pkg}: 期望读 ${k}，命中 0 —— 判据瞎了，或读者被删而 EXPECTED 没跟上（删读者的 PR 要同时删表项）`,
        );
      }
    }
    for (const [k, locs] of got) {
      if (!keys.includes(k)) {
        violations.push(`${pkg}: 不许读 ${k}，却命中 ${locs.length} 处：${locs.join(", ")}`);
      }
    }
  }
  for (const [pkg, byKey] of hits) {
    if (EXPECTED.has(pkg)) continue;
    for (const [k, locs] of byKey) {
      violations.push(`${pkg}: 不在 EXPECTED 里却读 ${k}（${locs.length} 处）：${locs.join(", ")}`);
    }
  }
  for (const k of KEYS) {
    const total = [...hits.values()].reduce((n, m) => n + (m.get(k)?.length ?? 0), 0);
    if (total === 0) violations.push(`全仓没有任何 ${k} 的读者 —— 不是通过，是判据瞎了`);
  }
  return { hits, violations };
}

// ─────────────────────────────────────────────────────────────────────────────

const real = collectSources();

if (process.argv.includes("--self-test")) {
  let bad = 0;
  const say = (ok, msg) => {
    if (!ok) bad += 1;
    console.log(`${ok ? "✓" : "✗"} ${msg}`);
  };
  const redWith = (sources, needle) => {
    const { violations } = evaluate(sources);
    return violations.some((v) => v.includes(needle));
  };
  const green = (sources) => evaluate(sources).violations.length === 0;
  const mutate = (edits) => {
    const m = new Map(real);
    for (const [path, text] of Object.entries(edits)) {
      if (text === null) m.delete(path);
      else m.set(path, text);
    }
    return m;
  };
  const pkgFiles = (pkg) => [...real.keys()].filter((p) => packageOf(p) === pkg);

  console.log("══ 自检：判据两头都看得见，并且会对每一条反例说话 ══\n");

  say(green(real), `真仓扫描 → 绿（${real.size} 个文件）`);

  // (i) 反例：读者加进一个不许读的包（auth-bff 读回旧键 = 回落复活的一半）
  say(
    redWith(
      mutate({ "bff/auth-bff/src/authn/zz-fixture.ts": "export const t = (c: any) => c.auth.AUTH_INTERNAL_TOKEN;\n" }),
      "bff/auth-bff: 不许读 AUTH_INTERNAL_TOKEN",
    ),
    "(i) auth-bff 出现 config.auth.AUTH_INTERNAL_TOKEN → 红",
  );

  // (ii) 反例：回落行本身
  say(
    redWith(
      mutate({
        "bff/auth-bff/src/authn/zz-fixture.ts":
          "export const e = (c: any) => c.auth.IDP_INTERNAL_TOKEN ?? c.auth.AUTH_INTERNAL_TOKEN;\n",
      }),
      "bff/auth-bff: 不许读 AUTH_INTERNAL_TOKEN",
    ),
    "(ii) auth-bff 出现 IDP_INTERNAL_TOKEN ?? AUTH_INTERNAL_TOKEN 回落行 → 红",
  );

  // (iii) 反例：把一个期望包的读者拿空（platform-api 的 AUTH 读者全删）
  {
    const edits = {};
    for (const p of pkgFiles("bff/platform-api")) edits[p] = real.get(p).replaceAll("AUTH_INTERNAL_TOKEN", "ZZ_GONE");
    say(
      redWith(mutate(edits), "bff/platform-api: 期望读 AUTH_INTERNAL_TOKEN，命中 0"),
      "(iii) platform-api 的 AUTH 读者全被拿掉 → 红「判据瞎了」",
    );
  }

  // (iv) 正例：只在注释里出现的键不计数（放进一个不许读的包里，若计数就会红）
  say(
    green(
      mutate({
        "bff/website-bff/src/zz-fixture.ts":
          "// AUTH_INTERNAL_TOKEN is not read here\n/* and IDP_INTERNAL_TOKEN neither\n   AUTH_INTERNAL_TOKEN */\nexport const x = 1;\n",
      }),
    ),
    "(iv) website-bff 只在 // 与 /* */ 注释里提到两把键 → 仍绿（注释不是读者）",
  );

  // (v) 反例：两把键进了同一个包（console-bff 本只许 AUTH）
  say(
    redWith(
      mutate({ "bff/console-bff/src/zz-fixture.ts": "export const t = process.env.IDP_INTERNAL_TOKEN;\n" }),
      "bff/console-bff: 不许读 IDP_INTERNAL_TOKEN",
    ),
    "(v) console-bff 同时读两把 → 红",
  );

  // (vi) 反例：期望表里有、读者没了（模拟 PR B 删了 core-auth 的死代码却没删表项）
  {
    const edits = {};
    for (const p of pkgFiles("packages/core/auth")) edits[p] = real.get(p).replaceAll("AUTH_INTERNAL_TOKEN", "ZZ_GONE");
    say(
      redWith(mutate(edits), "packages/core/auth: 期望读 AUTH_INTERNAL_TOKEN，命中 0"),
      "(vi) packages/core/auth 的读者被删而 EXPECTED 条目还在 → 红（PR B 必须一并删表项）",
    );
  }

  // (vii) 反例：字符串里带 `//` 的那一行后面还有真读者 —— 正则剥注释器会把它连同读者一起删掉而误绿
  say(
    redWith(
      mutate({
        "bff/gateway-bff/src/zz-fixture.ts":
          'export const u = "http://example.test"; export const t = process.env["AUTH_INTERNAL_TOKEN"];\n',
      }),
      "bff/gateway-bff: 不在 EXPECTED 里却读 AUTH_INTERNAL_TOKEN",
    ),
    '(vii) gateway-bff 一行里先有 "http://…" 字符串再有真读者 → 红（字符串里的 // 不是注释）',
  );

  // (viii) 反例：不在表里的包读了键（services 层）
  say(
    redWith(
      mutate({ "services/identity/iam/src/zz-fixture.ts": "export const t = process.env.IDP_INTERNAL_TOKEN;\n" }),
      "services/identity/iam: 不在 EXPECTED 里却读 IDP_INTERNAL_TOKEN",
    ),
    "(viii) services/identity/iam 读了 IDP → 红（不在表里的包命中必须为空）",
  );

  // (ix) 反例：scripts 下新文件读键
  say(
    redWith(
      mutate({ "scripts/zz-fixture.mjs": "const t = process.env.AUTH_INTERNAL_TOKEN;\n" }),
      "scripts/zz-fixture.mjs: 不在 EXPECTED 里却读 AUTH_INTERNAL_TOKEN",
    ),
    "(ix) scripts/ 下新脚本读 AUTH → 红",
  );

  // (x) 判据的边，明说它不会红：拼出来的 env 名 / 更长字符串里的键名
  say(
    green(
      mutate({
        "bff/website-bff/src/zz-fixture.ts":
          'export const a = process.env["AUTH_" + "INTERNAL_TOKEN"];\nexport const b = "AUTH_INTERNAL_TOKEN unset — closed";\n',
      }),
    ),
    "(x) 盲区如头注所写：拼接的 env 名与长字符串里的键名**不会**变红（这是判据的边，不是通过）",
  );

  // (xi) 复原 → 绿（mutate 不动 real，这里再评一次真仓）
  say(green(real), "(xi) 复原后再评真仓 → 绿");

  // (xii) 扫描范围真的宽了：gateway-bff 的入口 src/main.mjs 是仓里真实存在的 .mjs，此前不在扫描集里。
  //       这条看的是 collectSources 的产物，不是 mutate 喂进去的路径——谓词改了没生效这里会红。
  say(real.has("bff/gateway-bff/src/main.mjs"), "(xii) 真仓扫描集含 bff/gateway-bff/src/main.mjs（.mjs 入口不再是盲区）");

  // (xiii) 反例：.mjs / .js / .cjs 里的读者（gateway 两把都不许读）
  say(
    redWith(
      mutate({ "bff/gateway-bff/src/zz-fixture.mjs": "export const t = process.env.AUTH_INTERNAL_TOKEN;\n" }),
      "bff/gateway-bff: 不在 EXPECTED 里却读 AUTH_INTERNAL_TOKEN",
    ) &&
      redWith(
        mutate({ "bff/gateway-bff/src/zz-fixture.cjs": 'const t = process.env["IDP_INTERNAL_TOKEN"]; module.exports = t;\n' }),
        "bff/gateway-bff: 不在 EXPECTED 里却读 IDP_INTERNAL_TOKEN",
      ),
    "(xiii) gateway-bff 的 .mjs / .cjs 读者 → 红",
  );

  // (xiv) 反例：.tsx（带 JSX）里的读者 —— 解析要按 TSX 走，否则 `<div>` 会让解析器把后面的节点吞掉
  say(
    redWith(
      mutate({
        "bff/website-bff/src/zz-fixture.tsx":
          "export const C = () => <div title={process.env.IDP_INTERNAL_TOKEN}>x</div>;\n",
      }),
      "bff/website-bff: 不在 EXPECTED 里却读 IDP_INTERNAL_TOKEN",
    ),
    "(xiv) website-bff 的 .tsx 读者（JSX 属性里）→ 红",
  );

  // (xv) 反例：src 之外的读者（lib/、test/ 夹具）——此前只扫 src
  say(
    redWith(
      mutate({ "bff/website-bff/lib/zz-fixture.ts": "export const t = process.env.AUTH_INTERNAL_TOKEN;\n" }),
      "bff/website-bff: 不在 EXPECTED 里却读 AUTH_INTERNAL_TOKEN",
    ) &&
      isSource("zz.js") &&
      isSource("zz.tsx") &&
      !isSource("zz.spec.tsx") &&
      !isSource("zz.d.ts"),
    "(xv) src 之外（bff/website-bff/lib/）的读者 → 红；谓词收 .js/.tsx、仍排除 spec 与 .d.ts",
  );

  const total = 16;
  console.log(`\n── 汇总 ──\n看得见 ${total - bad}/${total} 项判据`);
  if (bad) {
    console.log("这条判据还不能用 —— 先让它看得见上面标 ✗ 的那几条。");
    process.exit(1);
  }
  console.log("反例都会红、正例都绿、真仓绿。这条判据可以用了。");
  process.exit(0);
}

const { hits, violations } = evaluate(real);
console.log(`══ 两把内部口令的读者（${real.size} 个文件，${EXPECTED.size} 个登记包）`);
for (const [pkg, { keys, why }] of EXPECTED) {
  const got = hits.get(pkg) ?? new Map();
  const line = keys.map((k) => `${k}×${got.get(k)?.length ?? 0}`).join("  ");
  console.log(`   ${pkg.padEnd(44)} ${line}\n      ${why}`);
}
if (violations.length) {
  console.log(`\n✗ ${violations.length} 条不符：`);
  for (const v of violations) console.log(`  · ${v}`);
  console.log(
    "\n  内部面只认 IDP_INTERNAL_TOKEN、产品面只认 AUTH_INTERNAL_TOKEN；谁读哪把登记在本文件 EXPECTED。\n" +
      "  加读者 = 登记；删读者 = 同一个 PR 删表项；auth-bff 出现 AUTH_INTERNAL_TOKEN = 回落复活，不许。",
  );
  process.exit(1);
}
console.log("\n✓ 两把钥匙各归其主，精确相等。");
