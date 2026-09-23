#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-upstream-routes.mjs —— 平台打给 atlas / runos 的每一条路径，上游接不接得住
//
// ── 补的是哪个盲区 ──
// 平台调一个上游根本没有的端点时，**两侧都不表现为错误**：平台这边要么被调用点的
// 兜底吞掉（`.catch(() => setX(null))`），要么显示成「读取失败」——而读不到与不存在
// 长得一模一样；上游那边连一条日志都不会有，请求根本没进业务代码。
//
// opera 的能力注册页就靠一句 `.catch` 吞掉过这种失败：面板读不到筛选项时渲染成
// 五个空的筛选组，既不报错也不提示。那一次最终查明端点是有的（见下一节），但那条
// 兜底本身说明了这类缺陷能安静到什么程度。
//
// 所以判据是静态的、在合并之前：**平台源码里每一条上游路径，上游必须有一条注册
// 的路由能接住它。**
//
// ── 它读的是一棵工作树，而工作树会过期 ──
// **这一条是本文件最要紧的一句，因为它已经骗过我一次。** 第一版只管读
// `VX_RUNOS_DIR` 下的源码，不问那份 checkout 是不是最新的。本机那份落后
// origin/main 两个提交，而缺的正是 `/capability/capability-facets`——于是守卫
// 报「上游没有这个端点」，我据此写了 PR 正文、写了 KNOWN_GAPS、还动手去上游
// 重新实现了一遍**三周前就已经合并的东西**。
//
// 一个读过期副本的检查不是「查不到」，是**确定的错答案，还带着实测的外观**。
// 所以下面 `assertFresh()` 要求两个 checkout 干净、且恰好停在各自的
// `origin/main` 上，并把读到的 sha 与提交日期打出来——`origin/main` 自己也可能
// 是上次 fetch 的旧值，打出来是为了让人一眼看出「这份判据有多新」。
//
// ── 它看不见什么（显式写下来，别让人以为这条守卫管得比实际宽）──
// · 只对账**路径**。方法、查询参数名、请求体与响应形状一概不看——那是 X-1 / 信封
//   那几条守卫的事，这条只回答「打过去有没有人接」。
// · 模板串里 `${}` 不紧跟在 `/` 后面的（`/capability/logs${q}`），按「后面是查询串」
//   处理：在 `${` 处截断再比。于是 `/x/y${...}` 只证明 `/x/y` 存在。**刻意放宽**，
//   收紧会把一堆正确调用报成错。
// · 上游若在 main 之外的分支上加了路由，这里看不到。
// · 注释里的路径不算数：先用词法器剥注释再扫字面量。正则做不到。
//
// ── 上游两仓不在 CI 里 ──
// 照 check-conformance-matrix 的先例：只有显式给了 VX_ATLAS_DIR / VX_RUNOS_DIR
// 才测；没给就**整体跳过并说清楚它跳过了**，不冒充测过。给了但读不到 → 抛错，
// 不兜底（判据读不到时给「通过」是这仓里反复栽过的那个坑）。
//
// 用法：
//   VX_ATLAS_DIR=... VX_RUNOS_DIR=... pnpm lint:upstream-routes
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

/**
 * 这份 checkout 值不值得当判据。
 *
 * 读过期副本得到的不是「查不到」，是一个**确定的错答案**——而它带着实测的外观，
 * 比没量更糟。2026-09-23 实际发生过：本机 runos 落后 origin/main 两个提交，缺的
 * 正好是被判为「上游没有」的那个端点。
 *
 * 判据三条，缺一条就抛，不降级成警告：
 *   · 工作树干净 —— 半改的源码不是任何一方的现实。
 *   · HEAD == origin/main —— 落后会漏掉新路由，领先则是没合并的本地实验。
 *   · sha 与提交日期打出来 —— `origin/main` 自己可能是上次 fetch 的旧值，
 *     守卫没法替人 fetch（网络 I/O 不属于 lint），但能把「这份判据有多新」摆出来。
 */
