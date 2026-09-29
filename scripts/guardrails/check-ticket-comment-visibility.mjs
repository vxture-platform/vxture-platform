#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 客户面读工单流水，必须带可见性过滤
//
// ## 它防的那个漏法没有症状
//
// `support.ticket_comments` 一张表同时装着两类话：运营写给客户看的正式回复
// （`reply`），和运营写给自己看的内部备注（`internal_note`，「这个客户上季度
// 欠款」「先拖两天等法务回话」）。**给谁看只由 `event_type` 决定**，没有第二个
// 判据（没有 is_internal 列，payload 里没有标记，也不靠作者推断——同一个运营
// 两种都写）。
//
// 于是漏掉过滤的后果是：内部备注**渲染在客户的工单详情页上**。而这个漏法
// 不抛异常、不报 500、不进日志、页面看起来完全正常——它长得跟一个做好了的
// 功能一模一样。没有任何运行时信号会把它暴露出来，只能静态守。
//
// 值域权威只有一份：`CUSTOMER_VISIBLE_TICKET_EVENT_TYPES`
// （packages/shared/shared/src/constants/catalog-domains.constants.ts）。
// 它是**白名单**——不在表里的一律不可见，所以 `event_type` 这个开放集日后
// 冒出的新词默认看不见，而不是默认看得见。
//
// ## 判据（四条，机器全算得出）
//
// 凡是**不在运营面**的源码文件，其 SQL 读到 `support.ticket_comments` 时：
//
//   ① 必须有 `event_type` 上的**绑参**谓词（`= any($n)` / `in ($n)`）。
//   ② 那个数组必须来自权威常量：本文件必须 **import** 它
//      （从 @vxture-platform/shared，或工单域的 visibility 门面）。
//   ③ 不许用**黑名单方向**（`event_type <> 'internal_note'` / `not in`）。
//      方向错的过滤今天也能挡住内部备注，但下一个新词会默认放行——
//      而放行才是会泄露的那个方向。
//   ④ 不许在查询里**手抄第二份清单**（`in ('comment','reply')`）。
//      两份清单的下场是改了一份、另一份继续按旧的放行，且两处都不报错。
//
// 判据钉在 **SQL 文本所在的那个文件**上，不是调用点。所以「读取藏在 helper
// 里」躲不掉：helper 自己就是那个写着表名的文件，它落在哪个面就按哪个面判。
// 调用链有多深都不影响——查询总得有个最终住处。
//
// 面的划分是**默认收紧**的：只有下面 OPERATOR_PLANES 里列出的路径算运营面
// （运营要看见全部，包含内部备注，那是内部备注存在的理由）。**其余一切都按
// 客户面判**——新开一个门户、新加一个 BFF，默认受管，不会因为没人想起来
// 更新这个名单而悄悄豁免。
//
// ## 它看不见什么（每条都是真的盲区，不是谦辞）
//
//   · **DB 侧的视图或函数**。`select * from support.v_ticket_timeline` 这种读法，
//     表名不在仓里，本守卫一行都照不到。真加了这种视图，过滤必须做进视图本身。
//   · **连表名都拼出来的 SQL**（`"support.ticket_" + "comments"`）。为此留了
//     一道兜底：提到表名却找不出任何一条可判的 SQL 字面量 ⇒ 报红（见 ④ 之外
//     的 "unreadable"），但真要躲，字符串拆得够碎就能躲过去。
//   · **ORM / Prisma 读法**。`prisma.ticketComment.findMany()` 里没有表名。
//     本仓 BFF 一律裸 pg，所以今天不是问题；哪天引入了，判据得另加一条。
//   · **过滤对不对**。它只检查「有一个绑参谓词，且数组来自权威常量」，
//     不检查运行时传进去的到底是什么值。传错值是测试的活。
//   · **TS 侧过滤**（`rows.filter(...)`）。本守卫**要求过滤做在 SQL 里**，
//     所以只在 TS 里过会被判红——这是有意的：内部备注根本不该离开数据库，
//     一旦进了进程，下一次 `.map()` 重构就可能把它带出去。
//   · **界面把不可见的事件画出来**。守卫管的是「读回来了什么」，
//     不管「读回来之后怎么渲染」。
//   · **测试文件**（`*.spec.* / *.test.* / *.itest.*`）**整类不在视野里**。
//     它们不服务流量，而且首跑就抓到一条真误报：ops-todos 的 repository spec 把
//     `support.ticket_comments` 列在「这段代码不许碰的关系」名单里——那是在断言
//     **没有**这次读取，判成漏过滤恰好把意思读反了。代价是：把读取藏进一个
//     `.spec.ts` 里能躲过本守卫（那种写法评审该当场拦下，且 .spec 从不进打包）。
//
// 运行：  node scripts/guardrails/check-ticket-comment-visibility.mjs
//        node scripts/guardrails/check-ticket-comment-visibility.mjs --self-test
// 别名：  pnpm lint:ticket-visibility
// 退出码：有违反、或判据自身失效（读不到权威值域 / 扫不到任何读取点）→ 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const rel = (p) => relative(REPO_ROOT, p).split("\\").join("/");

