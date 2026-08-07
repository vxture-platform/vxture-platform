#!/usr/bin/env node

/**
 * check-design-system-exports.mjs — @vxture/design-system 公开入口快照守卫。
 *
 * 依据 docs/10-standards/040-design-system-package-convergence.md 阶段 A：
 * 公开 JS/CSS 子路径的任何变化都必须经过显式评审。变化一旦确认，按
 * docs/10-standards/050-design-system-release.md 判定 SemVer 影响：
 *   新增公开入口 = minor；删除或改名公开入口 = major。
 *
 * 守卫两层契约：
 *   static  —— package.json 的 exports / files / peerDependencies（始终检查）
 *   runtime —— 已构建 dist 各入口的具名导出（dist 存在时检查）
 *
 * 用法：
 *   node scripts/guardrails/check-design-system-exports.mjs
 *   node scripts/guardrails/check-design-system-exports.mjs --strict   # dist 缺失即失败
 *   node scripts/guardrails/check-design-system-exports.mjs --update   # 显式更新快照
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const UPDATE = process.argv.includes("--update");
const STRICT = process.argv.includes("--strict");

const PKG_DIR = path.join(ROOT, "packages/design/design-system");
const PKG_PATH = path.join(PKG_DIR, "package.json");
const SNAPSHOT_PATH = path.join(
  ROOT,
  "scripts/guardrails/design-system-exports.snapshot.json",
);

/**
 * 需要枚举具名导出的 JS 入口，由 exports map 动态推导——凡目标是 .mjs/.cjs 的
 * 子路径都算（CSS 子路径无运行时导出）。写死清单会让新增入口的具名导出脱管。
 */
function runtimeEntries(exportsMap) {
  return Object.keys(exportsMap ?? {}).filter((subpath) => {
    const target = resolveRuntimeFile(exportsMap, subpath);
    return typeof target === "string" && /\.(mjs|cjs)$/.test(target);
  });
}

const problems = [];

function fail(message) {
  problems.push(message);
}

function normalize(value) {
  return value.replaceAll("\\", "/");
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObject(value[key])]),
    );
  }
  return value;
}

function readPackageJson() {
  if (!existsSync(PKG_PATH)) {
    console.error(`未找到 ${normalize(path.relative(ROOT, PKG_PATH))}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(PKG_PATH, "utf8"));
}

function collectStaticSurface(pkg) {
  return sortObject({
    name: pkg.name,
    files: [...(pkg.files ?? [])].sort(),
    peerDependencies: pkg.peerDependencies ?? {},
    exports: pkg.exports ?? {},
  });
}

/** 解析某个入口在 exports 中对应的运行时文件（优先 default/import）。 */
function resolveRuntimeFile(exportsMap, subpath) {
  const entry = exportsMap?.[subpath];
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  const target = entry.default ?? entry.import ?? entry.require;
  return typeof target === "string" ? target : null;
}

async function collectRuntimeSurface(pkg) {
  const exportsMap = pkg.exports ?? {};
  const surface = {};

  for (const subpath of runtimeEntries(exportsMap)) {
    const relative = resolveRuntimeFile(exportsMap, subpath);
    if (!relative) continue;

    const absolute = path.join(PKG_DIR, relative);
    if (!existsSync(absolute)) {
      const label = normalize(path.relative(ROOT, absolute));
      if (STRICT) {
        fail(`入口 ${subpath} 的构建产物缺失：${label}（--strict 下不允许跳过）`);
      } else {
        console.log(`· 跳过 ${subpath}：构建产物缺失（${label}）`);
      }
      continue;
    }

    try {
      const module = await import(pathToFileURL(absolute).href);
      surface[subpath] = Object.keys(module)
        .filter((key) => key !== "default" || "default" in module)
        .sort();
    } catch (error) {
      fail(`入口 ${subpath} 无法被载入：${error.message}`);
    }
  }

  return sortObject(surface);
}

function diffLists(expected, actual) {
  const removed = expected.filter((item) => !actual.includes(item));
  const added = actual.filter((item) => !expected.includes(item));
  return { removed, added };
}

function compareStatic(expected, actual) {
  const expectedJson = JSON.stringify(expected, null, 2);
  const actualJson = JSON.stringify(actual, null, 2);
  if (expectedJson === actualJson) return;

  const expectedPaths = Object.keys(expected.exports ?? {});
  const actualPaths = Object.keys(actual.exports ?? {});
  const { removed, added } = diffLists(expectedPaths, actualPaths);

  for (const subpath of removed) {
    fail(`删除公开入口 ${subpath} —— 按 050 规范属 major，必须显式评审`);
  }
  for (const subpath of added) {
    fail(`新增公开入口 ${subpath} —— 按 050 规范属 minor，必须显式评审`);
  }

  if (removed.length === 0 && added.length === 0) {
    fail(
      "公开契约内容发生变化（exports 目标 / files / peerDependencies），但子路径集合未变",
    );
  }
}

function compareRuntime(expected, actual) {
  const subpaths = new Set([...Object.keys(expected), ...Object.keys(actual)]);

  for (const subpath of subpaths) {
    const expectedNames = expected[subpath];
    const actualNames = actual[subpath];

    // 本次未收集到（dist 缺失且非 strict）：不与快照对比，避免误报。
    if (!actualNames) continue;

    if (!expectedNames) {
      fail(`快照中缺少入口 ${subpath} 的具名导出记录，请运行 --update 补齐`);
      continue;
    }

    const { removed, added } = diffLists(expectedNames, actualNames);
    for (const name of removed) {
      fail(`入口 ${subpath} 删除具名导出 ${name} —— 按 050 规范属 major`);
    }
    for (const name of added) {
      fail(`入口 ${subpath} 新增具名导出 ${name} —— 按 050 规范属 minor`);
    }
  }
}

async function main() {
  const pkg = readPackageJson();
  const actual = {
    static: collectStaticSurface(pkg),
    runtime: await collectRuntimeSurface(pkg),
  };

  if (UPDATE) {
    const payload = {
      $comment:
        "@vxture/design-system 公开入口快照。变更必须按 docs/10-standards/050-design-system-release.md 判定 SemVer 影响后，用 --update 显式更新。",
      ...actual,
    };
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(
      `已更新快照：${normalize(path.relative(ROOT, SNAPSHOT_PATH))}\n` +
        "⚠ 请在 PR 描述中说明入口变化及对应的版本号影响（patch / minor / major）。",
    );
    return;
  }

  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(
      `未找到快照文件 ${normalize(path.relative(ROOT, SNAPSHOT_PATH))}\n` +
        "首次建立请运行：node scripts/guardrails/check-design-system-exports.mjs --update",
    );
    process.exit(1);
  }

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  compareStatic(snapshot.static ?? {}, actual.static);
  compareRuntime(snapshot.runtime ?? {}, actual.runtime);

  if (problems.length > 0) {
    console.error("design-system 公开入口守卫未通过：\n");
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error(
      "\n若变化是预期的：先按 docs/10-standards/050-design-system-release.md 判定版本号，" +
        "再运行 node scripts/guardrails/check-design-system-exports.mjs --update 更新快照。",
    );
    process.exit(1);
  }

  console.log("design-system 公开入口守卫通过（0 violations）");
}

await main();