function assertFresh(label, dir) {
  const git = (...args) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  let head, origin, dirty, when;
  try {
    head = git("rev-parse", "HEAD");
    origin = git("rev-parse", "origin/main");
    dirty = git("status", "--porcelain");
    when = git("show", "-s", "--format=%cs", "HEAD");
  } catch (error) {
    throw new Error(
      `${label}=${dir} 不是一个能读出 git 状态的 checkout（${String(error).split("\n")[0]}）` +
        ` —— 判据读不到就抛，不当成"没问题"`,
    );
  }
  if (dirty !== "") {
    throw new Error(
      `${label}=${dir} 工作树不干净。半改的上游源码既不是它的现状也不是它的将来，` +
        `拿它对账只会得到一个谁都不认的答案。先 git stash 或提交。`,
    );
  }
  if (head !== origin) {
    const behind = git("rev-list", "--count", "HEAD..origin/main");
    const ahead = git("rev-list", "--count", "origin/main..HEAD");
    throw new Error(
      `${label}=${dir} 停在 ${head.slice(0, 7)}，而 origin/main 是 ${origin.slice(0, 7)}` +
        `（落后 ${behind}、领先 ${ahead}）。落后会把上游新加的路由报成「不存在」——` +
        `2026-09-23 就是这么错的。先 git fetch && git merge --ff-only origin/main。`,
    );
  }
  console.log(
    `  - ${label}: ${head.slice(0, 7)}（${when}，= origin/main，工作树干净）`,
  );
}

const PLATFORM = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const ATLAS_DIR = process.env.VX_ATLAS_DIR;
const RUNOS_DIR = process.env.VX_RUNOS_DIR;

console.log("== 上游路由对账(check-upstream-routes)==");
if (!ATLAS_DIR || !RUNOS_DIR) {
  console.log(
    "  - 跳过:未给 VX_ATLAS_DIR / VX_RUNOS_DIR。上游两仓不在本仓也不在 CI 里,",
  );
  console.log(
    "    没有它们**这条守卫什么都没检查**——不是通过。本机带上两个目录再跑一次。",
  );
  process.exit(0);
}
const ATLAS = resolve(ATLAS_DIR);
const RUNOS = resolve(RUNOS_DIR);
for (const [label, dir] of [
  ["VX_ATLAS_DIR", ATLAS],
  ["VX_RUNOS_DIR", RUNOS],
]) {
  if (!existsSync(join(dir, "service", "src"))) {
    throw new Error(
      `${label}=${dir} 下没有 service/src —— 读不到就抛,不当成"没问题"`,
    );
  }
  assertFresh(label, dir);
}

/**
 * 已知缺口：平台在调、而上游确实没有的路径。
 *
 * 列在这里不是豁免，是**把它从「没人知道」变成「写在代码里、每次跑都念一遍」**。
 * 每条必须写清楚「谁来补、补哪边」——一条没有出口的例外会长成永久现状。
 *
 * **现在是空的，而它空过一次是有故事的。** 2026-09-23 这里曾经挂过一条
 * `/capability/capability-facets`，依据是守卫报它上游不存在；随后发现那是守卫读了
 * 一棵落后两个提交的 checkout 得出的结论，端点三周前就合并了。所以现在有了
 * `assertFresh()`，而这份名单里要再添一条之前，先确认它不是同一种错。
 */
const KNOWN_GAPS = [];

/** 上游路径的判别式：这几个前缀在平台源码里只可能是上游地址。
 *  平台自己的路由用不带前导斜杠的 @Get("x") 声明，不会撞上。 */
const UPSTREAM_BASES = [
  "/capability",
  "/commerce",
  "/governance",
  "/audit",
  "/provisioning",
  "/tenancy",
  "/v1",
];

/**
 * 词法扫一遍：返回剥掉注释的代码，以及所有字符串 / 模板串字面量（含起始行号）。
 * 模板串**整体**取出——跨行、嵌套 `${}` 都算它自己的一部分。
 */