/** 权威值域所在文件。它没了/改名了 ⇒ 判据失效 ⇒ 报红，不报「通过」。 */
const DOMAIN_FILE =
  "packages/shared/shared/src/constants/catalog-domains.constants.ts";
const DOMAIN_CONST = "CUSTOMER_VISIBLE_TICKET_EVENT_TYPES";

/** 允许 import 权威常量的来源（工单域的门面转出的是同一份值）。 */
const ALLOWED_IMPORT_SOURCES = [
  "@vxture-platform/shared",
  "@vxture/service-ticket",
  "visibility",
];

const SCAN_ROOTS = ["bff", "portals", "services", "packages"];
const TABLE = "support.ticket_comments";

/** 测试文件不服务流量，整类排除（理由与代价见头注最后一条盲区）。 */
const TEST_FILE = /\.(spec|test|itest)\.[cm]?[jt]sx?$/;

/**
 * 运营面：这些路径下的读取**应该**看见全部（内部备注就是写给他们看的）。
 * 其余一切按客户面判——默认收紧，新面不会悄悄豁免。
 */
const OPERATOR_PLANES = [
  "bff/admin-bff/",
  "bff/opera-bff/",
  "bff/arche-bff/",
  "portals/admin/",
  "portals/opera/",
  "portals/arche/",
];

/**
 * 登记的例外：**不在运营面、却确实不需要过滤**的读取。
 *
 * 每条必须带：
 *   · `evidence` —— 该文件里必须存在的片段。找不到 ⇒ 登记已陈旧 ⇒ 报红。
 *     （陈旧的名单本身就是下一个骗人的东西，所以它也是红。）
 *   · `reason`   —— 为什么它现在不需要过滤。
 *   · `validWhileOrphan` —— 可选。填了包名，则这条豁免**只在那个包零消费方时
 *     成立**：仓里任何 package.json 一旦依赖它，豁免当场失效报红。
 *     这是给「今天是死代码，将来会被接到客户侧」的包用的——豁免自己会到期，
 *     不依赖任何人记得回来删。
 */
const REGISTERED_EXEMPTIONS = [
  {
    file: "services/support/ticket/src/repository/pg-ticket.repository.ts",
    evidence: "async getEvents(ticketId: string)",
    validWhileOrphan: "@vxture/service-ticket",
    reason:
      "登记在册的孤儿包（见 check-orphan-service-packages.mjs），零 BFF 依赖、" +
      "getEvents 零调用方，今天不可能出现在任何客户面响应里。它按设计是要在客户侧" +
      "工单流解锁时**采纳 router 的契约**后上岗的（TD-049）——那一刻这条豁免自动失效" +
      "（validWhileOrphan），必须先把可见性过滤做进 getEvents 再接消费方。",
  },
];

// ── 读权威值域 ───────────────────────────────────────────────────────────────

function loadVisibleKinds() {
  let src;
  try {
    src = readFileSync(join(REPO_ROOT, DOMAIN_FILE), "utf8");
  } catch {
    return { error: `读不到权威值域文件 ${DOMAIN_FILE}` };
  }
  const m = src.match(new RegExp(`const ${DOMAIN_CONST}\\s*=\\s*\\[([^\\]]*)\\]`, "s"));
  if (!m) return { error: `${DOMAIN_FILE} 里找不到 ${DOMAIN_CONST}` };
  const kinds = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (kinds.length === 0) return { error: `${DOMAIN_CONST} 是空的` };
  return { kinds };
}

