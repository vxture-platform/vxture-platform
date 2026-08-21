#!/usr/bin/env node

/**
 * check-packed-consumability.mjs — 按 **registry 安装形态** 验设计三包可消费。
 *
 * ── 补的是哪个盲区 ──
 * monorepo 里工作区包是软链到完整签出的:`src/` 在、未发布的文件也在、跨包
 * 相对路径怎么写都通。从 registry 装完全不是这个形状——只有 `files` 列的东西
 * 存在。于是有一整族缺陷**在本仓永远测不出来**,只有消费方会撞上(#268 由
 * vxtpl 分三轮报了六条,全部是这个形状)。
 *
 * 这个脚本不模拟,它 `npm pack` 出真 tarball、解出来按 node_modules/@vxture/*
 * 摆好,然后在那棵树上断言。三类断言各自对应 #268 里一条真实付出过代价的缺陷:
 *
 *  1. **@source / @import 目标必须在包里** — #268 第一条。`@source` 解析为空
 *     **不报错**,症状与根本没写完全一致(变量注册成功、规则不产出、页面一片灰)。
 *     早先那版指向 `src/`,而两个包的 `files` 都只发 `dist`。
 *  2. **@source 目标里必须真有工具类** — 路径存在不等于内容对。指到一个空目录
 *     同样静默失败,所以从"路径存在"再走一步到"扫得到东西"。
 *  3. **`/server` 的类型面不得宽于运行时面** — #268 第三条,也是最贵的一条:
 *     `export type *` 被 tsup 的 dts rollup 擦掉 `type`,客户端组件名落进 .d.ts
 *     的值空间,消费方写 `import { Button } from ".../server"` tsc 零错误、
 *     运行时 undefined。类型系统主动为错误写法背书,只在渲染那条路径被走到时才炸。
 *
 * 用法:node scripts/guardrails/check-packed-consumability.mjs
 * 前置:三个设计包已 build(dist 就绪)。缺 dist 时跳过并提示,不假装通过。
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = process.cwd();

/** 设计三包。顺序即解包顺序,伞包最后(它的 CSS 引另外两包)。 */
const PACKAGES = [
  { name: "design-tokens", dir: "packages/design/design-tokens" },
  { name: "design-ui", dir: "packages/design/design-ui" },
  { name: "design-system", dir: "packages/design/design-system" },
];

/**
 * 抽样工具类:必须能在 @source 目标里扫到,否则消费方拿到的是无样式组件。
 * 取自 #268 报告里实测为 0 次出现的那几个,一个不改。
 */
const REQUIRED_UTILITIES = [
  "bg-primary",
  "h-control-lg",
  "shadow-raised",
  "inline-flex",
  "animate-spin",
];

/** 声明了 server-safe 子集的包:类型面必须等于运行时面。 */
const SERVER_ENTRIES = [
  { pkg: "@vxture/design-ui", dts: "dist/server.d.ts", mjs: "dist/server.mjs" },
  {
    pkg: "@vxture/design-system",
    dts: "dist/server.d.ts",
    mjs: "dist/server.mjs",
  },
];

const errors = [];
const notes = [];

function fail(msg) {
  errors.push(msg);
  console.error(`✗ ${msg}`);
}

function pass(msg) {
  console.log(`✓ ${msg}`);
}

/** 递归收集目录下匹配后缀的文件。 */
function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(abs);
  }
  return out;
}

/**
 * 找出一个依赖包的根目录。
 *
 * 不能只靠 `require.resolve(dep + "/package.json")`:带 `exports` 的现代包
 * (clsx、多数 Radix 包)不把 `./package.json` 列进去,这个深引会直接抛。
 * 退一步解主入口,再沿目录上溯到那个 package.json 就位的地方。
 */
function resolvePackageRoot(req, dep) {
  try {
    return path.dirname(req.resolve(`${dep}/package.json`));
  } catch {
    /* exports 挡住了深引,走下面的上溯 */
  }
  let cur;
  try {
    cur = path.dirname(req.resolve(dep));
  } catch {
    return null;
  }
  const segments = dep.split("/");
  const leaf = segments[segments.length - 1];
  for (let i = 0; i < 8 && cur && cur !== path.dirname(cur); i += 1) {
    if (existsSync(path.join(cur, "package.json")) && path.basename(cur) === leaf)
      return cur;
    cur = path.dirname(cur);
  }
  return null;
}