function lex(src) {
  let code = "";
  const literals = [];
  let line = 1;
  let i = 0;
  const n = src.length;

  const readString = (quote) => {
    const startLine = line;
    let raw = "";
    i += 1; // 跳开引号
    while (i < n) {
      const c = src[i];
      if (c === "\\") {
        raw += c + (src[i + 1] ?? "");
        if (src[i + 1] === "\n") line += 1;
        i += 2;
        continue;
      }
      if (c === quote) {
        i += 1;
        break;
      }
      if (c === "\n") line += 1;
      raw += c;
      i += 1;
    }
    literals.push({ value: raw, line: startLine });
    return raw;
  };

  const readTemplate = () => {
    const startLine = line;
    let raw = "";
    let depth = 0;
    i += 1; // 跳开反引号
    while (i < n) {
      const c = src[i];
      if (c === "\\") {
        raw += c + (src[i + 1] ?? "");
        if (src[i + 1] === "\n") line += 1;
        i += 2;
        continue;
      }
      if (c === "\n") line += 1;
      if (c === "$" && src[i + 1] === "{") {
        depth += 1;
        raw += "${";
        i += 2;
        continue;
      }
      if (depth > 0) {
        if (c === "{") depth += 1;
        else if (c === "}") depth -= 1;
        raw += c;
        i += 1;
        continue;
      }
      if (c === "`") {
        i += 1;
        break;
      }
      raw += c;
      i += 1;
    }
    literals.push({ value: raw, line: startLine });
    return raw;
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") {
          line += 1;
          code += "\n";
        }
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      code += '"' + readString(c) + '"';
      continue;
    }
    if (c === "`") {
      code += "`" + readTemplate() + "`";
      continue;
    }
    if (c === "\n") line += 1;
    code += c;
    i += 1;
  }
  return { code, literals };
}

/**
 * 字面量 → 可比对的路径。
 *   `/a/${id}/b`  → `/a/:p/b`      （`${}` 紧跟 `/`，是路径参数）
 *   `/a/b${q}`    → `/a/b`（截断）  （`${}` 粘在段尾，实际是查询串后缀）
 * 返回 { path, truncated }。
 */
function normalizeCall(lit) {
  let s = lit;
  // 先把「紧跟 / 的 ${}」换成参数段
  s = s.replace(/(?<=\/)\$\{[^]*?\}(?=$|\/)/g, ":p");
  // 剩下的 ${} 说明它粘在段尾 —— 从那里截断
  const at = s.indexOf("${");
  let truncated = false;
  if (at >= 0) {
    s = s.slice(0, at);
    truncated = true;
  }
  const q = s.indexOf("?");
  if (q >= 0) {
    s = s.slice(0, q);
    truncated = true;
  }
  s = s.replace(/\/+$/, "");
  return { path: s, truncated };
}

function normalizeRoute(p) {
  return p.replace(/\/:[A-Za-z0-9_]+/g, "/:p").replace(/\/+$/, "");
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (
      [
        "node_modules",
        "dist",
        "coverage",
        "generated",
        ".next",
        ".git",
      ].includes(name)
    )
      continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (
      name.endsWith(".ts") &&
      !name.endsWith(".spec.ts") &&
      !name.endsWith(".d.ts")
    )
      out.push(p);
  }
  return out;
}