// ── 源码扫描 ─────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  "build",
  "coverage",
  ".turbo",
]);
const EXTS = [".ts", ".tsx", ".mjs", ".cjs", ".js"];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

/**
 * 去掉注释。**必须先做**：admin 的工单详情页头注里就写着
 * `support.ticket_comments`（在讲这张表的语义），裸 grep 会把那段说明当成一次读取。
 * 行内 `//` 只在不像 URL / 不在字符串里时才当注释——这里够用：SQL 模板串里的 `--`
 * 才是 SQL 注释，而我们不去掉 SQL 注释（它在字符串内，本来就参与判据）。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, lead) =>
      lead + " ".repeat(m.length - lead.length),
    );
}

/** 取出所有字符串字面量（含模板串）——SQL 只可能住在这里面。 */
function stringLiterals(source) {
  const out = [];
  const re = /`(?:\\[\s\S]|[^\\`])*`|"(?:\\[\s\S]|[^\\"\n])*"|'(?:\\[\s\S]|[^\\'\n])*'/g;
  for (const m of source.matchAll(re)) {
    out.push({ text: m[0], index: m.index ?? 0 });
  }
  return out;
}

const READS_TABLE = new RegExp(`(from|join)\\s+${TABLE.replace(".", "\\.")}`, "i");
const WRITES_TABLE = new RegExp(
  `(insert\\s+into|update|delete\\s+from)\\s+${TABLE.replace(".", "\\.")}`,
  "i",
);
const BOUND_EVENT_TYPE = /event_type\s*(?:=\s*any\s*\(|in\s*\()[^)]*\$\d+/i;
const NEGATIVE_EVENT_TYPE = /event_type\s*(?:<>|!=)|event_type\s+not\s+in\b/i;

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function isOperatorPlane(relPath) {
  return OPERATOR_PLANES.some((p) => relPath.startsWith(p));
}

function importsDomainConst(source) {
  // 常量名出现在某条 import 语句里，且来源在白名单中。
  for (const m of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (!m[1].includes(DOMAIN_CONST)) continue;
    const from = m[2];
    if (ALLOWED_IMPORT_SOURCES.some((s) => from === s || from.endsWith(s))) {
      return true;
    }
  }
  return false;
}

/** SQL 里手抄的清单：`event_type` 附近出现 ≥2 个可见词的单引号字面量。 */
function hasHandWrittenList(sqlText, kinds) {
  const idx = sqlText.search(/event_type/i);
  if (idx < 0) return false;
  const window = sqlText.slice(idx, idx + 200);
  const quoted = [...window.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return quoted.filter((q) => kinds.includes(q)).length >= 2;
}

/** TS/JS 侧的第二份清单：数组字面量里出现 ≥2 个可见词。 */
function secondListHits(source, kinds) {
  const hits = [];
  for (const m of source.matchAll(/\[([^[\]]{0,600})\]/g)) {
    const quoted = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    if (quoted.filter((q) => kinds.includes(q)).length >= 2) {
      hits.push({ index: m.index ?? 0, text: m[0].slice(0, 120) });
    }
  }
  return hits;
}

// ── 主体 ─────────────────────────────────────────────────────────────────────

function run() {
  const errors = [];
  const domain = loadVisibleKinds();
  if (domain.error) {
    return {
      errors: [
        `判据自身失效：${domain.error}\n` +
          `  这道守卫的全部判断都以那份值域为准，读不到就**不给通过结论**。`,
      ],
      stats: null,
    };
  }
  const kinds = domain.kinds;

  const all = SCAN_ROOTS.flatMap((r) => walk(join(REPO_ROOT, r)));
  const files = all.filter((f) => !TEST_FILE.test(f));
  const skippedTests = all.length - files.length;
  const exemptionUsed = new Set();
  let mentions = 0;
  let readsChecked = 0;
  let operatorReads = 0;

  // 例外登记的有效性（陈旧 / 已到期都算红）。
  const exemptByFile = new Map();
  for (const entry of REGISTERED_EXEMPTIONS) {
    exemptByFile.set(entry.file, entry);
    let src = "";
    try {
      src = readFileSync(join(REPO_ROOT, entry.file), "utf8");
    } catch {
      errors.push(
        `登记的例外指向一个不存在的文件：${entry.file}\n` +
          `  文件没了就把这条登记删掉——陈旧的名单本身就是红。`,
      );
      continue;
    }
    if (!src.includes(entry.evidence)) {
      errors.push(
        `登记的例外已陈旧：${entry.file}\n` +
          `  找不到佐证片段 \`${entry.evidence}\`。代码变了就重新判一次它该不该豁免，` +
          `别让登记替一段已经不存在的代码背书。`,
      );
    }
    if (entry.validWhileOrphan) {
      const consumers = consumersOf(entry.validWhileOrphan);
      if (consumers.length > 0) {
        errors.push(
          `登记的例外已到期：${entry.file}\n` +
            `  \`${entry.validWhileOrphan}\` 现在有消费方了（${consumers.join("、")}），` +
            `豁免的前提（零消费方）不再成立。\n` +
            `  修法：把可见性过滤做进这段读取（绑 ${DOMAIN_CONST}），然后删掉这条登记。`,
        );
      }
    }
  }

  for (const abs of files) {
    const relPath = rel(abs);
    const raw = readFileSync(abs, "utf8");
    if (!raw.includes(TABLE)) continue;
    const source = stripComments(raw);
    if (!source.includes(TABLE)) continue; // 只在注释里提到过（说明文字，不是读取）
    mentions += 1;

    const operator = isOperatorPlane(relPath);

    // 第二份清单：两个面都不许（运营面手抄一份，客户面迟早会去抄它）。
    if (relPath !== DOMAIN_FILE) {
      for (const hit of secondListHits(source, kinds)) {
        errors.push(
          `${relPath}:${lineOf(source, hit.index)}\n` +
            `  这里手抄了第二份可见事件清单：${hit.text}\n` +
            `  只准有一份（${DOMAIN_CONST}，在 ${DOMAIN_FILE}）。两份的下场是改了一份、` +
            `另一份继续按旧的放行，而且两处都不报错。`,
        );
      }
    }

    const literals = stringLiterals(source);
    const sqlReads = literals.filter((l) => READS_TABLE.test(l.text));

    if (operator) {
      operatorReads += sqlReads.length;
      continue; // 运营面应当看见全部
    }

    const exemption = exemptByFile.get(relPath);
    if (exemption) {
      exemptionUsed.add(relPath);
      continue; // 有效性已在上面单独判过
    }

    if (sqlReads.length === 0) {
      // 提到表名，却没有任何一条能读的 SQL 字面量：要么是拼出来的，要么是
      // ORM/别的写法。两种情况本守卫都看不见 ⇒ fail-closed。
      const writesOnly = literals.some((l) => WRITES_TABLE.test(l.text));
      if (!writesOnly) {
        errors.push(
          `${relPath}\n` +
            `  这个文件提到了 ${TABLE}，但找不出任何一条可判的 SQL 字面量。\n` +
            `  拼接出来的 SQL、或 ORM 读法，本守卫都看不见最终文本 ⇒ 按红处理。\n` +
            `  修法：把查询写成一条完整的模板串，可见性谓词绑 ${DOMAIN_CONST}；` +
            `确实不是读取（只写入）请在评审里说明。`,
        );
      }
      continue;
    }

    for (const lit of sqlReads) {
      readsChecked += 1;
      const line = lineOf(source, lit.index);
      const sql = lit.text;
      const where = `${relPath}:${line}`;

      if (hasHandWrittenList(sql, kinds)) {
        errors.push(
          `${where}\n` +
            `  查询里手抄了可见事件清单（\`in ('…','…')\`）。\n` +
            `  改成绑参：\`event_type = any($n::text[])\`，数组传 ${DOMAIN_CONST}。`,
        );
        continue;
      }
      if (NEGATIVE_EVENT_TYPE.test(sql)) {
        errors.push(
          `${where}\n` +
            `  这是黑名单方向的过滤（\`event_type <> …\` / \`not in\`）。\n` +
            `  event_type 是开放集，黑名单让**新出现的词默认可见**——而默认可见` +
            `正是会泄露的那个方向。改成白名单：\`= any($n)\` 绑 ${DOMAIN_CONST}。`,
        );
        continue;
      }
      if (!BOUND_EVENT_TYPE.test(sql)) {
        errors.push(
          `${where}\n` +
            `  客户面读 ${TABLE} 却没有 event_type 上的可见性谓词。\n` +
            `  内部备注（internal_note）会连同正式回复一起返回给客户，而这个漏法` +
            `**不报错、页面看起来完全正常**。\n` +
            `  修法：where 加 \`c.event_type = any($n::text[])\`，参数传` +
            ` ${DOMAIN_CONST}（从 @vxture-platform/shared import）。`,
        );
        continue;
      }
      if (!importsDomainConst(source)) {
        errors.push(
          `${where}\n` +
            `  有绑参的 event_type 谓词，但本文件没有 import ${DOMAIN_CONST}。\n` +
            `  谓词绑的那个数组不知道是哪来的 —— 自己就地拼一个数组，写法上和` +
            `正确答案长得一模一样。\n` +
            `  修法：\`import { ${DOMAIN_CONST} } from "@vxture-platform/shared";\`` +
            ` 并把它作为参数传进去。`,
        );
      }
    }
  }

  for (const entry of REGISTERED_EXEMPTIONS) {
    if (!exemptionUsed.has(entry.file) && !errors.some((e) => e.includes(entry.file))) {
      errors.push(
        `登记的例外没用上：${entry.file}\n` +
          `  它已经不读 ${TABLE} 了（或不在扫描范围里）。把这条登记删掉。`,
      );
    }
  }

  if (mentions === 0) {
    return {
      errors: [
        `扫不到任何提到 ${TABLE} 的源码文件 —— 判据失效（扫描根或后缀名不对了），` +
          `拒绝给出通过结论。`,
      ],
      stats: null,
    };
  }

  return {
    errors,
    stats: {
      files: files.length,
      skippedTests,
      mentions,
      readsChecked,
      operatorReads,
      kinds,
    },
  };
}

