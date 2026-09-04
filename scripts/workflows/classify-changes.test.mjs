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
  "platform_opera",
  "platform_arche",
  "platform_accounts",
  "platform_bff-gateway",
  "platform_bff-auth",
  "platform_bff-website",
  "platform_bff-console",
  "platform_bff-admin",
  "platform_bff-opera",
  "platform_bff-arche",
  "platform_bff-platform-api",
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
    name: "前端共享库 packages/platform",
    files: ["packages/platform/browser/src/x.ts"],
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
// 设计三包已迁至 vxture/vxture-design（2026-08-21），本仓从 registry 消费。
// 保留这条用例而不是删掉：它现在钉的是「这条路径不再扇出任何镜像」——如果哪天
// 有人把设计包又拉回本仓、或误加了一条把它映射到镜像的规则，这里会红。
// 删掉它则什么都保证不了。
test("image set: packages/design 已迁出 → 不产生任何镜像", () => {
  assert.deepEqual(builtImages(["packages/design/design-system/src/x.ts"]), []);
});

/* 真实的前端共享库扇出改由 packages/platform 覆盖。
 *
 * 2026-08-26 加入 opera：它接 i18n 时开始依赖 `@vxture/platform-browser`
 * （语言切换要写跨门户偏好）。分类器是从 pnpm 工作区依赖图**派生**扇出的，
 * 所以它自己就跟上了；这份清单是钉子，得手动跟。
 *
 * 这条断言的价值正在于此：加一条工作区依赖会改变发版时的构建面，而那件事
 * 在 package.json 的 diff 里看不出来。它红一次，就是让人看见一次。 */
test("image set: packages/platform → 仅前端镜像", () => {
  assert.deepEqual(builtImages(["packages/platform/browser/src/x.ts"]), [
    "platform_website",
    "platform_console",
    "platform_admin",
    "platform_opera",
    "platform_arche",
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
  // @vxture/service-organization. platform-api joined the consumers on
  // 2026-09-04 (console 批 5b: the account-deletion purge job soft-deletes the
  // personal tenant through OrganizationService).
  assert.deepEqual(builtImages(["services/identity/organization/src/x.ts"]), [
    "platform_bff-auth",
    "platform_bff-website",
    "platform_bff-console",
    "platform_bff-platform-api",
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
  // 断言用推导出的 owner 拼接，而不是写死组织名——写死的话，下次迁仓时
  // 测试会跟着源码一起绿，正好挡不住它本该挡的那个回归。
  assert.equal(
    include[0].image,
    `ghcr.io/${process.env.GITHUB_REPOSITORY_OWNER || "vxture-platform"}/platform_admin`,
  );
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

// ── tag 增量构建（B11）────────────────────────────────────────────────────────
// tag 模式下的分类走与 main 相同的规则；未命中的镜像进 reuse 集（retag 复用上一版
// manifest）。`--base-tag` 注入基准使测试免于依赖仓库的真实 tag 列表；
// `--base-tag none` 模拟系列首发——那时才保留全建。

/** tag 模式跑一次 --matrix，解析 matrix / reuse 两个集合。 */
function classifyTag(files, baseTag) {
  const out = execFileSync(
    process.execPath,
    [SCRIPT, "--files", files.join(","), "--matrix", "--base-tag", baseTag],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REF_TYPE: "tag",
        GITHUB_REF_NAME: "v9.9.9",
      },
    },
  );
  const pick = (key) => {
    const line = out.split(/\r?\n/u).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1) : "";
  };
  return {
    build: JSON.parse(pick("matrix")).include.map((entry) => entry.name),
    reuse: JSON.parse(pick("reuse")).include,
    any: pick("any"),
    anyReuse: pick("any_reuse"),
    deployable: pick("deployable"),
  };
}

// varda 已迁独立仓（2026-08-18）：清单本就不含 varda_*，全建即全清单。
test("matrix: tag 系列首发（无基准）→ 全平台镜像，reuse 空", () => {
  const r = classifyTag(["docs/noop.md"], "none");
  assert.deepEqual(r.build, ALL_IMAGES);
  assert.deepEqual(r.reuse, []);
  assert.equal(r.deployable, "true");
});

test("matrix: tag + 基准 + 仅 bff/auth-bff → 只建 bff-auth，其余 11 个 reuse", () => {
  const r = classifyTag(["bff/auth-bff/src/x.ts"], "v9.9.8");
  assert.deepEqual(r.build, ["platform_bff-auth"]);
  assert.equal(r.reuse.length, ALL_IMAGES.length - 1);
  assert.equal(r.anyReuse, "true");
  // reuse 条目携带 retag job 需要的最小信息：镜像引用 + 复制来源 tag。
  const website = r.reuse.find((entry) => entry.name === "platform_website");
  assert.ok(website, "未变更镜像应在 reuse 集里");
  assert.equal(website.prevTag, "v9.9.8");
  assert.match(website.image, /^ghcr\.io\//u);
});

test("matrix: tag + 基准 + pnpm-lock（全局规则）→ 全建，reuse 空", () => {
  const r = classifyTag(["pnpm-lock.yaml"], "v9.9.8");
  assert.deepEqual(r.build, ALL_IMAGES);
  assert.deepEqual(r.reuse, []);
});

test("matrix: tag + 基准 + docs-only → 零构建、12 个全 reuse，仍 deployable", () => {
  const r = classifyTag(["docs/x.md"], "v9.9.8");
  assert.deepEqual(r.build, []);
  assert.equal(r.any, "false");
  assert.equal(r.reuse.length, ALL_IMAGES.length);
  // tag 恒可部署：镜像全复用也要走一遍 deploy（nginx 模板等仓内配置可能变了）。
  assert.equal(r.deployable, "true");
});

test("base-tag 解析：重跑旧 tag 取的是它的前驱，不是更新的 tag", () => {
  // 用仓库的真实 tag 史（append-only）：v0.24.6 的系列前驱是 v0.24.5。
  // 此刻 v0.25.0 已存在——若实现取「除自己外最新」，这里会解析成 v0.25.0，
  // diff 出负向变更集。钉 index+1 的紧邻前驱语义。
  const out = execFileSync(
    process.execPath,
    [SCRIPT, "--files", "docs/x.md", "--matrix"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REF_TYPE: "tag",
        GITHUB_REF_NAME: "v0.24.6",
      },
    },
  );
  const line = out.split(/\r?\n/u).find((l) => l.startsWith("base_tag="));
  assert.equal(line, "base_tag=v0.24.5");
});

test("matrix: 非 tag 不产生 reuse（main push 不走复用路径）", () => {
  const r = classify(["bff/auth-bff/src/x.ts"], ["--matrix"]);
  assert.deepEqual(JSON.parse(r.reuse).include, []);
  assert.equal(r.any_reuse, "false");
});