// ── 上游：从 @Controller + 方法装饰器还原注册表 ────────────────────────────
function upstreamRoutes(repoRoot) {
  const routes = new Map(); // normalized path -> Set(method)
  for (const file of walk(join(repoRoot, "service", "src"))) {
    const { code } = lex(readFileSync(file, "utf8"));
    const ctrl = code.match(/@Controller\(\s*(?:"([^"]*)")?\s*\)/);
    if (!ctrl) continue;
    const prefix = (ctrl[1] ?? "").replace(/^\/+|\/+$/g, "");
    const re = /@(Get|Post|Put|Patch|Delete)\(\s*(\[[^\]]*\]|"[^"]*")?\s*\)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const method = m[1].toUpperCase();
      const arg = m[2] ?? '""';
      const parts = [...arg.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
      for (const seg of parts.length > 0 ? parts : [""]) {
        const full = normalizeRoute(
          "/" + [prefix, seg.replace(/^\/+/, "")].filter(Boolean).join("/"),
        );
        if (!routes.has(full)) routes.set(full, new Set());
        routes.get(full).add(method);
      }
    }
  }
  return routes;
}

// ── 平台：调用点 ───────────────────────────────────────────────────────────
const CALLERS = {
  atlas: [
    "bff/opera-bff/src/routers/atlas.router.ts",
    "bff/admin-bff/src/routers/atlas.router.ts",
    "bff/console-bff/src/routers/atlas.router.ts",
  ],
  runos: [
    "bff/opera-bff/src/routers/runos.router.ts",
    "bff/admin-bff/src/routers/runos.router.ts",
  ],
  both: ["bff/opera-bff/src/lib/upstream-grants.ts"],
};

function callSites(files) {
  const found = [];
  for (const rel of files) {
    const { literals } = lex(readFileSync(join(PLATFORM, rel), "utf8"));
    for (const { value, line } of literals) {
      if (!value.startsWith("/")) continue;
      const head = "/" + value.slice(1).split("/")[0];
      if (!UPSTREAM_BASES.includes(head)) continue;
      const { path, truncated } = normalizeCall(value);
      if (path === "" || path === head) {
        // 光秃秃的 `/capability` 之类：多半是文档串或前缀常量，跳过并记账
        found.push({
          path,
          file: rel,
          line,
          raw: value,
          truncated,
          bare: true,
        });
        continue;
      }
      found.push({ path, file: rel, line, raw: value, truncated, bare: false });
    }
  }
  return found;
}

/** 上游把 `:p` 当通配：调用点写死的 id 段要能落在参数段上。 */
function matches(callPath, routes) {
  if (routes.has(callPath)) return true;
  const cs = callPath.split("/");
  for (const r of routes.keys()) {
    const rs = r.split("/");
    if (rs.length !== cs.length) continue;
    if (rs.every((seg, i) => seg === ":p" || seg === cs[i])) return true;
  }
  return false;
}

const atlasRoutes = upstreamRoutes(ATLAS);
const runosRoutes = upstreamRoutes(RUNOS);

console.log(
  `  - atlas 注册 ${atlasRoutes.size} 条路由；runos 注册 ${runosRoutes.size} 条`,
);

let bad = 0;
let gaps = 0;
let checked = 0;
const groups = [
  { name: "atlas", routes: [atlasRoutes], files: CALLERS.atlas },
  { name: "runos", routes: [runosRoutes], files: CALLERS.runos },
  {
    name: "upstream-grants（两家共用）",
    routes: [atlasRoutes, runosRoutes],
    files: CALLERS.both,
  },
];

for (const g of groups) {
  const sites = callSites(g.files).filter((s) => !s.bare);
  const uniq = new Map();
  for (const s of sites) if (!uniq.has(s.path)) uniq.set(s.path, s);
  checked += uniq.size;
  console.log(`\n  -- ${g.name}：平台调用 ${uniq.size} 条不同路径`);
  for (const [p, s] of [...uniq].sort()) {
    if (g.routes.some((r) => matches(p, r))) continue;
    const gap = KNOWN_GAPS.find((k) => k.path === p);
    if (gap) {
      gaps += 1;
      console.log(`  ! 已知缺口 ${p}（${gap.upstream}，${gap.since} 起）`);
      console.log(`      ${gap.why}`);
      console.log(`      ${s.file}:${s.line}`);
      continue;
    }
    bad += 1;
    console.log(`  x ${p}${s.truncated ? "（原文带后缀，已截断比对）" : ""}`);
    console.log(`      ${s.file}:${s.line}   原文 ${JSON.stringify(s.raw)}`);
  }
}

/* 已知缺口挂在名单里就不红——但**每次都念一遍**。而名单里那条若哪天上游补上了，
   下面这句会把它顶红：一条不再成立的例外留着，就是下一个人以为「这里本来就不通」
   的理由。豁免要能自己退休。 */
for (const k of KNOWN_GAPS) {
  const live = matches(
    k.path,
    k.upstream === "atlas" ? atlasRoutes : runosRoutes,
  );
  if (live) {
    console.log(
      `  x 已知缺口 ${k.path} 上游现在有了 —— 把这条从 KNOWN_GAPS 删掉`,
    );
    bad += 1;
  }
}

console.log(
  `\n对账 ${checked} 条；${bad === 0 ? `通过（已知缺口 ${gaps} 条，见上）` : `${bad} 条接不住`}`,
);
process.exit(bad === 0 ? 0 : 1);