/** 某个 workspace 包有没有消费方（只认 package.json 的依赖声明）。 */
function consumersOf(pkgName) {
  const found = [];
  for (const root of ["bff", "portals", "packages", "services", "tools"]) {
    for (const file of walkPackageJsons(join(REPO_ROOT, root))) {
      let json;
      try {
        json = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      const deps = {
        ...(json.dependencies ?? {}),
        ...(json.devDependencies ?? {}),
        ...(json.peerDependencies ?? {}),
      };
      if (deps[pkgName] && json.name !== pkgName) found.push(json.name ?? rel(file));
    }
  }
  return found;
}

function walkPackageJsons(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkPackageJsons(full, out);
    else if (name === "package.json") out.push(full);
  }
  return out;
}

// ── 自检：判据自己的正反例 ───────────────────────────────────────────────────
// 「一条没见过它失败的守卫不是守卫」。真树上今天只有一处可判的读取，所以四条
// 判据各自的红/绿在这里用固定样本钉住——改判据时这些样本会先碎。
const SELF_TEST_CASES = [
  {
    name: "白名单绑参 + import ⇒ 绿",
    source:
      'import { CUSTOMER_VISIBLE_TICKET_EVENT_TYPES } from "@vxture-platform/shared";\n' +
      "const SQL = `select c.id from support.ticket_comments c " +
      "where c.ticket_id = $1 and c.event_type = any($2::text[])`;",
    red: false,
  },
  {
    name: "完全没有过滤 ⇒ 红",
    source:
      "const SQL = `select c.id from support.ticket_comments c where c.ticket_id = $1`;",
    red: true,
  },
  {
    name: "黑名单方向 ⇒ 红",
    source:
      "const SQL = `select c.id from support.ticket_comments c " +
      "where c.event_type <> 'internal_note'`;",
    red: true,
  },
  {
    name: "查询里手抄清单 ⇒ 红",
    source:
      "const SQL = `select c.id from support.ticket_comments c " +
      "where c.event_type in ('comment','reply','status_changed')`;",
    red: true,
  },
  {
    name: "有绑参谓词但没 import 权威常量 ⇒ 红",
    source:
      "const KINDS = ['comment'];\n" +
      "const SQL = `select c.id from support.ticket_comments c " +
      "where c.event_type = any($2::text[])`;",
    red: true,
  },
  {
    name: "拼接出来的 SQL（看不见最终文本）⇒ 红",
    source:
      'const SQL = "select * from " + "support.ticket_comments" + " where 1=1";',
    red: true,
  },
  {
    name: "只在注释里提到表名 ⇒ 绿（说明文字不是读取）",
    source: "// 时间线读的是 support.ticket_comments，运营面不过滤。\nexport const X = 1;",
    red: false,
  },
  {
    name: "TS 侧第二份清单 ⇒ 红",
    source:
      'import { CUSTOMER_VISIBLE_TICKET_EVENT_TYPES } from "@vxture-platform/shared";\n' +
      'const MINE = ["comment", "reply"];\n' +
      "const SQL = `select c.id from support.ticket_comments c " +
      "where c.event_type = any($2::text[])`;",
    red: true,
  },
];

