#!/usr/bin/env node
/**
 * classify-changes.mjs - GitHub Actions 路径影响分类。
 * @package  @vxture/repo
 * @layer    Infrastructure
 * @category workflow
 * @description
 *   集中维护 CI 与 Docker workflow 的路径分类规则，避免 required check 因
 *   workflow 级路径过滤缺失。
 *
 * @author AI-Generated
 * @date 2026-06-01
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";

import { IMAGES, ALL_IMAGE_NAMES } from "./images.mjs";

const ZERO_SHA_PATTERN = /^0{40}$/u;

const ALL_IMAGES = ALL_IMAGE_NAMES;

const DOCKER_GLOBAL_RULES = [
  {
    reason: "workspace metadata changed",
    exact: [
      ".dockerignore",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.base.json",
      ".github/workflows/docker-build.yml",
    ],
  },
  {
    reason: "shared or core packages changed",
    prefixes: ["packages/shared/", "packages/core/"],
  },
];

// Derive each image's watch-paths from the actual pnpm workspace dependency
// graph, instead of a hand-maintained list that silently drifts when packages
// move (e.g. services/tenant/organization -> services/identity/organization) or
// gain deps. An image rebuilds when its own source, its Dockerfile, or ANY of
// its transitive @vxture/* workspace deps change. Shared/core packages are also
// covered by DOCKER_GLOBAL_RULES (build-all), so drift there can't hide an image.
function loadWorkspacePackages() {
  const map = new Map(); // pkgName -> { dir: 'path/', deps: string[] }
  const roots = [
    "services",
    "bff",
    "packages",
    "portals",
    "agent-server",
    "agent-studio",
  ];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "package.json") {
        try {
          const pkg = JSON.parse(readFileSync(full, "utf8"));
          if (!pkg.name) continue;
          const deps = Object.keys({
            ...pkg.dependencies,
            ...pkg.devDependencies,
          }).filter((d) => d.startsWith("@vxture/"));
          map.set(pkg.name, { dir: `${dir}/`, deps });
        } catch {
          // ignore unreadable / invalid package.json
        }
      }
    }
  };
  for (const root of roots) walk(root);
  return map;
}

function transitiveDepDirs(rootPkgName, pkgMap) {
  const dirs = new Set();
  const seen = new Set();
  const stack = [rootPkgName];
  while (stack.length > 0) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const entry = pkgMap.get(name);
    if (!entry) continue;
    dirs.add(entry.dir);
    for (const dep of entry.deps) stack.push(dep);
  }
  return dirs;
}

function buildImageRules() {
  const pkgMap = loadWorkspacePackages();
  const rules = new Map();
  for (const img of IMAGES) {
    const buildArgs = img["build-args"] ?? "";
    const prefixes = new Set();
    const filter = buildArgs.match(/PACKAGE_FILTER=(@vxture\/\S+)/)?.[1];
    if (filter) {
      for (const dir of transitiveDepDirs(filter, pkgMap)) prefixes.add(dir);
    }
    const ownPath = buildArgs.match(/(?:SERVICE_PATH|PORTAL_PATH)=(\S+)/)?.[1];
    if (ownPath) prefixes.add(`${ownPath.replace(/\/+$/, "")}/`);
    if (img.name === "platform_bff-gateway") prefixes.add("bff/gateway-bff/");
    rules.set(img.name, [
      {
        reason: `${img.name} source, Dockerfile, or a workspace dependency changed`,
        exact: [img.dockerfile],
        prefixes: [...prefixes].sort(),
      },
    ]);
  }
  return rules;
}

const IMAGE_RULES = buildImageRules();

function parseArgs(argv) {
  const options = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options.set(key, "true");
      continue;
    }

    options.set(key, next);
    index += 1;
  }

  return options;
}

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function isUsableSha(value) {
  return Boolean(value) && !ZERO_SHA_PATTERN.test(value);
}

function listChangedFiles(baseSha, headSha) {
  const normalizedHead = isUsableSha(headSha) ? headSha : "HEAD";

  if (isUsableSha(baseSha)) {
    try {
      return splitLines(
        runGit(["diff", "--name-only", baseSha, normalizedHead]),
      );
    } catch {
      // GitHub 的浅克隆或特殊事件可能缺少 base，下面回退到父提交或全量文件。
    }
  }

  try {
    return splitLines(
      runGit(["diff", "--name-only", `${normalizedHead}^`, normalizedHead]),
    );
  } catch {
    return splitLines(runGit(["ls-files"]));
  }
}

function splitLines(output) {
  return output
    .split(/\r?\n/u)
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
}

function isDocsFile(filePath) {
  return (
    filePath === "AGENTS.md" ||
    filePath.endsWith(".md") ||
    filePath.endsWith(".mdx") ||
    filePath.startsWith("docs/")
  );
}

function matchesRule(filePath, rule) {
  const exact = rule.exact ?? [];
  const prefixes = rule.prefixes ?? [];

  return (
    exact.includes(filePath) ||
    prefixes.some((prefix) => filePath.startsWith(prefix))
  );
}

function collectReasons(changedFiles, imageName, isTagRef) {
  if (isTagRef) {
    // varda 已迁独立仓 vxture-varda(2026-08-18):镜像清单不再含 varda_*。
    return ["release tag builds all images"];
  }

  const reasons = new Set();

  for (const filePath of changedFiles) {
    for (const rule of DOCKER_GLOBAL_RULES) {
      if (matchesRule(filePath, rule)) {
        reasons.add(rule.reason);
      }
    }

    for (const rule of IMAGE_RULES.get(imageName) ?? []) {
      if (matchesRule(filePath, rule)) {
        reasons.add(rule.reason);
      }
    }
  }

  return [...reasons];
}

function writeOutput(name, value, outputFile) {
  const line = `${name}=${value}\n`;
  if (outputFile) {
    appendFileSync(outputFile, line);
  }
  console.log(line.trimEnd());
}

function writeMultilineOutput(name, value, outputFile) {
  const block = `${name}<<EOF\n${value}\nEOF\n`;
  if (outputFile) {
    appendFileSync(outputFile, block);
  }
  console.log(`${name}=${JSON.stringify(value)}`);
}

const options = parseArgs(process.argv.slice(2));
const baseSha = options.get("base") ?? process.env.BASE_SHA ?? "";
const headSha = options.get("head") ?? process.env.HEAD_SHA ?? "";
const imageName = options.get("image") ?? process.env.IMAGE_NAME ?? "";
const outputFile =
  options.get("github-output") ?? process.env.GITHUB_OUTPUT ?? "";
const githubRef = process.env.GITHUB_REF ?? "";
const githubRefType = process.env.GITHUB_REF_TYPE ?? "";
const isTagRef = githubRefType === "tag" || githubRef.startsWith("refs/tags/");
// `--files` 注入：直接喂逗号/换行分隔的文件清单（绕过 git diff），用于回归测试断言
// 各分类规则对代表性路径的判定，无需真实提交。生产路径仍走 listChangedFiles。
const filesOverride = options.get("files") ?? process.env.CHANGED_FILES ?? "";
const changedFiles = filesOverride
  ? splitLines(filesOverride.replaceAll(",", "\n"))
  : listChangedFiles(baseSha, headSha);
const docsOnly = changedFiles.length > 0 && changedFiles.every(isDocsFile);

if (imageName && !ALL_IMAGES.includes(imageName)) {
  throw new Error(`Unknown Docker image name: ${imageName}`);
}

writeOutput("changed_count", String(changedFiles.length), outputFile);
writeOutput("docs_only", String(docsOnly), outputFile);
writeMultilineOutput("changed_files", changedFiles.join("\n"), outputFile);

// CI build/test 变更门控：本次变更影响哪些镜像（= 构建目标），走 docker-build 同款
// 传递依赖规则。ci.yml 据此只建/smoke 受影响的 bundle，不重建无关组件（含 varda：
// 未影响 varda_* 就不建 varda）。tag ref 上按 docker-build 逻辑（可能全量），CI 只在
// PR/push main（非 tag）消费此输出。
const affectedImages = IMAGES.filter(
  (entry) => collectReasons(changedFiles, entry.name, isTagRef).length > 0,
).map((entry) => entry.name);
writeOutput("affected_images", JSON.stringify(affectedImages), outputFile);

if (imageName) {
  const reasons = collectReasons(changedFiles, imageName, isTagRef);
  const imageBuild = reasons.length > 0;

  writeOutput("image_build", String(imageBuild), outputFile);
  writeOutput(
    "image_reason",
    imageBuild ? reasons.join("; ") : "no image-impacting paths",
    outputFile,
  );
}

// B9: 聚合「是否需要部署」。供 docker-build 的 deployability job 计算后传给
// deploy-production 做触发门控。deployable = 任一镜像需构建 ∪ deploy/ 平台变更
// (排除 docker/) ∪ release tag。compose/env/scripts/database 改动（无镜像变更）仍须部署，故单列。
const aggregate = options.get("aggregate") === "true";
if (aggregate) {
  const anyImageBuild = ALL_IMAGES.some(
    (image) => collectReasons(changedFiles, image, isTagRef).length > 0,
  );
  const deployChanged = changedFiles.some(
    (filePath) =>
      filePath.startsWith("deploy/") && !filePath.startsWith("deploy/docker/"),
  );
  const deployable = isTagRef || anyImageBuild || deployChanged;

  writeOutput("any_image_build", String(anyImageBuild), outputFile);
  writeOutput("deploy_changed", String(deployChanged), outputFile);
  writeOutput("deployable", String(deployable), outputFile);
}

// B10: 动态 matrix 模式。算出本次需重建的镜像集合，输出 docker-build 可直接 fromJSON
// 的 matrix（`{include:[{name,image,dockerfile,build-args}]}`），并附带 `any`（是否非空）
// 与 `deployable`（供 detect job 同时产出部署门控 artifact）。docs/scripts-only → include
// 为空 → build job 整体跳过。
const wantMatrix = options.get("matrix") === "true";
if (wantMatrix) {
  const include = IMAGES.filter(
    (entry) => collectReasons(changedFiles, entry.name, isTagRef).length > 0,
  ).map((entry) => ({
    name: entry.name,
    image: entry.image,
    dockerfile: entry.dockerfile,
    "build-args": entry["build-args"],
  }));
  const anyImageBuild = include.length > 0;
  const deployChanged = changedFiles.some(
    (filePath) =>
      filePath.startsWith("deploy/") && !filePath.startsWith("deploy/docker/"),
  );
  const deployable = isTagRef || anyImageBuild || deployChanged;

  writeOutput("matrix", JSON.stringify({ include }), outputFile);
  writeOutput("any", String(anyImageBuild), outputFile);
  writeOutput("deployable", String(deployable), outputFile);
}
