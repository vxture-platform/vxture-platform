/**
 * classify-changes.test.mjs - allow-list 分类器回归测试。
 * @package  @vxture/repo
 * @layer    Infrastructure
 * @category workflow
 * @description
 *   用 `--files` 注入代表性文件清单，断言 deployable 闸门与逐镜像构建集合。
 *   锁定 allow-list 模型的「默认 SKIP」安全性：未命中规则的路径（docs/scripts/
 *   .github/未知根文件）一律不部署。直接吸收姊妹项目 umbra 的 deny-list 漏项坑
 *   （docs+scripts 误判可部署）——在本模型下该用例必为 deployable=false。
 *
 * 运行：node --test scripts/workflows/
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "classify-changes.mjs");

const ALL_IMAGES = [
  "platform_website",
  "platform_console",
  "platform_admin",
  "platform_capconsole",
  "platform_accounts",
  "platform_bff-gateway",
  "platform_bff-auth",
  "platform_bff-website",
  "platform_bff-console",
  "platform_bff-admin",
  "platform_bff-capconsole",
  "platform_bff-platform-api",
  "varda_bff",
  "varda_agent",
  "platform_service-model-platform",
];

/** 运行分类器并把 `key=value` 行解析为对象。 */
function classify(files, extraArgs = []) {
  const out = execFileSync(
    process.execPath,
    [SCRIPT, "--files", files.join(","), ...extraArgs],
    {
      encoding: "utf8",
    },
  );
  const result = {};
  for (const line of out.split(/\r?\n/u)) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      result[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return result;
}

/** 返回某文件清单下需要重建的镜像集合（逐镜像调用分类器）。 */
function builtImages(files) {
  return ALL_IMAGES.filter(
    (image) => classify(files, ["--image", image]).image_build === "true",
  );
}

// ── deployable 闸门（allow-list 默认 SKIP）──────────────────────────────────
const DEPLOYABLE_CASES = [
  { name: "docs-only", files: ["docs/x.md"], deployable: "false" },
  { name: "scripts-only", files: ["scripts/checks/y.sh"], deployable: "false" },
  {
    name: "docs + scripts (umbra deny-list 漏项陷阱)",
    files: ["docs/x.md", "scripts/checks/y.sh"],
    deployable: "false",
  },
  {
    name: ".github 非构建 workflow",
    files: [".github/ISSUE_TEMPLATE/x.md"],
    deployable: "false",
  },
  { name: "未知根文件", files: ["RANDOM_ROOT.toml"], deployable: "false" },
  {
    name: "单包源码 portals/admin",
    files: ["portals/admin/src/x.tsx"],
    deployable: "true",
  },
  {
    name: "前端共享库 packages/design",
    files: ["packages/design/design-system/src/x.ts"],
    deployable: "true",
  },
  {
    name: "核心库 packages/core",
    files: ["packages/core/auth/src/x.ts"],
    deployable: "true",
  },
  {
    name: "deploy (compose/env)",
    files: ["deploy/compose.platform.yml"],
    deployable: "true",
  },
];

for (const { name, files, deployable } of DEPLOYABLE_CASES) {
  test(`deployable: ${name} → ${deployable}`, () => {
    assert.equal(classify(files, ["--aggregate"]).deployable, deployable);
  });
}

// ── 逐镜像构建集合（monorepo 路径→包→镜像 + 共享库扇出）────────────────────
test("image set: packages/design → 仅前端镜像", () => {
  assert.deepEqual(builtImages(["packages/design/design-system/src/x.ts"]), [
    "platform_website",
    "platform_console",
    "platform_admin",
    "platform_capconsole",
    "platform_accounts",
  ]);
});

test("image set: packages/core → 全部镜像（全局规则）", () => {
  assert.deepEqual(builtImages(["packages/core/auth/src/x.ts"]), ALL_IMAGES);
});

test("image set: portals/admin → 仅 admin", () => {
  assert.deepEqual(builtImages(["portals/admin/src/x.tsx"]), [
    "platform_admin",
  ]);
});

test("image set: services/identity/iam → 依赖它的 BFF", () => {
  // Derived from real package.json deps: only auth-bff + console-bff import
  // @vxture/service-iam (website-bff does not), so a service-iam change must
  // rebuild exactly those two.
  assert.deepEqual(builtImages(["services/identity/iam/src/x.ts"]), [
    "platform_bff-auth",
    "platform_bff-console",
  ]);
});

test("image set: services/identity/organization → 依赖它的 BFF（回归 #28）", () => {
  // The org service moved services/tenant/organization -> services/identity/
  // organization; the old hand-maintained rules still pointed at the stale
  // path and silently missed console-bff/website-bff (a real console-login fix
  // nearly didn't ship). Derived rules must catch every real consumer of
  // @vxture/service-organization.
  assert.deepEqual(builtImages(["services/identity/organization/src/x.ts"]), [
    "platform_bff-auth",
    "platform_bff-website",
    "platform_bff-console",
    "varda_agent",
  ]);
});

test("image set: bff/auth-bff → 仅 bff-auth", () => {
  assert.deepEqual(builtImages(["bff/auth-bff/src/x.ts"]), [
    "platform_bff-auth",
  ]);
});

test("image set: docs-only → 空集（任何镜像都不重建）", () => {
  assert.deepEqual(builtImages(["docs/x.md", "scripts/checks/y.sh"]), []);
});

// ── workspace 元数据 / 构建 workflow → 全量重建 ─────────────────────────────
test("global rule: pnpm-lock.yaml → 全部镜像", () => {
  assert.deepEqual(builtImages(["pnpm-lock.yaml"]), ALL_IMAGES);
});

test("global rule: docker-build.yml → 全部镜像", () => {
  assert.deepEqual(
    builtImages([".github/workflows/docker-build.yml"]),
    ALL_IMAGES,
  );
});

// ── --matrix 动态 matrix（B10）────────────────────────────────────────────────
test("matrix: docs-only → 空 include，any=false", () => {
  const r = classify(["docs/x.md"], ["--matrix"]);
  assert.equal(r.any, "false");
  assert.deepEqual(JSON.parse(r.matrix).include, []);
});

test("matrix: docs + scripts → 空 include（umbra 陷阱）", () => {
  const r = classify(["docs/x.md", "scripts/checks/y.sh"], ["--matrix"]);
  assert.equal(r.any, "false");
  assert.deepEqual(JSON.parse(r.matrix).include, []);
});

test("matrix: portals/admin → 仅 admin，且携带完整构建配置", () => {
  const r = classify(["portals/admin/src/x.tsx"], ["--matrix"]);
  assert.equal(r.any, "true");
  const include = JSON.parse(r.matrix).include;
  assert.deepEqual(
    include.map((entry) => entry.name),
    ["platform_admin"],
  );
  assert.equal(include[0].dockerfile, "deploy/docker/Dockerfile.nextjs");
  assert.equal(include[0].image, "ghcr.io/vxture/platform_admin");
  assert.match(include[0]["build-args"], /PACKAGE_FILTER=@vxture\/admin/u);
});

test("matrix: pnpm-lock → 全部镜像", () => {
  const r = classify(["pnpm-lock.yaml"], ["--matrix"]);
  assert.equal(JSON.parse(r.matrix).include.length, ALL_IMAGES.length);
});

test("matrix include 镜像名与 ALL_IMAGES 一致（单一数据源对齐）", () => {
  const include = JSON.parse(
    classify(["pnpm-lock.yaml"], ["--matrix"]).matrix,
  ).include;
  assert.deepEqual(
    include.map((entry) => entry.name),
    ALL_IMAGES,
  );
});

// varda 已独立发布线（deploy-varda.yml）：平台部署 tag 的「全建」必须排除 varda_*。
test("matrix: 平台 tag ref → 全平台镜像但排除 varda_*", () => {
  const out = execFileSync(
    process.execPath,
    [SCRIPT, "--files", "docs/noop.md", "--matrix"],
    { encoding: "utf8", env: { ...process.env, GITHUB_REF_TYPE: "tag" } },
  );
  const line = out.split(/\r?\n/u).find((l) => l.startsWith("matrix="));
  const names = JSON.parse(line.slice("matrix=".length)).include.map(
    (entry) => entry.name,
  );
  assert.ok(names.length > 0, "平台 tag 应触发全建");
  assert.ok(
    !names.some((n) => n.startsWith("varda_")),
    `平台 tag 全建不应含 varda：${names.join(",")}`,
  );
  assert.deepEqual(
    names,
    ALL_IMAGES.filter((n) => !n.startsWith("varda_")),
  );
});