/** 把判据抽出来跑在一段源码文本上（与真树同一套函数）。 */
function verdictFor(rawSource, kinds) {
  const problems = [];
  if (!rawSource.includes(TABLE)) return problems;
  const source = stripComments(rawSource);
  if (!source.includes(TABLE)) return problems;
  for (const hit of secondListHits(source, kinds)) problems.push(`second-list:${hit.text}`);
  const literals = stringLiterals(source);
  const sqlReads = literals.filter((l) => READS_TABLE.test(l.text));
  if (sqlReads.length === 0) {
    if (!literals.some((l) => WRITES_TABLE.test(l.text))) problems.push("unreadable");
    return problems;
  }
  for (const lit of sqlReads) {
    if (hasHandWrittenList(lit.text, kinds)) problems.push("hand-written-list");
    else if (NEGATIVE_EVENT_TYPE.test(lit.text)) problems.push("blacklist");
    else if (!BOUND_EVENT_TYPE.test(lit.text)) problems.push("no-filter");
    else if (!importsDomainConst(source)) problems.push("no-import");
  }
  return problems;
}

function selfTest() {
  const domain = loadVisibleKinds();
  if (domain.error) {
    console.error(`✗ 自检无法进行：${domain.error}`);
    return 1;
  }
  let bad = 0;
  console.log("══ 判据自检（check-ticket-comment-visibility --self-test）══");
  for (const c of SELF_TEST_CASES) {
    const problems = verdictFor(c.source, domain.kinds);
    const red = problems.length > 0;
    const ok = red === c.red;
    if (!ok) bad += 1;
    console.log(
      `  ${ok ? "✓" : "✗"} ${c.name}` +
        (problems.length ? `  [${problems.join(",")}]` : "  []"),
    );
  }
  console.log("\n── 汇总 ──");
  console.log(`error: ${bad}`);
  return bad ? 1 : 0;
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}

const { errors, stats } = run();

console.log("══ 客户面工单流水可见性（check-ticket-comment-visibility）══");
if (stats) {
  console.log(
    `  扫描 ${stats.files} 个源文件（另跳过 ${stats.skippedTests} 个测试文件）；` +
      `${stats.mentions} 个文件实际出现 ${TABLE}；` +
      `其中客户面可判读取 ${stats.readsChecked} 处、运营面（应看见全部）${stats.operatorReads} 处。`,
  );
  console.log(`  权威可见值域：${stats.kinds.join(" / ")}（${DOMAIN_CONST}）。`);
  console.log(
    `  登记例外 ${REGISTERED_EXEMPTIONS.length} 条（含有效性与到期检查）。`,
  );
}

if (errors.length) {
  console.error("");
  for (const e of errors) console.error(`✗ ${e}\n`);
  console.error(`── 汇总 ──\nerror: ${errors.length}`);
  process.exit(1);
}

console.log("\n✓ 没有客户面读取漏掉可见性过滤。");
console.log("── 汇总 ──\nerror: 0");