// ── 1. pack + 解包成 registry 形态 ───────────────────────────────────────────

const work = mkdtempSync(path.join(tmpdir(), "vx-packed-"));
const scopeRoot = path.join(work, "node_modules", "@vxture");
mkdirSync(scopeRoot, { recursive: true });

let skipped = false;
for (const p of PACKAGES) {
  const pkgDir = path.join(ROOT, p.dir);
  if (!existsSync(path.join(pkgDir, "dist"))) {
    console.log(`⚠ 跳过 ${p.name}:dist 缺失 —— 请先 build 再跑本检查。`);
    skipped = true;
    continue;
  }
  // 发布文件清单向 npm 要,不自己解释 `files` 字段——`files` 有默认包含项
  // (package.json / README / LICENSE)、有 .npmignore 交互、有目录展开规则,
  // 照着 `files` 推正是 #268 报告人特意不做的事(他解了真 tarball)。
  // `--dry-run --json` 走的是 pack 的同一条清单代码路径,拿到的就是真发布集,
  // 又免掉解包:tar 在 Windows 上会把 "C:\..." 当成远程主机名。
  const listed = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--dry-run", "--json"],
    {
      cwd: pkgDir,
      encoding: "utf8",
      shell: process.platform === "win32",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (listed.status !== 0) {
    fail(
      `${p.name}:npm pack --dry-run 失败 —— ${(listed.stderr || listed.error?.message || "").trim()}`,
    );
    continue;
  }
  let files;
  try {
    // 从第一个 '[' 起截取:不同 npm 版本 / 不同 loglevel 下 stdout 可能带前缀
    // 说明行,直接 JSON.parse 整个 stdout 会因环境而异地失败。
    const raw = listed.stdout ?? "";
    const start = raw.indexOf("[");
    if (start < 0) throw new Error("stdout 里没有 JSON 数组");
    files = JSON.parse(raw.slice(start))[0].files.map((f) => f.path);
  } catch (err) {
    fail(
      `${p.name}:解析发布清单失败 —— ${err.message}\n` +
        `  stdout 开头:${(listed.stdout ?? "").slice(0, 200)}`,
    );
    continue;
  }

  const dest = path.join(scopeRoot, p.name);
  for (const relFile of files) {
    const from = path.join(pkgDir, relFile);
    const to = path.join(dest, relFile);
    if (!existsSync(from)) continue; // npm 列了但磁盘上没有:不该发生,忽略即可
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  notes.push(`${p.name}:发布 ${files.length} 个文件`);

  // 把依赖接上。真实消费方装包时装管器会把 dependencies 装好、peer 由消费方
  // 提供(react 等本仓有);不接的话 `import dist/server.mjs` 会因缺 clsx 而失败——
  // 那是 fixture 的残缺,不是包的缺陷,当成缺陷报出来就是误报。
  // @vxture/* 一律指向**打包出来的**那份,不是工作区那份:否则伞包又软链回
  // 完整签出,本脚本要验的 registry 形态就被绕过去了。
  const depPkg = JSON.parse(
    readFileSync(path.join(pkgDir, "package.json"), "utf8"),
  );
  const req = createRequire(path.join(pkgDir, "package.json"));
  const nm = path.join(dest, "node_modules");
  for (const dep of [
    ...Object.keys(depPkg.dependencies ?? {}),
    ...Object.keys(depPkg.peerDependencies ?? {}),
  ]) {
    const link = path.join(nm, dep);
    if (existsSync(link)) continue;
    let target;
    if (dep.startsWith("@vxture/")) {
      target = path.join(scopeRoot, dep.slice("@vxture/".length));
    } else {
      target = resolvePackageRoot(req, dep);
      if (!target) continue; // 可选 peer 未装:消费方那边同样可以不装
    }
    if (!existsSync(target)) continue;
    mkdirSync(path.dirname(link), { recursive: true });
    // Windows 上 "junction" 不需要管理员权限,"dir" 需要。
    symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  }
}

if (skipped) {
  console.log("\n── 汇总 ──\nerror: 0   skipped: 1（dist 未就绪，未做断言）");
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

// ── 2. 已发布 CSS 里的 @source / @import 目标必须在这棵树里 ──────────────────

const SOURCE_RE = /@source\s+(?:not\s+)?["']([^"']+)["']/g;
const IMPORT_RE = /@import\s+["']([^"']+)["']/g;
const resolvedSourceDirs = [];

for (const p of PACKAGES) {
  const packedDir = path.join(scopeRoot, p.name);
  for (const cssFile of walk(packedDir, [".css"])) {
    const css = readFileSync(cssFile, "utf8");
    const rel = path.relative(scopeRoot, cssFile).replaceAll("\\", "/");

    for (const [, target] of css.matchAll(SOURCE_RE)) {
      // @source 只吃路径,相对声明它的那个文件。
      const abs = path.resolve(path.dirname(cssFile), target);
      if (existsSync(abs)) {
        resolvedSourceDirs.push(abs);
        pass(`@source 命中：${rel} → ${target}`);
      } else {
        fail(
          `@source 目标在发布包里不存在：${rel} → ${target}\n` +
            `  （解析到 ${path.relative(scopeRoot, abs).replaceAll("\\", "/")}）\n` +
            `  Tailwind 对此**不报错**：规则静默不产出，消费方看到的是无样式组件。\n` +
            `  多半是指向了 src/ 而 files 只发 dist —— 这在 monorepo 里通、装完就断。`,
        );
      }
    }

    for (const [, spec] of css.matchAll(IMPORT_RE)) {
      if (spec.startsWith(".") || spec.startsWith("/")) {
        const abs = path.resolve(path.dirname(cssFile), spec);
        if (!existsSync(abs)) {
          fail(`@import 相对目标不存在：${rel} → ${spec}`);
        }
        continue;
      }
      if (!spec.startsWith("@vxture/")) continue; // 三方样式由消费方装,不在本树内
      // 形如 @vxture/design-tokens/styles/tokens.css。**必须走 exports 映射**:
      // 子路径是对外契约名,磁盘位置(src/styles/…)是内部布局,两者不一定同名;
      // 按字面拼路径既会误报,也验不到 exports 漏声明这个真实故障。
      const [, depName, ...restParts] = spec.split("/");
      const subpath = `./${restParts.join("/")}`;
      const depPkgJson = path.join(scopeRoot, depName, "package.json");
      if (!existsSync(depPkgJson)) {
        fail(`@import 指向未发布的包：${rel} → ${spec}`);
        continue;
      }
      const depExports =
        JSON.parse(readFileSync(depPkgJson, "utf8")).exports ?? {};
      const mapped = depExports[subpath];
      if (typeof mapped !== "string") {
        fail(
          `@import 的子路径未在 ${depName} 的 exports 里声明：${rel} → ${spec}\n` +
            `  消费方 import 会直接解析失败。`,
        );
        continue;
      }
      const abs = path.join(scopeRoot, depName, mapped);
      if (!existsSync(abs)) {
        fail(
          `@import 的目标已在 exports 声明但未发布：${rel} → ${spec}\n` +
            `  （exports 指向 ${mapped}，该文件不在 ${depName} 的发布集里）`,
        );
      }
    }
  }
}

// ── 3. @source 目标里必须真有工具类(路径对 ≠ 内容对) ─────────────────────────

if (resolvedSourceDirs.length > 0) {
  const scanned = resolvedSourceDirs.flatMap((d) =>
    statSync(d).isDirectory() ? walk(d, [".mjs", ".cjs", ".js", ".tsx"]) : [d],
  );
  const haystack = scanned.map((f) => readFileSync(f, "utf8")).join("\n");
  for (const cls of REQUIRED_UTILITIES) {
    if (haystack.includes(cls)) {
      pass(`@source 目标内扫得到 ${cls}`);
    } else {
      fail(
        `@source 目标内扫不到工具类 ${cls} —— 路径存在但内容不对，` +
          `消费方仍会拿到无样式组件。`,
      );
    }
  }
  notes.push(`@source 覆盖 ${scanned.length} 个产物文件`);
} else if (errors.length === 0) {
  fail("已发布 CSS 里一条 @source 都没有 —— 组件工具类不会被消费方扫到。");
}

// ── 4. /server 的类型面不得宽于运行时面 ─────────────────────────────────────

/** 用 TS 编译器取模块在**值空间**的导出名(类型-only 导出不算)。 */
function valueExportsOfDts(dtsAbs) {
  const probe = path.join(path.dirname(dtsAbs), "__vx_probe__.ts");
  const host = ts.createCompilerHost({});
  const original = host.readFile.bind(host);
  // 用去掉 .d.ts 的相对说明符,交给 TS 自己按 moduleResolution 解析。
  // 不能用 pathToFileURL().pathname:Windows 上会得到 "/D:/…" 且空格被百分号编码。
  const spec = "./" + path.basename(dtsAbs).replace(/\.d\.ts$/, "");
  host.readFile = (f) =>
    path.resolve(f) === path.resolve(probe)
      ? `import * as NS from ${JSON.stringify(spec)};\nexport default NS;\n`
      : original(f);
  host.fileExists = (f) =>
    path.resolve(f) === path.resolve(probe) || existsSync(f);

  const program = ts.createProgram(
    [probe],
    {
      noEmit: true,
      skipLibCheck: true,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
    },
    host,
  );
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(probe);
  if (!sf) return null;

  let moduleSymbol = null;
  ts.forEachChild(sf, (node) => {
    if (ts.isImportDeclaration(node)) {
      moduleSymbol = checker.getSymbolAtLocation(node.moduleSpecifier);
    }
  });
  if (!moduleSymbol) return null;

  const names = new Set();
  for (const sym of checker.getExportsOfModule(moduleSymbol)) {
    let s = sym;
    if (s.flags & ts.SymbolFlags.Alias) {
      try {
        s = checker.getAliasedSymbol(s);
      } catch {
        /* 解不开别名就按原样判断 */
      }
    }
    if (s.flags & ts.SymbolFlags.Value) names.add(sym.name);
  }
  return names;
}

for (const entry of SERVER_ENTRIES) {
  const pkgName = entry.pkg.slice("@vxture/".length);
  const dtsAbs = path.join(scopeRoot, pkgName, entry.dts);
  const mjsAbs = path.join(scopeRoot, pkgName, entry.mjs);
  if (!existsSync(dtsAbs) || !existsSync(mjsAbs)) {
    fail(`${entry.pkg}:发布包里缺 ${entry.dts} 或 ${entry.mjs}`);
    continue;
  }

  const typeNames = valueExportsOfDts(dtsAbs);
  if (!typeNames) {
    fail(`${entry.pkg}:无法解析 ${entry.dts} 的导出面`);
    continue;
  }

  let runtimeNames;
  try {
    const mod = await import(pathToFileURL(mjsAbs).href);
    runtimeNames = new Set(Object.keys(mod));
  } catch (err) {
    fail(`${entry.pkg}:${entry.mjs} 导入失败 —— ${err.message}`);
    continue;
  }

  const phantom = [...typeNames].filter((n) => !runtimeNames.has(n));
  if (phantom.length === 0) {
    pass(
      `${entry.pkg} 的 /server 类型面 == 运行时面（${runtimeNames.size} 个导出）`,
    );
  } else {
    fail(
      `${entry.pkg} 的 /server 类型面比运行时面多 ${phantom.length} 个值导出：\n` +
        `  ${phantom.slice(0, 12).join(", ")}${phantom.length > 12 ? ` …(共 ${phantom.length})` : ""}\n` +
        `  消费方 import 这些名字 tsc 零错误、运行时 undefined —— 类型系统在为` +
        `错误写法背书，且只在那条渲染路径被走到时才炸，可能已经到生产。\n` +
        `  典型成因：\`export type *\` 被 dts rollup 擦掉 type 修饰符（#268）。`,
    );
  }
}

rmSync(work, { recursive: true, force: true });

console.log("\n── 汇总 ──");
for (const n of notes) console.log(`· ${n}`);
console.log(`error: ${errors.length}`);
process.exit(errors.length > 0 ? 1 : 0);
