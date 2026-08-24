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

/**
 * 同系列上一个 tag（v* 按版本序、dev- 与 beta- 前缀按创建时间序）。
 *
 * 取「排序中紧邻当前 tag 的下一个」而不是「除自己外的第一个」：重跑一个旧 tag 的
 * 构建时（v0.24.6 重跑而 v0.25.0 已存在），后者会把**更新的** tag 当基准，diff 出一个
 * 负向变更集。找不到（系列首发、当前 tag 不在列表）返回 null → 调用方回退全建。
 */
function previousSeriesTag(refName) {
  let pattern;
  let sort;
  if (/^v\d/u.test(refName)) {
    pattern = "v*.*.*";
    sort = "-v:refname";
  } else if (refName.startsWith("beta-")) {
    pattern = "beta-*";
    sort = "-creatordate";
  } else if (refName.startsWith("dev-")) {
    pattern = "dev-*";
    sort = "-creatordate";
  } else {
    return null;
  }

  try {
    const tags = splitLines(
      runGit(["tag", "--list", pattern, `--sort=${sort}`]),
    );
    const index = tags.indexOf(refName);
    return index >= 0 && index + 1 < tags.length ? tags[index + 1] : null;
  } catch {
    return null;
  }
}

/**
 * reuse 候选的存在性校验：上一版的该镜像必须真在 registry 里（上一次发版可能
 * 恰好在这个镜像上失败过）。查不到就把它挪回构建集——**fail-closed 到构建**，
 * 宁可多建一个，不可发出一个引用不存在镜像的 tag。
 *
 * 需要调用环境已 `docker login`（workflow 的 detect job 负责）；本地/测试不传
 * `--verify-reuse`，跳过。
 */
function imageExistsInRegistry(imageRef) {
  try {
    execFileSync("docker", ["buildx", "imagetools", "inspect", imageRef], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
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

/**
 * `tagFullBuild` 只在「tag 且拿不到系列基准」时为真——系列首发、或 tag 列表异常。
 * 有基准的 tag 走与 main 完全相同的规则评估：未命中任何规则的镜像不重建，由
 * docker-build 的 retag job 把上一版 manifest 复制到新 tag（tag 完整性不变，
 * 「一个 tag = 一整套镜像都存在」仍然成立）。2026-08-24 前 tag 一律全建——那是
 * 为 tag 完整性付的全价，改名复用把这笔账消掉了。
 */
function collectReasons(changedFiles, imageName, tagFullBuild) {
  if (tagFullBuild) {
    // varda 已迁独立仓 vxture-varda(2026-08-18):镜像清单不再含 varda_*。
    return ["release tag without a prior series tag builds all images"];
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
const refName =
  (process.env.GITHUB_REF_NAME ?? "").trim() ||
  githubRef.replace(/^refs\/tags\//u, "");
// tag 的 diff 基准：同系列上一个 tag。`--base-tag <tag>` 供测试注入；
// `--base-tag none` 模拟系列首发（强制全建）。
const baseTagOption = options.get("base-tag") ?? "";
const baseTag = !isTagRef
  ? null
  : baseTagOption === "none"
    ? null
    : baseTagOption || previousSeriesTag(refName);
const tagFullBuild = isTagRef && baseTag === null;
// `--files` 注入：直接喂逗号/换行分隔的文件清单（绕过 git diff），用于回归测试断言
// 各分类规则对代表性路径的判定，无需真实提交。生产路径仍走 listChangedFiles。
const filesOverride = options.get("files") ?? process.env.CHANGED_FILES ?? "";
const changedFiles = filesOverride
  ? splitLines(filesOverride.replaceAll(",", "\n"))
  : isTagRef && baseTag !== null
    ? listChangedFiles(baseTag, headSha)
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
  (entry) => collectReasons(changedFiles, entry.name, tagFullBuild).length > 0,
).map((entry) => entry.name);
writeOutput("affected_images", JSON.stringify(affectedImages), outputFile);

if (imageName) {
  const reasons = collectReasons(changedFiles, imageName, tagFullBuild);
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
    (image) => collectReasons(changedFiles, image, tagFullBuild).length > 0,
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
  const toBuild = [];
  const toReuse = [];
  for (const entry of IMAGES) {
    if (collectReasons(changedFiles, entry.name, tagFullBuild).length > 0) {
      toBuild.push(entry);
    } else if (isTagRef && baseTag !== null) {
      // tag 上未命中任何规则的镜像不重建：retag job 把 `:baseTag` 的 manifest
      // 复制到新 tag（GHCR + ACR，秒级、不传层），tag 完整性不变。
      toReuse.push(entry);
    }
  }

  // `--verify-reuse`（workflow 的 detect job 已 docker login）：reuse 源镜像必须
  // 真在 GHCR。查不到就挪回构建集——fail-closed 到构建。
  if (options.get("verify-reuse") === "true" && toReuse.length > 0) {
    for (let index = toReuse.length - 1; index >= 0; index -= 1) {
      const entry = toReuse[index];
      const sourceRef = `${entry.image}:${baseTag}`;
      if (!imageExistsInRegistry(sourceRef)) {
        console.log(
          `reuse source missing, falling back to build: ${sourceRef}`,
        );
        toReuse.splice(index, 1);
        toBuild.push(entry);
      }
    }
  }

  const include = toBuild.map((entry) => ({
    name: entry.name,
    image: entry.image,
    dockerfile: entry.dockerfile,
    "build-args": entry["build-args"],
  }));
  const reuseInclude = toReuse.map((entry) => ({
    name: entry.name,
    image: entry.image,
    prevTag: baseTag,
  }));
  const anyImageBuild = include.length > 0;
  const deployChanged = changedFiles.some(
    (filePath) =>
      filePath.startsWith("deploy/") && !filePath.startsWith("deploy/docker/"),
  );
  const deployable = isTagRef || anyImageBuild || deployChanged;

  writeOutput("matrix", JSON.stringify({ include }), outputFile);
  writeOutput("any", String(anyImageBuild), outputFile);
  writeOutput("reuse", JSON.stringify({ include: reuseInclude }), outputFile);
  writeOutput("any_reuse", String(reuseInclude.length > 0), outputFile);
  writeOutput("base_tag", baseTag ?? "", outputFile);
  writeOutput("deployable", String(deployable), outputFile);
}
