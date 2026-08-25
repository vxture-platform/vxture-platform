#!/usr/bin/env node

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

/** admin token 桥里定义过的全部 `--vx-admin-*`。读一次，供 ds/no-undefined-admin-token 用。 */
let ADMIN_TOKEN_CACHE = null;
function adminTokenDefinitions() {
  if (ADMIN_TOKEN_CACHE) return ADMIN_TOKEN_CACHE;
  // 2026-08-18 桥迁回 admin 自有（owner 判「产品自有的全部迁出 DS」）。
  const dir = "portals/admin/assets/legacy-tokens";
  const names = new Set();
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".css")) continue;
      const text = readFileSync(`${dir}/${entry}`, "utf8");
      for (const m of text.matchAll(/(--vx-admin-[a-z0-9-]+)\s*:/g)) names.add(m[1]);
    }
  } catch {
    // 目录不在（子集检出）→ 规则自动噤声，不误报。
  }
  ADMIN_TOKEN_CACHE = names;
  return names;
}

const ROOT = process.cwd();
// 拆仓后本守卫是**双管辖**的:一半管 DS 自身(packages/design/**),一半管消费方
// 怎么用 DS(portals 的 globals.css、admin 的 style entry、legacy-tokens 目录)。
// design 仓没有 portals/business,平台仓拆完之后没有 packages/design——同一份脚本
// 要能在两边各管各的那一半,所以**跳过本仓不存在的扫描根**,而不是把缺失当违规。
//
// 这条不是放宽:每条规则的判据一个没动,只是不再对"本仓压根没有的目录"发难。
// 真正该做的是把脚本拆成 DS 内规与消费方内规两份,那是拆仓收尾的独立一项。
const SCAN_ROOTS = ["portals", "packages", "business"].filter((root) =>
  existsSync(path.join(ROOT, root)),
);
const SOURCE_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
]);
const UPDATE_BASELINE = process.argv.includes("--update-baseline");
const BASELINE_PATH = path.join(
  ROOT,
  "scripts/guardrails/design-system-baseline.json",
);
const DS_STYLE_HARDCODED_SCALE_BUDGET = 0;
/**
 * DS 叠放阶梯的取值。**首选仍是 `var(--z-index-*)` 语义名**；本表只是兜底，
 * 容许内联 style 等确实拿不到类名的场合直写档位值，档外取值一律拦。
 * 阶梯语义与推导依据见 scripts/design-tokens/semantic-policy.mjs 与
 * packages/design/design-system/docs/04-tokens-contract.md §8。
 */
const Z_LADDER = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900, 9999]);
const BASELINED_RULE_IDS = new Set([
  "ds/no-inline-design-style",
  "ds/no-native-primitive",
  "ds/no-app-vx-token-definitions",
  "ds/no-app-component-metric-token",
  "ds/no-app-hardcoded-scale",
  "ds/no-app-hardcoded-layout-scale",
  "ds/no-hardcoded-z-index",
  "ds/no-hardcoded-breakpoint",
  "ds/no-app-dark-overrides",
]);
const IGNORED_PARTS = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "storybook-static",
  // Showcase, not shippable/consumable DS code: the gallery's whole purpose is
  // to DISPLAY raw color/font values (colors_and_type.css), so no-raw-color /
  // no-illegal-font-family legitimately don't apply. Excluded to keep the
  // guardrail green on a clean tree.
  "design-system-gallery",
]);

const DS_ROOT = normalize("packages/design/design-system");
/**
 * 设计三包。凡"这是 DS 自己的代码，不受应用层规则约束"的判断都要认全三个，
 * 否则拆包之后 design-ui / design-tokens 会被当成业务代码误报。
 */
const DS_PACKAGE_ROOTS = [
  DS_ROOT,
  normalize("packages/design/design-ui"),
  normalize("packages/design/design-tokens"),
];
const isDsPackage = (file) =>
  DS_PACKAGE_ROOTS.some((root) => normalize(file).startsWith(`${root}/`));
const DS_TOKEN_PATHS = [
  normalize("packages/design/design-system/src/tokens"),
  normalize("packages/design/design-tokens/src/styles/tokens.css"),
];
// 顶层 tokens*.css 是历史平铺形态；primitive/ semantic/ components/ 是
// docs/10-standards/040-design-system-package-convergence.md §3 的目标结构，
// T1–T4 分层落地后 token 文件迁入这些子目录，同样属 DS token 层。
// 允许 primitive/ semantic/ components/ 下任意深度——排版原子按子命名空间
// 归入 primitive/typography/，只认一层会把它们判成裸值违规。
// token owner = 分层 token 模块（T1 primitive / T2 semantic）、聚合入口 tokens.css，
// 以及 @theme 注册 theme.css。theme.css 必须算 owner：断点与容器宽度进的是媒体查询
// 与容器查询，那里 var() 不参与求值，只能落字面量——它是有依据的刻度真值源，
// 不是"叶子里随手写死的数"。components/ 已随 T3 层退役。
const DS_RUNTIME_TOKEN_STYLE_PATTERN =
  /^packages\/design\/design-tokens\/src\/styles\/(?:tokens\.css|tailwind\.css|theme\.css|(?:primitive|semantic)\/(?:[\w-]+\/)*[\w-]+\.css)$/;
const DS_RUNTIME_SCALE_BRIDGE_VAR_PATTERN =
  /var\(--vx-(?:scale|platform-scale|auth-scale|console-scale|component-scale)-/;
const DS_RUNTIME_COMPONENT_METRIC_VAR_PATTERN = /var\(--vx-component-metric-/;
const LEGACY_SCALE_TOKEN_STYLE_PATHS = new Set(
  [
    "tokens-auth-controls-scale.css",
    "tokens-auth-experience-scale.css",
    "tokens-auth-scale-core.css",
    "tokens-component-scale.css",
    "tokens-console-scale.css",
    "tokens-platform-access-scale.css",
    "tokens-platform-account-scale.css",
    "tokens-platform-common-scale.css",
    "tokens-platform-layout-scale.css",
    "tokens-platform-models-scale.css",
    "tokens-platform-notifications-scale.css",
    "tokens-platform-scale.css",
    "tokens-platform-scale-core.css",
    "tokens-platform-scale-layout.css",
    "tokens-platform-shell-scale.css",
    "tokens-platform-tenant-settings-scale.css",
    "tokens-scale-flow.css",
    "tokens-scale-px.css",
    "tokens-scale-rem.css",
  ].map((name) => normalize(`${DS_ROOT}/src/styles/${name}`)),
);
const LEGACY_COMPONENT_METRIC_TOKEN_STYLE_PATHS = new Set(
  [
    "tokens-component-metrics.css",
    "tokens-component-metrics-em.css",
    "tokens-component-metrics-px.css",
    "tokens-component-metrics-rem.css",
    "tokens-component-metrics-rem-controls.css",
    "tokens-component-metrics-rem-fine.css",
    "tokens-component-metrics-rem-layout.css",
    "tokens-component-metrics-rem-ui.css",
  ].map((name) => normalize(`${DS_ROOT}/src/styles/${name}`)),
);
// platform.css 已删（2026-08-18，与 auth.css 同类空壳退役）——集合暂空，留位。
const DS_SEMANTIC_STYLE_PATHS = new Set([]);
/*
 * 原有 16 条 auth-* / components-* / platform-* 例外随遗留样式层退役而清空，
 * 仅 fullscreen.css 存活。清单不留已删路径：陈旧条目会让规则永远报 stale。
 */
const DS_EFFECT_LOCKED_STYLE_PATHS = new Set([
  normalize("packages/design/design-system/src/styles/fullscreen.css"),
]);
const DS_SHADOW_LOCKED_STYLE_PATHS = new Set([
  /* 全部条目随遗留样式层退役，无存活项。 */
]);
const IMPORT_ONLY_STYLE_ENTRIES = new Map([
  // varda 样式入口已随 vxture-varda 独立仓迁出(2026-08-18)。
  // auth.css 已删（2026-08-18）：认证样式归业务层，DS 不收业务含义的入口。
  /* platform.css 聚合入口已删（2026-08-18）：八条子模块退役后它只剩空壳。 */
  //
  // DS 自己的两个样式入口（design-system/globals.css、design-tokens/tokens.css）
  // 已随拆仓迁出（2026-08-21，vxture/vxture-design）。**本仓不再管别人包里的文件**
  // ——那两条约束在 design 仓仍然有效，由那边的同名守卫执行。
  //
  // 没有改成"路径不存在就跳过"：#363 已为缺失的**扫描根**加过一次跳过，这里再加
  // 一层就变成用启发式掩盖边界问题。管辖边界该由清单表达，不该由存在性猜测。
  [normalize("portals/admin/src/app/globals.css"), "admin globals.css"],
  [normalize("portals/admin/src/styles/admin-base.css"), "admin base.css"],
  [
    normalize("portals/admin/src/styles/admin-directory.css"),
    "admin directory.css",
  ],
  [
    normalize("portals/admin/src/styles/admin-governance.css"),
    "admin governance.css",
  ],
  [
    normalize("portals/admin/src/styles/admin-management-pills.css"),
    "admin management pills.css",
  ],
  [
    normalize("portals/admin/src/styles/admin-management.css"),
    "admin management.css",
  ],
  [
    normalize("portals/admin/src/styles/admin-operations.css"),
    "admin operations.css",
  ],
  [
    normalize("portals/admin/src/styles/admin-overview.css"),
    "admin overview.css",
  ],
  [
    normalize("portals/admin/src/styles/admin-permissions.css"),
    "admin permissions.css",
  ],
  [
    normalize("portals/admin/src/styles/admin-placeholder.css"),
    "admin placeholder.css",
  ],
  [normalize("portals/admin/src/styles/admin-roles.css"), "admin roles.css"],
  // admin-service-health.css 已删（2026-08-25）：服务健康页早已改用 DataTable 与
  // EmptyState，它下面四个子文件 30 个类**全仓零引用**。入口连同子文件一并退役。
  // 这条守卫在删除当天就报了红——清单与文件不同步正是它要抓的，按它的提示从清单
  // 里移除，而不是给守卫加一条"文件不存在就跳过"。
  [
    normalize("portals/admin/src/styles/admin-tenant-detail.css"),
    "admin tenant detail.css",
  ],
  [normalize("portals/console/src/app/globals.css"), "console globals.css"],
  [
    normalize("portals/console/src/styles/console-template.css"),
    "console template chrome.css",
  ],
  [normalize("portals/website/src/app/globals.css"), "website globals.css"],
  [
    normalize("portals/website/src/styles/website-legal.css"),
    "website legal.css",
  ],
  [
    normalize("portals/website/src/styles/website-marketing.css"),
    "website marketing.css",
  ],
]);
const FONT_LOADER_ALLOWLIST = [
  /^portals\/[^/]+\/src\/app\/layout\.tsx$/,
  /^portals\/[^/]+\/src\/app\/layout\.ts$/,
  /^agent-studio\/[^/]+\/src\/app\/layout\.tsx$/,
  /^agent-studio\/[^/]+\/src\/app\/layout\.ts$/,
  /^business\/[^/]+\/src\/app\/layout\.tsx$/,
  /^business\/[^/]+\/src\/app\/layout\.ts$/,
];
/** 真正把 next/font 拉进来的三种写法。散文里提到这个名字不算。 */
const NEXT_FONT_LOAD =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["']next\/font/;
const DIRECT_UI_ENGINE_DEPENDENCIES = [
  "@phosphor-icons/react",
  "lucide-react",
  "react-icons",
  /^@radix-ui\//,
];
/**
 * DS 的 manifest 从**已安装的 registry 包**读（2026-08-21 拆仓后）。
 *
 * 拆仓前它在 packages/design/design-system/ 下，是工作区成员；现在设计三包住在
 * vxture/vxture-design，本仓只作为消费方从 registry 装。继续按老路径读会在
 * 模块加载时就 ENOENT——而这条守卫管的是**消费方怎么用 DS**，正是拆仓后仍要留
 * 在本仓的那一半，不能因为读不到 manifest 就整条失效。
 *
 * 不用 require.resolve("@vxture/design-system/package.json")：该包的 exports 不
 * 暴露 ./package.json，深引会抛。改为解析主入口再上溯到包根。
 */
/** 列出目录下的子目录名；目录不存在时返回空数组。 */
function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function resolveDsManifest() {
  // 解析基点不能用仓根：根 package.json 不依赖设计包，只有门户依赖，而 pnpm 的
  // 严格布局下根目录没有那条链。从任一声明了该依赖的门户起算。
  const bases = [ROOT, ...listDirs(path.join(ROOT, "portals")).map((d) => path.join(ROOT, "portals", d))];
  let cur = null;
  for (const base of bases) {
    const manifestPath = path.join(base, "package.json");
    if (!existsSync(manifestPath)) continue;
    try {
      cur = path.dirname(createRequire(manifestPath).resolve("@vxture/design-system"));
      break;
    } catch {
      /* 该基点没装，换下一个 */
    }
  }
  if (!cur) {
    throw new Error(
      "找不到已安装的 @vxture/design-system。本守卫要读它的 manifest 才能知道" +
        "消费方允许引用哪些子入口——先 pnpm install（需 NODE_AUTH_TOKEN）。",
    );
  }
  for (let i = 0; i < 8 && cur && cur !== path.dirname(cur); i += 1) {
    const candidate = path.join(cur, "package.json");
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, "utf8"));
      if (manifest.name === "@vxture/design-system") return manifest;
    }
    cur = path.dirname(cur);
  }
  throw new Error("解析到了 @vxture/design-system 主入口，但上溯不到它的 package.json。");
}
/**
 * 拆仓后本仓已无此文件，两条以它为键的规则（no-stale-package-style-exports /
 * no-design-migration-artifacts）因此永远不匹配——它们管的是 DS 自己，已随包
 * 迁到 vxture/vxture-design。常量保留而不删：删了要连带改两条规则的形状，而
 * 那两条在 design 仓仍然有效，两边保持同一份脚本更省事。
 */
const DS_PACKAGE_JSON = normalize("packages/design/design-system/package.json");
const DS_PACKAGE_MANIFEST = resolveDsManifest();
const DS_PACKAGE_VERSION = DS_PACKAGE_MANIFEST.version;
const ALLOWED_DS_IMPORTS = readAllowedDesignSystemImports(DS_PACKAGE_MANIFEST);
const DS_EXPORTED_STYLE_PATHS =
  readDesignSystemExportedStylePaths(DS_PACKAGE_MANIFEST);
const DS_README_DOC = normalize("packages/design/design-system/README.md");
const DS_PACKAGE_DOC = normalize("docs/packages/design/design-system.md");
const DS_STANDARD_DOC = normalize("docs/standards/design-system.md");
const DS_PUBLIC_ENTRY_DOC_PATHS = new Set([DS_README_DOC, DS_PACKAGE_DOC]);
const DS_VERSION_DOC_PATHS = new Set([
  ...DS_PUBLIC_ENTRY_DOC_PATHS,
  DS_STANDARD_DOC,
]);
const EXTRA_SCAN_FILES = [...DS_VERSION_DOC_PATHS].map((file) =>
  path.join(ROOT, file),
);

const rules = [
  {
    id: "ds/no-stale-component-doc-count",
    description: "DS 组件文档中的数量必须与实际导出组件目录保持一致。",
    checkFile(file) {
      const normalized = normalize(file);
      if (!DS_PUBLIC_ENTRY_DOC_PATHS.has(normalized)) return [];
      return collectComponentDocCountViolations(file);
    },
  },
  {
    id: "ds/no-stale-version-docs",
    description: "DS 文档首部版本必须与 package.json 保持一致。",
    checkFile(file) {
      const normalized = normalize(file);
      if (!DS_VERSION_DOC_PATHS.has(normalized)) return [];
      return collectVersionDocViolations(file);
    },
  },
  {
    id: "ds/no-stale-package-style-exports",
    description: "DS package.json 暴露的样式入口必须指向真实文件。",
    checkFile(file) {
      const normalized = normalize(file);
      if (normalized !== DS_PACKAGE_JSON) return [];
      return collectPackageStyleExportViolations(file);
    },
  },
  {
    id: "ds/no-design-migration-artifacts",
    description:
      "packages/design 下不得长期保留迁移输入 CSS 或 vxture-v*-components 素材包。",
    checkFile(file) {
      const normalized = normalize(file);
      if (normalized !== DS_PACKAGE_JSON) return [];
      return collectDesignMigrationArtifactViolations(file);
    },
  },
  {
    id: "ds/no-stale-public-entry-docs",
    description: "DS 公共入口文档必须与 package exports 保持一致。",
    checkFile(file) {
      const normalized = normalize(file);
      if (!DS_PUBLIC_ENTRY_DOC_PATHS.has(normalized)) return [];
      return collectPublicEntryDocViolations(file);
    },
  },
  {
    id: "ds/no-app-components-ui",
    description:
      "应用层不能创建 components/ui 或 components/primitives 基础组件目录；基础 UI 必须进入 DS。",
    checkFile(file) {
      if (!isFrontendSource(file)) return [];
      const normalized = normalize(file);
      if (/\/src\/components\/(ui|primitives)\//.test(normalized)) {
        return [
          violation(
            file,
            1,
            "移动到语义业务目录，或补充到 @vxture/design-system。",
          ),
        ];
      }
      return [];
    },
  },
  {
    id: "ds/no-app-ui-imports",
    description:
      "应用层不能从本地 components/ui 或 components/primitives 导入基础组件。",
    checkLine(file, line, lineNumber) {
      if (!isFrontendSource(file)) return null;
      if (
        /from\s+['"](?:@\/components\/(?:ui|primitives)|.*\/components\/(?:ui|primitives)|.*\/(?:ui|primitives))/.test(
          line,
        )
      ) {
        return violation(
          file,
          lineNumber,
          "改为从 @vxture/design-system 导入基础组件，业务组件使用语义目录。",
        );
      }
      return null;
    },
  },
  {
    id: "ds/no-unauthorized-design-system-subpath",
    description:
      "应用和普通包只能使用 @vxture/design-system 公共入口与白名单子入口，禁止内部深层导入。",
    checkLine(file, line, lineNumber) {
      if (!isDesignSystemConsumerSource(file)) return null;
      const specifiers = findDesignSystemSpecifiers(line);
      const unauthorized = specifiers.find(
        (specifier) => !ALLOWED_DS_IMPORTS.has(specifier),
      );
      if (!unauthorized) return null;
      return violation(
        file,
        lineNumber,
        `${unauthorized} 不是允许的 DS 公共入口；只允许根入口、/tokens、/types、/server 和 package exports 暴露的 styles/*。`,
      );
    },
  },
  {
    id: "ds/no-direct-ui-engine-imports",
    description:
      "应用层不能直接导入 DS 底层图标库或 UI 引擎；必须通过 @vxture/design-system 公共入口。",
    checkLine(file, line, lineNumber) {
      if (!isFrontendSource(file)) return null;
      if (
        /from\s+['"](?:@phosphor-icons\/react|lucide-react|react-icons(?:\/[^'"]*)?|@radix-ui\/[^'"]+)['"]/.test(
          line,
        )
      ) {
        return violation(
          file,
          lineNumber,
          "改为从 @vxture/design-system 导入 Icon、Popover、Tooltip 等 DS 公共组件。",
        );
      }
      return null;
    },
  },
  {
    id: "ds/no-app-ui-engine-dependencies",
    description:
      "应用 package.json 不能声明 DS 底层图标库或 UI 引擎依赖；底层 UI 引擎只能由 DS 持有。",
    checkContent(file, content) {
      if (!isFrontendPackageManifest(file)) return [];
      const manifest = JSON.parse(content);
      const sections = [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ];
      const items = [];

      for (const section of sections) {
        const dependencies = manifest[section];
        if (!dependencies || typeof dependencies !== "object") continue;
        for (const dependency of Object.keys(dependencies)) {
          if (!isDirectUiEngineDependency(dependency)) continue;
          items.push(
            violation(
              file,
              findLineNumber(content, `"${dependency}"`),
              `应用 package.json 不能声明 ${dependency}；通过 @vxture/design-system 公共入口消费图标和 UI 引擎能力。`,
            ),
          );
        }
      }

      return items;
    },
  },
  {
    id: "ds/no-hardcoded-z-index",
    description: "业务层 z-index 大于 99 必须取自 DS 叠放阶梯。",
    checkLine(file, line, lineNumber) {
      if (!isFrontendSource(file) || isGeneratedOrAsset(file)) return null;
      const text = stripLineComment(line);
      const cssMatch = text.match(/\bz-index\s*:\s*(-?\d+)\b/i);
      const inlineMatch = text.match(/\bzIndex\s*:\s*(-?\d+)\b/);
      const value = Number(cssMatch?.[1] ?? inlineMatch?.[1] ?? NaN);
      if (!Number.isFinite(value) || value <= 99) return null;
      if (Z_LADDER.has(value)) return null;
      return violation(
        file,
        lineNumber,
        `z-index 须取 DS 叠放阶梯（${[...Z_LADDER].join(" / ")}），阶梯语义见 packages/design/design-system/docs/04-tokens-contract.md §8。`,
        line,
      );
    },
  },
  {
    id: "ds/no-hardcoded-breakpoint",
    description: "业务层 media query 不能硬编码 DS 标准断点 px 值。",
    checkLine(file, line, lineNumber) {
      if (!isFrontendSource(file) || isGeneratedOrAsset(file)) return null;
      const text = stripLineComment(line);
      if (!/@media\b.*\b(?:640|768|1024|1280|1536)px\b/.test(text)) return null;
      return violation(
        file,
        lineNumber,
        "断点请通过 DS token/Tailwind 语义能力表达，不能在业务样式中复制标准 px 值。",
        line,
      );
    },
  },
  {
    id: "ds/no-app-dark-overrides",
    description:
      "业务源码不能定义 .dark{} 块；暗色主题必须由 DS token 重映射承接。",
    checkLine(file, line, lineNumber) {
      if (!isFrontendSource(file) || isGeneratedOrAsset(file)) return null;
      const normalized = normalize(file);
      if (!normalized.endsWith(".css")) return null;
      const text = stripLineComment(line);
      if (!/(^|[,{]\s*)(?:\.dark|:root\.dark)\s*\{/.test(text)) return null;
      return violation(
        file,
        lineNumber,
        "移除应用层 .dark{} 定义，改为消费 DS 暗色 token。",
        line,
      );
    },
  },
  {
    id: "ds/no-retired-page-stack",
    description:
      "vx-page-stack 已退役且无任何规则，页面纵向骨架用 DS 的 ViewLayout。",
    checkLine(file, line, lineNumber) {
      if (!/\.(tsx|css)$/.test(file)) return null;
      // 只查真用法：JSX 的 className 与 CSS 选择器。散文里提到这个名字是在
      // 解释它为什么退役，不该被判违规。
      const isUsage =
        (line.includes("vx-page-stack") && line.includes("className")) ||
        /^\s*\.vx-page-stack/.test(line);
      if (!isUsage) return null;
      return violation(
        file,
        lineNumber,
        "改用 <ViewLayout>：这个类没有规则，挂着它页级块之间没有任何间距。",
        line,
      );
    },
  },
  {
    id: "ds/no-undefined-admin-token",
    description:
      "admin 样式引用的 --vx-admin-* 必须在 token 桥里有定义；归档样式表同样算数。",
    checkFile(file) {
      const normalized = normalize(file);
      // 只查**在构建里**的样式表。styles-absorbed/ 不查——那 13 份的 token 早在
      // 上一次清理时就没了（79 个），现在补回来等于把已退役的设计意图复活，
      // 而不查它们也不会漏掉事故：样式表一旦被接回 src/styles/，本规则立刻就报
      // （2026-08-07 就是这么抓到 admin-roles-auth-dialog 少 5 个 token 的）。
      if (!/^portals\/admin\/src\/styles\/.*\.css$/.test(normalized)) {
        return [];
      }
      let source;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        return [];
      }

      const defined = adminTokenDefinitions();
      const violations = [];
      const seen = new Set();
      const re = /var\(\s*(--vx-admin-[a-z0-9-]+)/g;
      let match;
      while ((match = re.exec(source)) !== null) {
        const name = match[1];
        if (defined.has(name) || seen.has(name)) continue;
        seen.add(name);
        violations.push(
          violation(
            file,
            source.slice(0, match.index).split("\n").length,
            `${name} 在 token 桥里没有定义。补定义，或连同引用它的规则一起退役——` +
              `**不要只删一边**：样式表离开构建后它引用的 token 会显得无人使用，` +
              `随后被当成死 token 清掉，等有人把样式表接回来时栅格就塌了` +
              `（2026-08-05/08-07 两次事故，见 workplans §十九）。`,
          ),
        );
      }
      return violations;
    },
  },
  {
    id: "ds/no-duplicate-status-badge-icon",
    description:
      "StatusBadge 自带语气图标；children 里不要再手写同一个 <Icon>，否则一枚标画两个。",
    checkFile(file) {
      if (!file.endsWith(".tsx")) return [];
      let source;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        return [];
      }
      if (!source.includes("<StatusBadge")) return [];

      // 走查里同一个错犯了四次（accounts / admin-roles / usage-metering /
      // platform-admins）：迁移到自带图标的组件时，调用点原来自己画的那个图标忘了删。
      const violations = [];
      const opening = /<StatusBadge\b[^>]*\bicon=\{[^}]*\}[^>]*>/g;
      let match;
      while ((match = opening.exec(source)) !== null) {
        const start = match.index + match[0].length;
        const rest = source.slice(start, start + 240);
        const close = rest.indexOf("</StatusBadge>");
        const children = close === -1 ? rest : rest.slice(0, close);
        if (/<Icon\b/.test(children)) {
          const lineNumber = source.slice(0, match.index).split("\n").length;
          violations.push(
            violation(
              file,
              lineNumber,
              "删掉 children 里的 <Icon>：图标由 StatusBadge 的 icon 属性出。",
            ),
          );
        }
      }
      return violations;
    },
  },
  {
    id: "ds/no-raw-color",
    description:
      "颜色只能在 DS token 层定义；应用层和普通包不能写 hex/rgb/hsl 硬编码颜色。",
    checkLine(file, line, lineNumber) {
      if (isDsTokenOwner(file) || isGeneratedOrAsset(file)) return null;
      if (hasRawColor(line)) {
        return violation(
          file,
          lineNumber,
          "使用 DS token：var(--vx-color-*)、text-vx-*、bg-vx-* 或补充 DS token。",
        );
      }
      return null;
    },
  },
  {
    id: "ds/no-illegal-font-family",
    description:
      "字体族只能由 DS typography token 定义；应用层只允许加载字体变量。",
    checkLine(file, line, lineNumber) {
      if (isGeneratedOrAsset(file)) return null;
      /* 只认**真正的加载**（import / require / 动态 import），不认散文里提到这个名字。
         原来是 `line.includes("next/font")`，于是 `fonts.css` 那篇「为什么把 next/font
         删掉、改自托管」的文件头注释被报了四处——**一条因为你写清楚了为什么删它就报警
         的规则，是在惩罚写文档**，而且它拦不住任何真实违例（真要加载的人不写注释）。 */
      if (
        NEXT_FONT_LOAD.test(line) &&
        !FONT_LOADER_ALLOWLIST.some((pattern) => pattern.test(normalize(file)))
      ) {
        return violation(
          file,
          lineNumber,
          "next/font 只能在应用 app/layout 中加载，业务组件不得直接加载字体。",
        );
      }

      const match = line.match(/font-family\s*:\s*([^;]+)/i);
      if (!match) return null;
      const value = match[1]?.trim() ?? "";
      const allowed =
        value.startsWith("var(") ||
        ["inherit", "initial", "unset"].includes(value);
      if (!allowed) {
        return violation(
          file,
          lineNumber,
          "font-family 必须使用 var(--font-*) 或 inherit。",
        );
      }
      return null;
    },
  },
  {
    id: "ds/no-ds-locked-hardcoded-effect",
    description:
      "已收敛的 DS 组件样式不能回流硬编码 transition/animation 时长或裸 focus-ring 阴影。",
    checkLine(file, line, lineNumber) {
      const normalized = normalize(file);
      if (!DS_EFFECT_LOCKED_STYLE_PATHS.has(normalized)) return null;
      const text = stripLineComment(line);
      if (/\d+(?:\.\d+)?(?:ms|s)/.test(text) || hasLiteralEasing(text)) {
        return violation(
          file,
          lineNumber,
          "改用 T2 动效 token：var(--transition-duration-*) 与 var(--ease-*)。",
          line,
        );
      }
      if (
        DS_SHADOW_LOCKED_STYLE_PATHS.has(normalized) &&
        /^\s*box-shadow\s*:\s*$/.test(text)
      ) {
        return violation(
          file,
          lineNumber,
          "已收敛的 DS 样式必须使用单行 shadow token，不能回流多行裸 box-shadow。",
          line,
        );
      }
      const boxShadowMatch = text.match(/^\s*box-shadow\s*:\s*([^;]+);?/);
      if (boxShadowMatch) {
        const boxShadowValue = (boxShadowMatch[1] ?? "").trim();
        const isTokenShadow = boxShadowValue.startsWith("var(");
        const isNoShadow =
          boxShadowValue === "none" || boxShadowValue.startsWith("none ");

        if (boxShadowValue.startsWith("0 0 0 ")) {
          return violation(
            file,
            lineNumber,
            "focus ring 阴影必须使用 --vx-control-focus-shadow 或组件 effect token。",
            line,
          );
        }
        if (
          DS_SHADOW_LOCKED_STYLE_PATHS.has(normalized) &&
          !isTokenShadow &&
          !isNoShadow
        ) {
          return violation(
            file,
            lineNumber,
            "已收敛的 DS 样式必须使用 shadow token，不能回流裸 box-shadow。",
            line,
          );
        }
      }
      return null;
    },
  },
  {
    id: "ds/no-ds-style-hardcoded-shadow",
    description:
      "DS 样式层 shadow 只能由 token owner 定义；样式叶子和 bindings 只能消费 shadow token。",
    checkLine(file, line, lineNumber) {
      const normalized = normalize(file);
      if (
        !normalized.startsWith(`${DS_ROOT}/src/styles/`) ||
        isDsTokenOwner(file) ||
        isGeneratedOrAsset(file)
      )
        return null;
      const text = stripLineComment(line);

      if (/^\s*box-shadow\s*:\s*$/.test(text)) {
        return violation(
          file,
          lineNumber,
          "DS 样式叶子必须使用单行 shadow token，不能回流多行裸 box-shadow。",
          line,
        );
      }

      const boxShadowMatch = text.match(/^\s*box-shadow\s*:\s*([^;]+);?/);
      if (boxShadowMatch && !isTokenOrNoneShadowValue(boxShadowMatch[1])) {
        return violation(
          file,
          lineNumber,
          "DS 样式叶子的 box-shadow 必须使用 var(--vx-*) token 或 none。",
          line,
        );
      }

      const filterMatch = text.match(/^\s*filter\s*:\s*([^;]+);?/);
      if (filterMatch && filterMatch[1]?.includes("drop-shadow(")) {
        return violation(
          file,
          lineNumber,
          "DS 样式叶子的 drop-shadow 必须封装为 effect token 后通过 var(--vx-*) 消费。",
          line,
        );
      }

      const shadowVariableMatch = text.match(
        /^\s*--vx-[\w-]*shadow[\w-]*\s*:\s*(.*)$/,
      );
      if (
        shadowVariableMatch &&
        !isTokenOrNoneShadowValue(shadowVariableMatch[1])
      ) {
        return violation(
          file,
          lineNumber,
          "DS bindings 只能把 shadow 变量绑定到 token，不能直接定义阴影值。",
          line,
        );
      }

      return null;
    },
  },
  {
    id: "ds/no-ds-style-hardcoded-motion",
    description:
      "DS 样式层 motion 只能由 token owner 定义；样式叶子和 bindings 只能消费 motion token。",
    checkLine(file, line, lineNumber) {
      const normalized = normalize(file);
      if (
        !normalized.startsWith(`${DS_ROOT}/src/styles/`) ||
        isDsTokenOwner(file) ||
        isGeneratedOrAsset(file)
      )
        return null;
      const text = stripLineComment(line);

      if (/\d+(?:\.\d+)?(?:ms|s)/.test(text)) {
        return violation(
          file,
          lineNumber,
          "DS 样式叶子不能直接写 motion 时长；改用 var(--transition-duration-*)。",
          line,
        );
      }

      const motionPropertyMatch = text.match(
        /^\s*(?:transition|animation|transition-duration|transition-delay|animation-duration|animation-delay|transition-timing-function|animation-timing-function)\s*:\s*([^;]+);?/,
      );
      if (
        motionPropertyMatch &&
        !isTokenOrNoneMotionValue(motionPropertyMatch[1])
      ) {
        return violation(
          file,
          lineNumber,
          "DS 样式叶子的 motion 属性必须由 token 的 var() 引用构成，或为 none。",
          line,
        );
      }

      const motionVariableMatch = text.match(
        /^\s*--vx-[\w-]*(?:transition|motion|duration|animation)[\w-]*\s*:\s*(.*)$/,
      );
      if (
        motionVariableMatch &&
        !isTokenOrNoneMotionValue(motionVariableMatch[1])
      ) {
        return violation(
          file,
          lineNumber,
          "DS bindings 只能把 motion 变量绑定到 token，不能直接定义时长或曲线。",
          line,
        );
      }

      return null;
    },
  },
  {
    id: "ds/no-app-tailwind-tokens",
    description:
      "应用层 Tailwind 配置不能自建 colors/fontFamily/radius/shadow tokens。",
    checkLine(file, line, lineNumber) {
      const normalized = normalize(file);
      if (
        !/^(portals|agent-studio|business)\/[^/]+\/tailwind\.config\.(js|mjs|ts)$/.test(
          normalized,
        )
      )
        return null;
      if (/\b(colors|fontFamily|borderRadius|boxShadow)\s*:/.test(line)) {
        return violation(
          file,
          lineNumber,
          "把 token 定义迁移到 @vxture/design-system。",
        );
      }
      return null;
    },
  },
  {
    id: "ds/no-app-vx-token-definitions",
    description:
      "应用层不能新增 --vx-* token 定义；平台 token 和组件 token 必须回收到 DS。",
    checkLine(file, line, lineNumber) {
      if (
        !isFrontendSource(file) ||
        path.extname(file) !== ".css" ||
        isGeneratedOrAsset(file)
      )
        return null;
      const text = stripLineComment(line);
      if (/^\s*--vx-[\w-]+\s*:/.test(text)) {
        return violation(
          file,
          lineNumber,
          "应用层不能定义新的 --vx-* token；把平台/组件语义 token 回收到 @vxture/design-system。",
          line,
        );
      }
      return null;
    },
  },
  {
    id: "ds/no-app-component-metric-token",
    description:
      "应用层不能直接消费 --vx-component-metric-* 兜底尺度 token；必须使用 DS 语义 token 或组件类。",
    checkLine(file, line, lineNumber) {
      if (
        !isFrontendSource(file) ||
        path.extname(file) !== ".css" ||
        isGeneratedOrAsset(file)
      )
        return null;
      if (!/var\(--vx-component-metric-/.test(line)) return null;
      return violation(
        file,
        lineNumber,
        "应用 CSS 不能直接消费 --vx-component-metric-*；抽成 --vx-<domain>-* / --vx-<component>-* 语义 token，或迁移为 DS 组件样式。",
        line,
      );
    },
  },
  {
    id: "ds/no-app-portal-scale-token",
    description:
      "应用层不能消费 admin/console scale 兜底 token；必须使用按语义角色拆分后的 DS token。",
    checkLine(file, line, lineNumber) {
      if (
        !isFrontendSource(file) ||
        path.extname(file) !== ".css" ||
        isGeneratedOrAsset(file)
      )
        return null;
      if (!/var\(--vx-(?:admin|console)-scale-/.test(line)) return null;
      return violation(
        file,
        lineNumber,
        "应用 CSS 不能消费 --vx-admin-scale-* / --vx-console-scale-*；改用 --vx-<portal>-space/size/radius/text/effect/track-* 语义 token。",
        line,
      );
    },
  },
  {
    id: "ds/no-app-ai-primitive-token",
    description:
      "应用层不能直接消费 AI primitive 色阶；AI 场景必须使用 DS 语义 token。",
    checkLine(file, line, lineNumber) {
      if (!isFrontendSource(file) || isGeneratedOrAsset(file)) return null;
      if (!hasAiPrimitiveTokenUsage(line)) return null;
      return violation(
        file,
        lineNumber,
        "应用层不能直接消费 AI primitive 色阶；改用 --vx-color-ai / --vx-color-ai-soft / --vx-color-ai-cyan / --vx-color-spark 等语义 token 或 bg-vx-ai-soft 等语义工具类。",
        line,
      );
    },
  },
  {
    id: "ds/no-extracted-style-role-dimension-token",
    description:
      "应用 src/styles 抽出模块不能消费角色尺度/布局 token；模块样式必须使用组件语义 token。",
    checkLine(file, line, lineNumber) {
      if (!isExtractedPortalStyleModule(file) || isGeneratedOrAsset(file))
        return null;
      if (
        !/var\(--vx-(?:admin|console|website|varda)-(?:space|size|track|radius|line-width|text-size|text-line|text-tracking|effect|pattern|motion|grid-column|panel-max-height|dialog-max-width|dialog-width|layout|shadow-spread|shadow-blur|status-cutout|pattern-dot)-/.test(
          line,
        )
      ) {
        return null;
      }
      return violation(
        file,
        lineNumber,
        "抽出到 src/styles 的模块样式不能直接消费角色尺度/布局 token；请在 DS token 层补 --vx-<domain>-<component>-* 语义 token。",
        line,
      );
    },
  },
  {
    id: "ds/no-style-part-leaf",
    description:
      "抽出的 CSS 叶子必须使用语义命名，不能继续新增 *-part-N.css 机械文件。",
    checkFile(file) {
      const normalized = normalize(file);
      if (path.extname(file) !== ".css" || isGeneratedOrAsset(file)) return [];
      if (!/\/src\/styles\/[^/]+-part-\d+\.css$/.test(normalized)) return [];
      return [
        violation(
          file,
          1,
          "CSS 叶子文件不能使用 *-part-N.css 机械命名；请按 layout/copy/states/tones/cells/header 等职责命名。",
        ),
      ];
    },
    checkLine(file, line, lineNumber) {
      if (path.extname(file) !== ".css" || isGeneratedOrAsset(file))
        return null;
      if (!/@import\s+["'][^"']*-part-\d+\.css["']/.test(line)) return null;
      return violation(
        file,
        lineNumber,
        "CSS 入口不能 import *-part-N.css 机械叶子；请改为语义叶子文件名。",
        line,
      );
    },
  },
  {
    id: "ds/no-generic-content-style-module",
    description: "前端和 DS 样式模块不能使用 *-content.css 泛化命名。",
    checkFile(file) {
      if (path.extname(file) !== ".css" || isGeneratedOrAsset(file)) return [];
      const normalized = normalize(file);
      const isDesignSystemStyle =
        /^packages\/design\/design-system\/src\/styles\/[^/]+-content\.css$/.test(
          normalized,
        );
      const isAppStyle =
        /^(portals|agent-studio|business)\/[^/]+\/src\/styles\/[^/]+-content\.css$/.test(
          normalized,
        );
      if (!isDesignSystemStyle && !isAppStyle) return [];
      return [
        violation(
          file,
          1,
          "CSS 文件不能使用 *-content.css 泛化命名；请按 brand-hero/navigation-tabs/data-table/toolbar/pages/shell 等职责命名。",
        ),
      ];
    },
    checkLine(file, line, lineNumber) {
      if (path.extname(file) !== ".css" || isGeneratedOrAsset(file))
        return null;
      if (!/@import\s+["'][^"']*-content\.css["']/.test(line)) return null;
      return violation(
        file,
        lineNumber,
        "CSS 入口不能 import *-content.css 泛化模块；请改为语义职责文件名。",
        line,
      );
    },
  },
  {
    id: "ds/no-global-concrete-style-import",
    description:
      "前端 globals 只能导入受入口约束的稳定样式入口，不能直接导入具体规则叶子。",
    checkLine(file, line, lineNumber) {
      const normalizedFile = normalize(file);
      const globalsMatch = normalizedFile.match(
        /^(portals|agent-studio|business)\/([^/]+)\/src\/app\/globals\.css$/,
      );
      if (!globalsMatch) return null;

      const match = line.match(
        /@import\s+["']\.\.\/styles\/([^"']+\.css)["'];/,
      );
      if (!match) return null;

      const entry = normalize(
        `${globalsMatch[1]}/${globalsMatch[2]}/src/styles/${match[1]}`,
      );
      if (IMPORT_ONLY_STYLE_ENTRIES.has(entry)) return null;
      return violation(
        file,
        lineNumber,
        "前端 globals 只能导入受 ds/no-style-entry-rules 约束的稳定样式入口；请先创建 import-only wrapper。",
        line,
      );
    },
  },
  {
    id: "ds/no-large-extracted-style-leaf",
    description:
      "应用 src/styles 中承载具体规则的叶子文件不能继续膨胀为大入口。",
    checkFile(file) {
      if (!isExtractedPortalStyleModule(file) || isGeneratedOrAsset(file))
        return [];
      if (normalizedTextSize(file) <= 8000) return [];
      const content = readFileSync(file, "utf8");
      if (isImportOnlyStyleContent(content)) return [];
      return [
        violation(
          file,
          1,
          "具体规则 CSS 叶子超过 8KB；请按业务语义拆成少量模块，并让当前文件保持 @import 聚合。",
        ),
      ];
    },
  },
  {
    id: "ds/no-large-platform-style-leaf",
    description: "DS platform-* 具体规则叶子不能继续膨胀为大入口。",
    checkFile(file) {
      const normalized = normalize(file);
      if (
        !/^packages\/design\/design-system\/src\/styles\/platform-[^/]+\.css$/.test(
          normalized,
        )
      )
        return [];
      if (normalizedTextSize(file) <= 8000) return [];
      const content = readFileSync(file, "utf8");
      if (isImportOnlyStyleContent(content)) return [];
      return [
        violation(
          file,
          1,
          "DS platform-* 具体规则叶子超过 8KB；请按跨应用语义职责拆分，并让当前文件保持 @import 聚合。",
        ),
      ];
    },
  },
  {
    id: "ds/no-large-console-style-leaf",
    description: "DS console-* 具体规则叶子不能继续膨胀为大入口。",
    checkFile(file) {
      const normalized = normalize(file);
      if (
        !/^packages\/design\/design-system\/src\/styles\/console-[^/]+\.css$/.test(
          normalized,
        )
      )
        return [];
      if (normalizedTextSize(file) <= 8000) return [];
      const content = readFileSync(file, "utf8");
      if (isImportOnlyStyleContent(content)) return [];
      return [
        violation(
          file,
          1,
          "DS console-* 具体规则叶子超过 8KB；请按 Console 体验职责拆分，并让当前文件保持 @import 聚合。",
        ),
      ];
    },
  },
  {
    id: "ds/no-large-components-style-leaf",
    description: "DS components-* 具体规则叶子不能继续膨胀为大入口。",
    checkFile(file) {
      const normalized = normalize(file);
      if (
        !/^packages\/design\/design-system\/src\/styles\/components-[^/]+\.css$/.test(
          normalized,
        )
      )
        return [];
      if (normalizedTextSize(file) <= 8000) return [];
      const content = readFileSync(file, "utf8");
      if (isImportOnlyStyleContent(content)) return [];
      return [
        violation(
          file,
          1,
          "DS components-* 具体规则叶子超过 8KB；请按基础组件职责拆分，并让当前文件保持 @import 聚合。",
        ),
      ];
    },
  },
  {
    id: "ds/no-large-auth-style-leaf",
    description: "DS auth-* 具体规则叶子不能继续膨胀为大入口。",
    checkFile(file) {
      const normalized = normalize(file);
      if (
        !/^packages\/design\/design-system\/src\/styles\/auth-[^/]+\.css$/.test(
          normalized,
        )
      )
        return [];
      if (normalizedTextSize(file) <= 8000) return [];
      const content = readFileSync(file, "utf8");
      if (isImportOnlyStyleContent(content)) return [];
      return [
        violation(
          file,
          1,
          "DS auth-* 具体规则叶子超过 8KB；请按认证体验职责拆分，并让当前文件保持 @import 聚合。",
        ),
      ];
    },
  },
  {
    id: "ds/no-large-token-style-leaf",
    description:
      "DS tokens-* 运行时 token 模块必须按语义域拆分，不能重新膨胀为单体文件。",
    checkFile(file) {
      const normalized = normalize(file);
      if (
        !/^packages\/design\/design-system\/src\/styles\/tokens-[^/]+\.css$/.test(
          normalized,
        )
      )
        return [];
      if (normalizedTextSize(file) <= 8000) return [];
      return [
        violation(
          file,
          1,
          "DS tokens-* 模块超过 8KB；请按 theme、colors、primitive、component、platform、admin、console、website 等语义域继续拆分。",
        ),
      ];
    },
  },
  {
    id: "ds/no-misnamed-token-style-module",
    description:
      "只有 runtime token 层允许使用 tokens.css / tokens-* 命名；作用域变量组装必须使用 bindings 命名。",
    checkFile(file) {
      const normalized = normalize(file);
      if (
        !/^packages\/design\/design-system\/src\/styles\/[\w-]+-tokens\.css$/.test(
          normalized,
        )
      )
        return [];
      if (DS_RUNTIME_TOKEN_STYLE_PATTERN.test(normalized)) return [];
      return [
        violation(
          file,
          1,
          "该文件不是 runtime token 分层模块；若是选择器作用域内的变量组装，请命名为 *-bindings.css，若是全局运行时值源，请迁入 tokens-* 模块。",
        ),
      ];
    },
  },
  {
    id: "ds/no-style-entry-rules",
    description:
      "大型样式入口只能作为 @import 聚合入口，具体规则必须进入分层模块。",
    checkContent(file, content) {
      const label = IMPORT_ONLY_STYLE_ENTRIES.get(normalize(file));
      if (!label) return [];

      const items = [];
      let inBlockComment = false;
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        const text = line.trim();
        if (!text) return;
        if (inBlockComment) {
          if (text.includes("*/")) inBlockComment = false;
          return;
        }
        if (text.startsWith("/*")) {
          if (!text.includes("*/")) inBlockComment = true;
          return;
        }
        // `layer(...)` 是 @import 的标准形式，仍然只是聚合导入，不是样式规则。
        if (/^@import\s+["'][^"']+["'](\s+layer\([a-z-]+\))?;$/.test(text))
          return;
        // `@source` 和 @import 一样是构建指令，不是样式规则：它告诉 Tailwind 去哪
        // 扫类名。路径相对声明它的文件，挪进分层模块只会让这条极易失效的声明更难
        // 维护——而它一旦失效，DS 组件的工具类全部不产出且不报错。
        if (/^@source\s+["'][^"']+["'];$/.test(text)) return;
        items.push(
          violation(
            file,
            index + 1,
            `${label} 只能保留 @import 聚合；具体选择器和规则应进入同目录分层模块。`,
            line,
          ),
        );
      });
      return items;
    },
  },
  {
    id: "ds/no-token-duplicates",
    description: "颜色、字号、圆角等 token 文件只能存在于 DS token 包。",
    checkFile(file) {
      const normalized = normalize(file);
      if (isDsPackage(file)) return [];
      if (
        /\/tokens\/(colors|typography|radius|spacing|shadow)\.(ts|tsx|js|mjs|css)$/.test(
          normalized,
        )
      ) {
        return [
          violation(
            file,
            1,
            "token 文件只能维护在 packages/design/design-system/src/tokens。",
          ),
        ];
      }
      return [];
    },
  },
  {
    id: "ds/no-token-runtime-value-duplicates",
    description:
      "DS TS token 文件不能重复维护运行时颜色、间距、圆角、阴影、字号值。",
    checkLine(file, line, lineNumber) {
      const normalized = normalize(file);
      if (
        !/^packages\/design\/design-system\/src\/tokens\/(colors|spacing|radius|shadow|typography)\.ts$/.test(
          normalized,
        )
      ) {
        return null;
      }
      const text = stripLineComment(line);
      if (
        /["'][^"']*(?:#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)\b)/.test(
          text,
        )
      ) {
        return violation(
          file,
          lineNumber,
          "运行时 token 值只能定义在 styles/tokens.css 及其 tokens-* 分层模块；TS token 只暴露 var(--vx-*) 引用。",
          line,
        );
      }
      return null;
    },
  },
  {
    id: "ds/no-component-metric-in-ds-semantic-css",
    description:
      "DS 语义样式必须使用语义 token，不能直接消费兜底 metric token。",
    checkLine(file, line, lineNumber) {
      const normalized = normalize(file);
      if (!isDsSemanticStyleFile(normalized)) return null;
      if (!/var\(--vx-component-metric-/.test(line)) return null;
      return violation(
        file,
        lineNumber,
        "DS 语义样式只能使用 --vx-button-*、--vx-field-*、--vx-platform-*、--vx-shell-* 等语义 token；兜底 metric token 只允许在 token 层维护。",
        line,
      );
    },
  },
  {
    id: "ds/no-known-tailwind-typo",
    description: "禁止已知 Tailwind class 拼写错误进入源码。",
    checkLine(file, line, lineNumber) {
      if (!isFrontendSource(file)) return null;
      if (line.includes("tranvx")) {
        return violation(
          file,
          lineNumber,
          "疑似 translate-* 被误替换为 tranvx-*，请修正为有效 Tailwind class。",
        );
      }
      return null;
    },
  },
  {
    id: "ds/no-app-tailwind-arbitrary-scale",
    description:
      "应用层不能新增 Tailwind 任意尺度值；页面尺度必须进入 DS token 或 portal 语义 CSS。",
    checkLine(file, line, lineNumber) {
      if (!isFrontendSource(file) || isGeneratedOrAsset(file)) return null;
      if (!hasTailwindArbitraryScale(line)) return null;
      return violation(
        file,
        lineNumber,
        "Tailwind arbitrary 尺度会绕过 DS 约束；迁移为 DS token、portal 语义 CSS 类或 Tailwind/DS 已暴露的标准 token。",
        line,
      );
    },
  },
  {
    id: "ds/no-inline-design-style",
    description:
      "应用层 inline style 和间接 style 对象只能承载动态变量或坐标，不能承载颜色、字体、间距、圆角、阴影等设计值。",
    checkContent(file, content) {
      if (!isFrontendSource(file) || isGeneratedOrAsset(file)) return [];
      return [
        ...findInlineStyleViolations(file, content),
        ...findNamedStyleObjectViolations(file, content),
      ];
    },
  },
  {
    id: "ds/no-native-primitive",
    description:
      "业务源码默认不能直接写 button/input/select/textarea，应使用 DS 组件或补充 DS 能力。",
    // 走 checkContent 而不是 checkLine：判据要先抹掉注释（见 maskComments）。
    checkContent(file, content) {
      return checkCodeLines(
        file,
        content,
        /<(?:button|input|select|textarea)\b/,
        "使用 @vxture/design-system 的 Button/Input/Select 等组件；DS 不足时先补 DS。",
      );
    },
  },
  {
    id: "ds/no-native-table",
    description:
      "业务源码默认不能直接写 table/thead/tbody/tr/th/td，应使用 DS DataTable 或补充 DS 表格能力。",
    // 同 no-native-primitive：先抹注释再判，否则「这里原先是裸 <table>」这句话
    // 自己会撞上规则。
    checkContent(file, content) {
      return checkCodeLines(
        file,
        content,
        /<(?:table|thead|tbody|tr|th|td)\b/,
        "使用 @vxture/design-system 的 DataTable；DS 不足时先补 DS 表格能力。",
      );
    },
  },
  {
    id: "ds/no-app-hardcoded-scale",
    description:
      "应用层 CSS 不能新增硬编码 px/rem/em 设计尺度；尺寸、间距、字号、圆角、阴影应进入 DS token 或组件语义样式。",
    checkLine(file, line, lineNumber) {
      if (
        !isFrontendSource(file) ||
        path.extname(file) !== ".css" ||
        isGeneratedOrAsset(file)
      )
        return null;
      if (isAllowlistedScaleLine(line)) return null;

      const match = line.match(/^\s*([\w-]+)\s*:\s*([^;]+);?/);
      if (!match) return null;

      const property = match[1] ?? "";
      const value = match[2] ?? "";
      if (
        !hasHardcodedScale(value) ||
        isAllowlistedScaleDeclaration(property, value)
      )
        return null;

      return violation(
        file,
        lineNumber,
        "应用 CSS 不能新增硬编码 px/rem/em 设计尺度；使用 DS spacing/radius/typography/shadow token，或迁移为 DS 组件语义样式。",
        line,
      );
    },
  },
  {
    id: "ds/no-app-hardcoded-layout-scale",
    description:
      "应用层布局算法不能新增硬编码设计尺度；min/max/clamp/minmax 中的具体尺度应提升为 DS 语义 token。",
    checkLine(file, line, lineNumber) {
      if (
        !isFrontendSource(file) ||
        path.extname(file) !== ".css" ||
        isGeneratedOrAsset(file)
      )
        return null;
      const text = stripLineComment(line);
      if (!hasHardcodedScale(text)) return null;
      if (
        !/\b(?:calc|min|max|clamp|minmax)\(/.test(text) &&
        !/^\s*grid-template-(?:columns|rows)\s*:/.test(text)
      ) {
        return null;
      }
      return violation(
        file,
        lineNumber,
        "应用 CSS 布局算法不能新增硬编码 px/rem/em 设计尺度；把列宽、弹窗宽度、断点内尺寸等提升为 DS 语义 token。",
        line,
      );
    },
  },
];

const files = [
  ...SCAN_ROOTS.flatMap((root) => collectFiles(path.join(ROOT, root))),
  ...EXTRA_SCAN_FILES.filter(exists),
]
  .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)))
  .filter((file, index, allFiles) => allFiles.indexOf(file) === index);

const violations = [];

for (const file of files) {
  for (const rule of rules) {
    if (rule.checkFile) {
      for (const item of rule.checkFile(file)) {
        violations.push({ rule, ...item });
      }
    }
  }

  const content = readFileSync(file, "utf8");
  for (const rule of rules) {
    if (!rule.checkContent) continue;
    for (const item of rule.checkContent(file, content)) {
      violations.push({ rule, ...item });
    }
  }

  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    for (const rule of rules) {
      if (!rule.checkLine) continue;
      const item = rule.checkLine(file, line, lineNumber);
      if (item) violations.push({ rule, ...item });
    }
  });
}

const staleStyleEntryRule = {
  id: "ds/no-stale-style-entry-rules",
  description: "import-only 样式入口约束不能指向不存在的文件。",
};
for (const entry of IMPORT_ONLY_STYLE_ENTRIES.keys()) {
  const target = path.join(ROOT, entry);
  if (exists(target)) continue;
  // 同 SCAN_ROOTS 的理由:入口所属的顶层目录在本仓不存在时,它不是"陈旧",
  // 是"不归本仓管"。只有目录在、文件不在,才是真的陈旧。
  const entryRoot = normalize(entry).split("/")[0];
  if (!existsSync(path.join(ROOT, entryRoot))) continue;
  violations.push({
    rule: staleStyleEntryRule,
    file: entry,
    line: 1,
    message:
      "从 IMPORT_ONLY_STYLE_ENTRIES 移除陈旧入口，或恢复对应 import-only 样式文件。",
    source: entry,
  });
}

const missingCssImportRule = {
  id: "ds/no-missing-css-import",
  description: "CSS 相对 @import 必须指向真实文件，防止样式图谱断链。",
};
for (const item of collectMissingCssImportViolations(files)) {
  violations.push({ rule: missingCssImportRule, ...item });
}

const legacyScaleTokenStyleRule = {
  id: "ds/no-legacy-scale-token-style",
  description: "已收敛的叶子 scale token 文件不能恢复或重新导入。",
};
for (const item of collectLegacyScaleTokenStyleViolations(files)) {
  violations.push({ rule: legacyScaleTokenStyleRule, ...item });
}

const legacyComponentMetricTokenStyleRule = {
  id: "ds/no-legacy-component-metric-token-style",
  description: "已清零的 component metric token 文件不能恢复或重新导入。",
};
for (const item of collectLegacyComponentMetricTokenStyleViolations(files)) {
  violations.push({ rule: legacyComponentMetricTokenStyleRule, ...item });
}

const runtimeScaleBridgeVarRule = {
  id: "ds/no-runtime-scale-bridge-var-usage",
  description:
    "DS 样式层不得重新通过 var() 消费 scale bridge token；运行时值应在 token 层直接落到实际值。",
};
for (const item of collectRuntimeScaleBridgeVarViolations(files)) {
  violations.push({ rule: runtimeScaleBridgeVarRule, ...item });
}

const runtimeComponentMetricVarRule = {
  id: "ds/no-runtime-component-metric-var-usage",
  description:
    "DS 样式层不得重新通过 var() 消费 component metric 兜底 token；运行时值应在 token 层直接落到实际值。",
};
for (const item of collectRuntimeComponentMetricVarViolations(files)) {
  violations.push({ rule: runtimeComponentMetricVarRule, ...item });
}

const unreachableAppStyleRule = {
  id: "ds/no-unreachable-app-style-module",
  description:
    "应用 src/styles 下的样式模块必须能从对应 app/globals.css 的 @import 图谱到达。",
};
for (const item of collectUnreachableAppStyleViolations(files)) {
  violations.push({ rule: unreachableAppStyleRule, ...item });
}

const unreachableDsStyleRule = {
  id: "ds/no-unreachable-ds-style-module",
  description:
    "DS src/styles 下的样式模块必须能从 package exports 暴露的公共样式入口到达。",
};
for (const item of collectUnreachableDsStyleViolations(files)) {
  violations.push({ rule: unreachableDsStyleRule, ...item });
}

const redundantStyleWrapperRule = {
  id: "ds/no-redundant-style-wrapper",
  description: "应用 src/styles 非顶层样式 wrapper 不能只转发一个子模块。",
};
for (const item of collectRedundantStyleWrapperViolations(files)) {
  violations.push({ rule: redundantStyleWrapperRule, ...item });
}

const redundantDsStyleWrapperRule = {
  id: "ds/no-redundant-ds-style-wrapper",
  description: "DS 内部样式 wrapper 不能只转发一个子模块，公开样式入口除外。",
};
for (const item of collectRedundantDsStyleWrapperViolations(files)) {
  violations.push({ rule: redundantDsStyleWrapperRule, ...item });
}

const dsStyleHardcodedScaleBudgetRule = {
  id: "ds/no-ds-style-hardcoded-scale-budget",
  description:
    "DS 非 token owner 样式中的硬编码尺度存量不能增加；迁移后应持续下调预算。",
};
const dsStyleHardcodedScaleCount = collectDsStyleHardcodedScaleCount(files);
if (dsStyleHardcodedScaleCount > DS_STYLE_HARDCODED_SCALE_BUDGET) {
  violations.push({
    rule: dsStyleHardcodedScaleBudgetRule,
    file: "packages/design/design-system/src/styles",
    line: 1,
    message: `DS 非 token owner 硬编码尺度数量 ${dsStyleHardcodedScaleCount} 超过预算 ${DS_STYLE_HARDCODED_SCALE_BUDGET}；新增尺度必须迁入语义 token，或先降低存量预算。`,
    source: `scale-count:${dsStyleHardcodedScaleCount}`,
  });
}

const dsStyleScaleBridgeRule = {
  id: "ds/no-ds-style-scale-bridge-usage",
  description:
    "DS 非 token owner 样式不能重新消费 --vx-scale-* 历史桥接 token。",
};
for (const item of collectDsStyleScaleBridgeViolations(files)) {
  violations.push({ rule: dsStyleScaleBridgeRule, ...item });
}

const dsStylePlatformScaleBridgeRule = {
  id: "ds/no-ds-style-platform-scale-bridge-usage",
  description:
    "DS platform 具体样式不能重新消费 --vx-platform-scale-* 历史桥接 token。",
};
for (const item of collectDsStylePlatformScaleBridgeViolations(files)) {
  violations.push({ rule: dsStylePlatformScaleBridgeRule, ...item });
}

const dsStyleConsoleScaleBridgeRule = {
  id: "ds/no-ds-style-console-scale-bridge-usage",
  description:
    "DS console 具体样式不能重新消费 --vx-console-scale-* 历史桥接 token。",
};
for (const item of collectDsStyleDomainScaleBridgeViolations(
  files,
  "console",
  "assistant / shell / tenant-switcher / responsive / common",
)) {
  violations.push({ rule: dsStyleConsoleScaleBridgeRule, ...item });
}

const dsStyleAuthScaleBridgeRule = {
  id: "ds/no-ds-style-auth-scale-bridge-usage",
  description:
    "DS auth 具体样式不能重新消费 --vx-auth-scale-* 历史桥接 token。",
};
for (const item of collectDsStyleDomainScaleBridgeViolations(
  files,
  "auth",
  "actions / captcha / fields / form / responsive / signup / tabs / visual",
)) {
  violations.push({ rule: dsStyleAuthScaleBridgeRule, ...item });
}

const dsStyleComponentScaleBridgeRule = {
  id: "ds/no-ds-style-component-scale-bridge-usage",
  description:
    "DS component 具体样式不能重新消费 --vx-component-scale-* 历史桥接 token。",
};
for (const item of collectDsStyleDomainScaleBridgeViolations(
  files,
  "component",
  "fullscreen / ai / button / shell / common",
)) {
  violations.push({ rule: dsStyleComponentScaleBridgeRule, ...item });
}

const dsStyleAuthSubdomainScaleRule = {
  id: "ds/no-ds-style-auth-subdomain-scale-usage",
  description:
    "DS auth 具体样式不能直接消费 auth 子域 scale token；必须使用认证组件语义 token。",
};
for (const item of collectDsStyleSubdomainScaleViolations(files, "auth")) {
  violations.push({ rule: dsStyleAuthSubdomainScaleRule, ...item });
}

const dsStyleConsoleSubdomainScaleRule = {
  id: "ds/no-ds-style-console-subdomain-scale-usage",
  description:
    "DS console 具体样式不能直接消费 console 子域 scale token；必须使用 Console 语义 token。",
};
for (const item of collectDsStyleSubdomainScaleViolations(files, "console")) {
  violations.push({ rule: dsStyleConsoleSubdomainScaleRule, ...item });
}

const dsStyleComponentSubdomainScaleRule = {
  id: "ds/no-ds-style-component-subdomain-scale-usage",
  description:
    "DS component 具体样式不能直接消费 component 子域 scale token；必须使用组件语义 token。",
};
for (const item of collectDsStyleSubdomainScaleViolations(files, "component")) {
  violations.push({ rule: dsStyleComponentSubdomainScaleRule, ...item });
}

const dsStylePlatformModelsSubdomainScaleRule = {
  id: "ds/no-ds-style-platform-models-subdomain-scale-usage",
  description:
    "DS platform models 具体样式不能直接消费 models 子域 scale token；必须使用模型列表/菜单/弹窗语义 token。",
};
for (const item of collectDsStyleExactScalePrefixViolations(
  files,
  "platform-models",
)) {
  violations.push({ rule: dsStylePlatformModelsSubdomainScaleRule, ...item });
}

const dsStylePlatformAccessSubdomainScaleRule = {
  id: "ds/no-ds-style-platform-access-subdomain-scale-usage",
  description:
    "DS platform access 具体样式不能直接消费 access 子域 scale token；必须使用访问域布局/控件语义 token。",
};
for (const item of collectDsStyleExactScalePrefixViolations(
  files,
  "platform-access",
)) {
  violations.push({ rule: dsStylePlatformAccessSubdomainScaleRule, ...item });
}

const dsStylePlatformNotificationsSubdomainScaleRule = {
  id: "ds/no-ds-style-platform-notifications-subdomain-scale-usage",
  description:
    "DS platform notifications 具体样式不能直接消费 notifications 子域 scale token；必须使用通知页语义 token。",
};
for (const item of collectDsStyleExactScalePrefixViolations(
  files,
  "platform-notifications",
)) {
  violations.push({
    rule: dsStylePlatformNotificationsSubdomainScaleRule,
    ...item,
  });
}

const dsStylePlatformTenantSettingsSubdomainScaleRule = {
  id: "ds/no-ds-style-platform-tenant-settings-subdomain-scale-usage",
  description:
    "DS platform tenant settings 具体样式不能直接消费 tenant settings 子域 scale token；必须使用租户设置页语义 token。",
};
for (const item of collectDsStyleExactScalePrefixViolations(
  files,
  "platform-tenant-settings",
)) {
  violations.push({
    rule: dsStylePlatformTenantSettingsSubdomainScaleRule,
    ...item,
  });
}

const dsStylePlatformShellSubdomainScaleRule = {
  id: "ds/no-ds-style-platform-shell-subdomain-scale-usage",
  description:
    "DS platform shell 具体样式不能直接消费 shell 子域 scale token；必须使用 shell 顶栏/助手面板语义 token。",
};
for (const item of collectDsStyleExactScalePrefixViolations(
  files,
  "platform-shell",
)) {
  violations.push({ rule: dsStylePlatformShellSubdomainScaleRule, ...item });
}

const dsStylePlatformLayoutSubdomainScaleRule = {
  id: "ds/no-ds-style-platform-layout-subdomain-scale-usage",
  description:
    "DS platform layout 具体样式不能直接消费 layout 子域 scale token；必须使用页面布局/标题区/卡片语义 token。",
};
for (const item of collectDsStyleExactScalePrefixViolations(
  files,
  "platform-layout",
)) {
  violations.push({ rule: dsStylePlatformLayoutSubdomainScaleRule, ...item });
}

const dsStylePlatformCommonSubdomainScaleRule = {
  id: "ds/no-ds-style-platform-common-subdomain-scale-usage",
  description:
    "DS platform common 具体样式不能直接消费 common 子域 scale token；必须使用平台共享 core/hero/table/responsive 语义 token。",
};
for (const item of collectDsStyleExactScalePrefixViolations(
  files,
  "platform-common",
)) {
  violations.push({ rule: dsStylePlatformCommonSubdomainScaleRule, ...item });
}

const dsStylePlatformAccountSubdomainScaleRule = {
  id: "ds/no-ds-style-platform-account-subdomain-scale-usage",
  description:
    "DS platform account 具体样式不能直接消费 account 子域 scale token；必须使用账号资料、组织、外部账号和弹窗语义 token。",
};
for (const item of collectDsStyleExactScalePrefixViolations(
  files,
  "platform-account",
)) {
  violations.push({ rule: dsStylePlatformAccountSubdomainScaleRule, ...item });
}

if (UPDATE_BASELINE) {
  updateBaseline(violations);
  process.exit(0);
}

const baseline = readBaseline();
const activeViolations = violations.filter(
  (item) => !isBaselineAllowed(item, baseline),
);

if (activeViolations.length > 0) {
  console.error("\nDesign System guardrails failed:\n");
  for (const item of activeViolations) {
    console.error(`- ${item.rule.id}: ${item.file}:${item.line}`);
    console.error(`  ${item.message}`);
  }
  console.error(
    "\nFix rule: design tokens and primitives belong in @vxture/design-system; apps only compose them.\n",
  );
  process.exit(1);
}

const baselineCount = violations.length - activeViolations.length;
console.log(
  baselineCount > 0
    ? `Design System guardrails passed. Existing DS debt locked by baseline: ${baselineCount}.`
    : "Design System guardrails passed.",
);

function collectFiles(target) {
  const dirName = path.basename(target);
  if (IGNORED_PARTS.has(dirName)) return [];
  if (!exists(target)) return [];
  const stats = statSync(target);
  if (stats.isFile()) return [target];
  if (!stats.isDirectory()) return [];

  return readdirSync(target).flatMap((entry) =>
    collectFiles(path.join(target, entry)),
  );
}

function exists(target) {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

function hasRawColor(line) {
  // Comment text is never a violation — a colour written in prose renders
  // nothing. stripLineComment only handles `//`, so a JSDoc/block-comment line
  // reached the hex pattern intact, and this repo writes issue references like
  // `#226` in exactly those comments: three hex-valid digits behind a `#`,
  // indistinguishable from a colour to a regex. Worse, it only fires in scanned
  // directories, so the same sentence passes in bff/ and fails in packages/ —
  // a trap that springs on file location rather than on content.
  //
  // 上面那条只挡住了整行是注释的情形。仓库里还有另一类：issue 号写在**JSX 文案与模板
  // 串里**（`description="…由 vxture-atlas#159 交付…"`），那不是注释，照样被当成色值。
  //
  // 真正的判据不是"在不在注释里"，而是 `#` 前面是什么：**CSS / Tailwind 的色值，`#`
  // 前面永远不是单词字符**——写法只有 `: #abc`、`-[#abc]`、`"#abc"`、`=#abc` 这几种；
  // 而 `atlas#159` 前面是个 `s`。按这一条判，散文里的 issue 引用一次都不会误伤，
  // 真色值一个都不会漏。
  if (isCommentLine(line)) return false;
  const text = stripLineComment(line);
  if (/(?:^|[^\w])#(?:[0-9a-fA-F]{3,8})\b/.test(text)) return true;
  if (/\b(?:rgb|rgba|hsl|hsla)\(\s*(?:\d|#)/i.test(text)) return true;
  return false;
}

function hasHardcodedScale(value) {
  return /(?:^|[\s(,])[-+]?\d+(?:\.\d+)?(?:px|rem|em)\b/.test(value);
}

function hasTailwindArbitraryScale(line) {
  const text = stripLineComment(line);
  return /(?:^|[\s"'`{])!?[A-Za-z0-9:/_-]+-\[[^\]]*\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)[^\]]*\]/.test(
    text,
  );
}

function isAllowlistedScaleLine(line) {
  const text = stripLineComment(line).trim();
  if (!text) return true;
  if (text.startsWith("@media")) return true;
  return false;
}

function isAllowlistedScaleDeclaration(property, value) {
  const normalizedProperty = property.toLowerCase();
  const normalizedValue = value.trim();
  if (normalizedProperty.startsWith("--")) return true;
  if (
    /^(grid-template-columns|grid-template-rows|grid-auto-columns|grid-auto-rows)$/.test(
      normalizedProperty,
    )
  ) {
    return true;
  }
  if (
    /^(border|border-top|border-right|border-bottom|border-left|outline)$/.test(
      normalizedProperty,
    ) &&
    isHairlineOnly(normalizedValue)
  ) {
    return true;
  }
  if (
    /^(width|min-width|max-width|height|min-height|max-height)$/.test(
      normalizedProperty,
    ) &&
    /\b(?:calc|min|max)\(/.test(normalizedValue)
  ) {
    return true;
  }
  return false;
}

function isHairlineOnly(value) {
  const scaleValues = value.match(/[-+]?\d+(?:\.\d+)?(?:px|rem|em)\b/g) ?? [];
  return (
    scaleValues.length > 0 &&
    scaleValues.every((item) => item === "1px" || item === "0px")
  );
}

/** A whole-line comment: `// …`, `/* …`, or a JSDoc continuation `* …`. */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

function stripLineComment(line) {
  const commentIndex = line.indexOf("//");
  return commentIndex >= 0 ? line.slice(0, commentIndex) : line;
}

/**
 * 把注释里的字符换成空格，行数与列数保持不变。
 *
 * 为什么需要它：`isCommentLine` 只认**整行以 `//` / `/*` / `*` 开头**的那一种。
 * 块注释（含 JSX 的 `{/* … *\/}`）的第二行往后是普通文字开头，它一条都认不出。
 * 于是「我为什么把这里的原生 `<input>` 换掉了」这句话本身会撞上
 * `ds/no-native-primitive`——**规则在惩罚写清楚原因的人**，而绕过它的办法是
 * 把原因删掉。这跟当初 fonts.css 那条注释触发字体守卫是同一类毛病。
 *
 * 逐字符扫，识别行注释、块注释与三种字符串字面量（引号里的 `//` 不是注释，
 * `"https://…"` 不该被吞掉）。JSX 正文里出现的裸 `//` 会被误判成注释起点，
 * 但那只会让该行漏检，不会误报——守卫宁可漏也不能冤枉。
 */
function maskComments(content) {
  const out = content.split("");
  let state = "code"; // code | line | block | single | double | template
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        out[i] = " ";
        out[i + 1] = " ";
        i += 1;
      } else if (ch === "/" && next === "*") {
        state = "block";
        out[i] = " ";
        out[i + 1] = " ";
        i += 1;
      } else if (ch === "'") state = "single";
      else if (ch === '"') state = "double";
      else if (ch === "`") state = "template";
      continue;
    }
    if (state === "line") {
      if (ch === "\n") state = "code";
      else out[i] = " ";
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 1;
        state = "code";
      } else if (ch !== "\n") out[i] = " ";
      continue;
    }
    // 字符串字面量：内容原样保留，只负责找到收尾引号。
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (
      (state === "single" && ch === "'") ||
      (state === "double" && ch === '"') ||
      (state === "template" && ch === "`")
    ) {
      state = "code";
    }
  }
  return out.join("");
}

/**
 * 逐行跑一条正则，但**先把注释抹掉**。给 `no-native-primitive` /
 * `no-native-table` 这类"源码里不许出现某个写法"的规则用——它们要禁的是代码，
 * 不是讲代码的话。
 */
function checkCodeLines(file, content, pattern, message) {
  if (!isFrontendSource(file) || isGeneratedOrAsset(file)) return [];
  const results = [];
  maskComments(content)
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (!pattern.test(line)) return;
      results.push(violation(file, index + 1, message, line.trim()));
    });
  return results;
}

function hasAiPrimitiveTokenUsage(line) {
  return (
    /--(?:color-)?vx-(?:color-)?(?:ai|ai-cyan|spark)-\d{2,3}\b/.test(line) ||
    /\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration)-vx-(?:ai|ai-cyan|spark)-\d{2,3}\b/.test(
      line,
    )
  );
}

function isFrontendSource(file) {
  return /^(portals|agent-studio|business)\//.test(normalize(file));
}

function isExtractedPortalStyleModule(file) {
  return /^(portals|agent-studio|business)\/[^/]+\/src\/styles\/.+\.css$/.test(
    normalize(file),
  );
}

function isImportOnlyStyleContent(content) {
  const trimmed = content.trim();
  if (!trimmed) return false;
  let inBlockComment = false;
  return trimmed.split(/\r?\n/).every((line) => {
    const text = line.trim();
    if (!text) return true;
    if (inBlockComment) {
      if (text.includes("*/")) inBlockComment = false;
      return true;
    }
    if (text.startsWith("/*")) {
      if (!text.includes("*/")) inBlockComment = true;
      return true;
    }
    return /^@import\s+["'][^"']+["'](\s+layer\([a-z-]+\))?;$/.test(text);
  });
}

function collectMissingCssImportViolations(sourceFiles) {
  const items = [];
  for (const file of sourceFiles) {
    if (path.extname(file) !== ".css" || isGeneratedOrAsset(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const item of findCssImports(content)) {
      if (!item.specifier.startsWith(".")) continue;
      const target = path.resolve(path.dirname(file), item.specifier);
      if (exists(target)) continue;
      items.push(
        violation(
          file,
          item.line,
          `${item.specifier} 指向的 CSS 文件不存在；请修正 @import 或恢复对应模块。`,
          item.source,
        ),
      );
    }
  }
  return items;
}

function collectLegacyScaleTokenStyleViolations(sourceFiles) {
  const items = [];
  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (LEGACY_SCALE_TOKEN_STYLE_PATHS.has(normalized)) {
      items.push(
        violation(
          file,
          1,
          "已清零的 scale bridge token 文件不得恢复；请在具体 token owner 中直接定义运行时值。",
          normalized,
        ),
      );
    }

    if (path.extname(file) !== ".css" || isGeneratedOrAsset(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const item of findCssImports(content)) {
      if (!item.specifier.startsWith(".")) continue;
      const target = normalize(
        path.relative(ROOT, path.resolve(path.dirname(file), item.specifier)),
      );
      if (!LEGACY_SCALE_TOKEN_STYLE_PATHS.has(target)) continue;
      items.push(
        violation(
          file,
          item.line,
          `${item.specifier} 指向已清零的 scale bridge token 文件；请直接使用具体 token owner 的运行时值。`,
          item.source,
        ),
      );
    }
  }
  return items;
}

function collectLegacyComponentMetricTokenStyleViolations(sourceFiles) {
  const items = [];
  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (LEGACY_COMPONENT_METRIC_TOKEN_STYLE_PATHS.has(normalized)) {
      items.push(
        violation(
          file,
          1,
          "已清零的 component metric token 文件不得恢复；请在具体 token owner 中直接定义运行时值。",
          normalized,
        ),
      );
    }

    if (path.extname(file) !== ".css" || isGeneratedOrAsset(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const item of findCssImports(content)) {
      if (!item.specifier.startsWith(".")) continue;
      const target = normalize(
        path.relative(ROOT, path.resolve(path.dirname(file), item.specifier)),
      );
      if (!LEGACY_COMPONENT_METRIC_TOKEN_STYLE_PATHS.has(target)) continue;
      items.push(
        violation(
          file,
          item.line,
          `${item.specifier} 指向已清零的 component metric token 文件；请直接使用具体 token owner 的运行时值。`,
          item.source,
        ),
      );
    }
  }
  return items;
}

function collectRuntimeScaleBridgeVarViolations(sourceFiles) {
  const items = [];
  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (
      !normalized.startsWith(`${DS_ROOT}/src/styles/`) ||
      !normalized.endsWith(".css")
    )
      continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!DS_RUNTIME_SCALE_BRIDGE_VAR_PATTERN.test(stripLineComment(line)))
        return;
      items.push(
        violation(
          file,
          index + 1,
          "DS 样式层 scale bridge 已清零；新增尺度请在 token owner 中直接定义运行时值，不要重新使用 var(--vx-*-scale-*)。",
          line.trim(),
        ),
      );
    });
  }
  return items;
}

function collectRuntimeComponentMetricVarViolations(sourceFiles) {
  const items = [];
  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (
      !normalized.startsWith(`${DS_ROOT}/src/styles/`) ||
      !normalized.endsWith(".css")
    )
      continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!DS_RUNTIME_COMPONENT_METRIC_VAR_PATTERN.test(stripLineComment(line)))
        return;
      items.push(
        violation(
          file,
          index + 1,
          "DS 样式层 component metric bridge 已清零；新增尺度请在 token owner 中直接定义运行时值，不要重新使用 var(--vx-component-metric-*)。",
          line.trim(),
        ),
      );
    });
  }
  return items;
}

function collectUnreachableAppStyleViolations(sourceFiles) {
  const fileByPath = new Map(
    sourceFiles.map((file) => [normalize(path.relative(ROOT, file)), file]),
  );
  const stylesByApp = new Map();

  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    const match = normalized.match(
      /^(portals|agent-studio|business)\/([^/]+)\/src\/styles\/.+\.css$/,
    );
    if (!match) continue;
    const appRoot = `${match[1]}/${match[2]}`;
    const items = stylesByApp.get(appRoot) ?? [];
    items.push(normalized);
    stylesByApp.set(appRoot, items);
  }

  const items = [];
  for (const [appRoot, styleFiles] of stylesByApp.entries()) {
    const globals = `${appRoot}/src/app/globals.css`;
    const globalsFile = fileByPath.get(globals);
    if (!globalsFile) continue;

    const reachable = collectReachableCssFiles(globals, fileByPath);
    for (const styleFile of styleFiles) {
      if (reachable.has(styleFile)) continue;
      items.push(
        violation(
          fileByPath.get(styleFile),
          1,
          "该应用样式模块无法从 src/app/globals.css 的 @import 图谱到达；请接入稳定入口或移除陈旧文件。",
          styleFile,
        ),
      );
    }
  }

  return items;
}

function collectUnreachableDsStyleViolations(sourceFiles) {
  const fileByPath = new Map(
    sourceFiles.map((file) => [normalize(path.relative(ROOT, file)), file]),
  );
  const dsStyleFiles = [...fileByPath.keys()].filter(
    (file) =>
      file.startsWith(`${DS_ROOT}/src/styles/`) && file.endsWith(".css"),
  );
  const reachable = new Set();
  for (const entry of DS_EXPORTED_STYLE_PATHS) {
    for (const item of collectReachableCssFiles(entry, fileByPath)) {
      reachable.add(item);
    }
  }

  return dsStyleFiles
    .filter((file) => !reachable.has(file))
    .map((file) =>
      violation(
        fileByPath.get(file),
        1,
        "该 DS 样式模块无法从 package exports 的公共样式入口 @import 图谱到达；请接入稳定入口或移除陈旧文件。",
        file,
      ),
    );
}

function collectRedundantStyleWrapperViolations(sourceFiles) {
  const fileByPath = new Map(
    sourceFiles.map((file) => [normalize(path.relative(ROOT, file)), file]),
  );
  const globalsStyleEntries = collectGlobalsStyleEntries(sourceFiles);
  const items = [];

  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (
      !/^(portals|agent-studio|business)\/[^/]+\/src\/styles\/.+\.css$/.test(
        normalized,
      )
    )
      continue;
    if (globalsStyleEntries.has(normalized)) continue;

    const content = readFileSync(file, "utf8");
    if (!isImportOnlyStyleContent(content)) continue;

    const localImports = findCssImports(content)
      .filter((item) => item.specifier.startsWith("."))
      .map((item) =>
        normalize(
          path.relative(ROOT, path.resolve(path.dirname(file), item.specifier)),
        ),
      )
      .filter((target) => fileByPath.has(target));

    if (localImports.length !== 1) continue;
    items.push(
      violation(
        file,
        1,
        "非 globals 直连的 import-only 样式 wrapper 不能只转发一个子模块；请折叠该层或补充真实语义聚合职责。",
        normalized,
      ),
    );
  }

  return items;
}

function collectRedundantDsStyleWrapperViolations(sourceFiles) {
  const fileByPath = new Map(
    sourceFiles.map((file) => [normalize(path.relative(ROOT, file)), file]),
  );
  const items = [];

  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (
      !normalized.startsWith(`${DS_ROOT}/src/styles/`) ||
      !normalized.endsWith(".css")
    )
      continue;
    if (DS_EXPORTED_STYLE_PATHS.has(normalized)) continue;

    const content = readFileSync(file, "utf8");
    if (!isImportOnlyStyleContent(content)) continue;

    const localImports = findCssImports(content)
      .filter((item) => item.specifier.startsWith("."))
      .map((item) =>
        normalize(
          path.relative(ROOT, path.resolve(path.dirname(file), item.specifier)),
        ),
      )
      .filter((target) => fileByPath.has(target));

    if (localImports.length !== 1) continue;
    items.push(
      violation(
        file,
        1,
        "DS 内部 import-only 样式 wrapper 不能只转发一个子模块；请折叠该层，公开 styles/* 入口除外。",
        normalized,
      ),
    );
  }

  return items;
}

function collectDsStyleHardcodedScaleCount(sourceFiles) {
  let count = 0;
  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (!isDsStyleScaleDebtFile(normalized)) continue;
    // 先整体剥掉块注释再逐行看。`stripLineComment` 认的是 `//`，那不是 CSS 的
    // 注释语法——注释里写一句"16px"就会被记成一处硬编码尺度，把预算顶穿。
    const lines = stripCssBlockComments(readFileSync(file, "utf8")).split(
      /\r?\n/,
    );
    for (const line of lines) {
      if (hasDsStyleHardcodedScale(line)) count += 1;
    }
  }
  return count;
}

function collectDsStyleScaleBridgeViolations(sourceFiles) {
  const items = [];
  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (!isDsStyleScaleDebtFile(normalized)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/var\(--vx-scale-/.test(stripLineComment(line))) return;
      items.push(
        violation(
          file,
          index + 1,
          "非 token owner 不得重新消费 --vx-scale-* 历史桥接 token；新增尺度请落到具体语义 token。",
          line.trim(),
        ),
      );
    });
  }
  return items;
}

function collectDsStylePlatformScaleBridgeViolations(sourceFiles) {
  const items = [];
  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (!isDsStyleScaleDebtFile(normalized)) continue;
    if (
      !/^packages\/design\/design-system\/src\/styles\/platform[\w-]*\.css$/.test(
        normalized,
      )
    )
      continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/var\(--vx-platform-scale-/.test(stripLineComment(line))) return;
      items.push(
        violation(
          file,
          index + 1,
          "Platform 具体样式不得重新消费 --vx-platform-scale-* 历史桥接 token；新增尺度请落到对应 platform 语义 token。",
          line.trim(),
        ),
      );
    });
  }
  return items;
}

function collectDsStyleDomainScaleBridgeViolations(
  sourceFiles,
  prefix,
  domains,
) {
  const items = [];
  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (!isDsStyleScaleDebtFile(normalized)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (
        !new RegExp(`var\\(--vx-${prefix}-scale-`).test(stripLineComment(line))
      )
        return;
      items.push(
        violation(
          file,
          index + 1,
          `${prefix} 具体样式不得重新消费 --vx-${prefix}-scale-* 历史桥接 token；新增尺度请落到 ${domains} 对应语义 token。`,
          line.trim(),
        ),
      );
    });
  }
  return items;
}

function collectDsStyleSubdomainScaleViolations(sourceFiles, prefix) {
  const items = [];
  const pattern = new RegExp(`var\\(--vx-${prefix}-[\\w-]+-scale-`);
  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (!isDsStyleScaleDebtFile(normalized)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!pattern.test(stripLineComment(line))) return;
      items.push(
        violation(
          file,
          index + 1,
          `${prefix} 具体样式不得直接消费子域 scale token；请通过 ${prefix} 语义 token 组装。`,
          line.trim(),
        ),
      );
    });
  }
  return items;
}

function collectDsStyleExactScalePrefixViolations(sourceFiles, prefix) {
  const items = [];
  const pattern = new RegExp(`var\\(--vx-${prefix}-scale-`);
  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (!isDsStyleScaleDebtFile(normalized)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!pattern.test(stripLineComment(line))) return;
      items.push(
        violation(
          file,
          index + 1,
          `${prefix} 具体样式不得直接消费子域 scale token；请通过对应 Platform 语义 token 组装。`,
          line.trim(),
        ),
      );
    });
  }
  return items;
}

function isDsStyleScaleDebtFile(normalized) {
  // typography.css 曾在此豁免（手写角色类里满是裸字号）。该文件已退役——24 档角色
  // 改由 `@theme` 的 `--text-*` 注册产出工具类，不再有手写刻度可豁免。
  return (
    normalized.startsWith(`${DS_ROOT}/src/styles/`) &&
    normalized.endsWith(".css") &&
    !DS_RUNTIME_TOKEN_STYLE_PATTERN.test(normalized)
  );
}

/** 抹掉 CSS 块注释，保留行数（换行不动），行号才对得上。 */
function stripCssBlockComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
}

function hasDsStyleHardcodedScale(line) {
  const text = stripLineComment(line);
  if (/^\s*@media\b/.test(text)) return false;
  return /(?:^|[\s(,])[-+]?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|dvh|dvw)\b/.test(
    text,
  );
}

function collectGlobalsStyleEntries(sourceFiles) {
  const entries = new Set();
  for (const file of sourceFiles) {
    const normalized = normalize(path.relative(ROOT, file));
    if (
      !/^(portals|agent-studio|business)\/[^/]+\/src\/app\/globals\.css$/.test(
        normalized,
      )
    )
      continue;

    const content = readFileSync(file, "utf8");
    for (const item of findCssImports(content)) {
      if (!item.specifier.startsWith("../styles/")) continue;
      entries.add(
        normalize(
          path.relative(ROOT, path.resolve(path.dirname(file), item.specifier)),
        ),
      );
    }
  }
  return entries;
}

function collectReachableCssFiles(entry, fileByPath) {
  const reachable = new Set();
  const stack = [entry];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || reachable.has(current)) continue;
    const file = fileByPath.get(current);
    if (!file) continue;

    reachable.add(current);
    const content = readFileSync(file, "utf8");
    for (const item of findCssImports(content)) {
      if (!item.specifier.startsWith(".")) continue;
      const target = normalize(
        path.relative(ROOT, path.resolve(path.dirname(file), item.specifier)),
      );
      if (!fileByPath.has(target)) continue;
      stack.push(target);
    }
  }
  return reachable;
}

function findCssImports(content) {
  const imports = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const pattern = /@import\s+(?:url\()?["']([^"']+)["']/g;
    let match = pattern.exec(line);
    while (match) {
      imports.push({
        line: index + 1,
        source: line,
        specifier: match[1] ?? "",
      });
      match = pattern.exec(line);
    }
  });
  return imports;
}

function isDesignSystemConsumerSource(file) {
  const normalized = normalize(file);
  if (normalized.startsWith(`${DS_ROOT}/`)) return false;
  return /^(portals|agent-studio|business|packages)\//.test(normalized);
}

function isFrontendPackageManifest(file) {
  return /^(portals|agent-studio|business)\/[^/]+\/package\.json$/.test(
    normalize(file),
  );
}

function isDirectUiEngineDependency(dependency) {
  return DIRECT_UI_ENGINE_DEPENDENCIES.some((item) =>
    typeof item === "string" ? item === dependency : item.test(dependency),
  );
}

function isDsSemanticStyleFile(normalized) {
  return (
    DS_SEMANTIC_STYLE_PATHS.has(normalized) ||
    /^packages\/design\/design-system\/src\/styles\/components-[\w-]+\.css$/.test(
      normalized,
    ) ||
    /^packages\/design\/design-system\/src\/styles\/platform-[\w-]+\.css$/.test(
      normalized,
    )
  );
}

function findDesignSystemSpecifiers(line) {
  const specifiers = [];
  const patterns = [
    /from\s+["'](@vxture\/design-system(?:\/[^"']+)?)["']/g,
    /import\s+["'](@vxture\/design-system(?:\/[^"']+)?)["']/g,
    /@import\s+["'](@vxture\/design-system(?:\/[^"']+)?)["']/g,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(line);
    while (match) {
      if (match[1]) specifiers.push(match[1]);
      match = pattern.exec(line);
    }
  }

  return specifiers;
}

function isDsTokenOwner(file) {
  const normalized = normalize(file);
  return (
    DS_RUNTIME_TOKEN_STYLE_PATTERN.test(normalized) ||
    DS_TOKEN_PATHS.some(
      (tokenPath) =>
        normalized === tokenPath || normalized.startsWith(`${tokenPath}/`),
    )
  );
}

/** 裸缓动曲线：`--vx-ease-*` 是可引用的 token，没有理由写字面量。 */
function hasLiteralEasing(text) {
  return /\b(?:cubic-bezier|steps)\s*\(/.test(text) || /\bease(?:-in|-out|-in-out)?\b(?!\s*\))/.test(text.replace(/var\([^)]*\)/g, ""));
}

function isTokenOrNoneShadowValue(value) {
  const normalized = (value ?? "").trim();
  if (!normalized) return false;
  const isNoShadow = normalized === "none" || normalized.startsWith("none ");
  if (isNoShadow) return true;
  if (!normalized.startsWith("var(")) return false;
  return !/,\s*(?:-?\d|inset\b|calc\()/u.test(normalized);
}

/**
 * motion 值是否只由 token 构成。
 *
 * 判据是「除 var() 引用外不得出现字面时长或曲线」。
 *
 * 不要求 `--vx-` 前缀：T2 的时长与缓动刻意命名为 `--transition-duration-*` /
 * `--ease-*`——那是 v4 的真实命名空间名，带前缀就不产出 duration-fast / ease-enter
 * 工具类。前缀只属于 T1。
 */
function isTokenOrNoneMotionValue(value) {
  const normalized = (value ?? "").trim();
  if (!normalized) return true;
  if (normalized === "none" || normalized.startsWith("none ")) return true;

  // 字面时长与曲线函数：连 var() 的回退值里也不允许，故在剥离前先查。
  if (/\d+(?:\.\d+)?m?s/.test(normalized)) return false;
  if (/cubic-bezier\(|steps\(/.test(normalized)) return false;

  const withoutVars = normalized.replace(/var\((?:[^()]|\([^()]*\))*\)/g, " ");
  // 剥掉 var() 后只应剩属性名、时长字面量、空白与分段逗号；缓动关键字属字面值。
  if (/\b(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)\b/.test(withoutVars))
    return false;
  return /^[\w\s,.-]*$/.test(withoutVars);
}

function isGeneratedOrAsset(file) {
  const normalized = normalize(file);
  return /\/(dist|build|\.next|public|assets)\//.test(normalized);
}

function findInlineStyleViolations(file, content) {
  const lines = content.split(/\r?\n/);
  const items = [];
  let block = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!block && /style=\{\{/.test(line)) {
      block = {
        line: lineNumber,
        lines: [line],
      };
      if (line.includes("}}")) {
        pushInlineStyleViolation(file, block, items);
        block = null;
      }
      return;
    }

    if (!block) return;
    block.lines.push(line);
    if (line.includes("}}") || block.lines.length >= 80) {
      pushInlineStyleViolation(file, block, items);
      block = null;
    }
  });

  return items;
}

function findNamedStyleObjectViolations(file, content) {
  const lines = content.split(/\r?\n/);
  const items = [];
  let block = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!block && isNamedStyleObjectStart(lines, index)) {
      block = {
        line: lineNumber,
        lines: [line],
      };
      if (line.includes("}") || line.includes("};")) {
        pushNamedStyleObjectViolation(file, block, items);
        block = null;
      }
      return;
    }

    if (!block) return;
    block.lines.push(line);
    if (line.includes("}") || block.lines.length >= 80) {
      pushNamedStyleObjectViolation(file, block, items);
      block = null;
    }
  });

  return items;
}

function pushInlineStyleViolation(file, block, items) {
  const text = block.lines.join("\n");
  if (!hasInlineDesignValue(text)) return;
  items.push(
    violation(
      file,
      block.line,
      "inline style 只能用于 CSS 变量、坐标、transform、背景图片等动态值；颜色/字体/间距/圆角/阴影进入 DS。",
      text,
    ),
  );
}

function pushNamedStyleObjectViolation(file, block, items) {
  const text = block.lines.join("\n");
  if (!hasInlineDesignValue(text)) return;
  items.push(
    violation(
      file,
      block.line,
      "间接 style 对象只能用于 CSS 变量、坐标、transform、背景图片等动态值；固定设计值必须进入 DS token 或语义 CSS。",
      text,
    ),
  );
}

function isNamedStyleObjectStart(lines, index) {
  const line = lines[index] ?? "";
  if (/\b(?:const|let|var)\s+\w*Style\w*\s*=\s*\{/.test(line)) return true;
  if (
    /\bconst\s+\w*Style\w*\s*=.*:\s*(?:React\.)?CSSProperties\b.*=>\s*\(\s*\{/.test(
      line,
    )
  )
    return true;
  if (/\(\)\s*=>\s*\(\s*\{/.test(line)) {
    const memoScope = lines.slice(Math.max(0, index - 4), index + 1).join("\n");
    return /\bconst\s+\w*Style\w*\s*=\s*useMemo<(?:(?:React\.)?CSSProperties)>/.test(
      memoScope,
    );
  }
  if (!/\breturn\s+\{/.test(line)) return false;

  const scope = lines.slice(Math.max(0, index - 6), index + 1).join("\n");
  return /\bfunction\s+\w*Style\w*\s*\([^)]*\)\s*:\s*(?:React\.)?CSSProperties\b/.test(
    scope,
  );
}

function hasInlineDesignValue(text) {
  const compact = stripQuotedTemplateExpressions(text);
  if (
    /['"]--vx-[\w-]+['"]\s*:/.test(compact) &&
    !hasUnsafeInlineStyleProperty(compact)
  )
    return false;
  return hasUnsafeInlineStyleProperty(compact);
}

function hasUnsafeInlineStyleProperty(text) {
  return /(?:^|[,{;\s])(?:background|backgroundColor|border|borderColor|borderRadius|boxShadow|color|display|alignItems|justifyContent|gap|fontFamily|fontSize|fontWeight|letterSpacing|lineHeight|margin|marginTop|marginRight|marginBottom|marginLeft|padding|paddingTop|paddingRight|paddingBottom|paddingLeft|minWidth|maxWidth|minHeight|maxHeight)\s*:/.test(
    text,
  );
}

function stripQuotedTemplateExpressions(text) {
  return text
    .replace(/`[^`]*`/g, "``")
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''");
}

function readBaseline() {
  if (!exists(BASELINE_PATH)) return new Set();
  const data = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  return new Set(Array.isArray(data.allowed) ? data.allowed : []);
}

function updateBaseline(allViolations) {
  const allowed = [
    ...new Set(
      allViolations
        .filter((item) => BASELINED_RULE_IDS.has(item.rule.id))
        .map(signatureFor),
    ),
  ].sort();
  const payload = {
    version: 1,
    description:
      "Existing DS inline-style/native-primitive/scale debt. The guardrail blocks new signatures; shrink this file as modules migrate to DS.",
    allowed,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `Design System baseline updated: ${allowed.length} existing violations recorded.`,
  );
}

function isBaselineAllowed(item, baseline) {
  return (
    BASELINED_RULE_IDS.has(item.rule.id) && baseline.has(signatureFor(item))
  );
}

function signatureFor(item) {
  const source = item.source
    ? normalizeSnippet(item.source)
    : `${item.file}:${item.line}`;
  return `${item.rule.id}|${item.file}|${source}`;
}

function normalizeSnippet(value) {
  return value.replace(/\s+/g, " ").trim();
}

function findLineNumber(content, pattern) {
  const index = content.indexOf(pattern);
  if (index < 0) return 1;
  return content.slice(0, index).split(/\r?\n/).length;
}

function normalizedTextSize(file) {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n").length;
}

function readJsonFile(file) {
  return JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
}

function readAllowedDesignSystemImports(manifest) {
  const exportsMap = manifest.exports ?? {};
  return new Set(
    Object.keys(exportsMap).map((key) =>
      key === "."
        ? "@vxture/design-system"
        : `@vxture/design-system/${key.replace(/^\.\//, "")}`,
    ),
  );
}

function readDesignSystemExportedStylePaths(manifest) {
  return new Set(
    Object.entries(manifest.exports ?? {})
      .filter(
        ([key, value]) =>
          key.startsWith("./styles/") && typeof value === "string",
      )
      .map(([, value]) =>
        normalize(`${DS_ROOT}/${value.replace(/^\.\//, "")}`),
      ),
  );
}

function collectPublicEntryDocViolations(file) {
  const normalized = normalize(file);
  const content = readFileSync(file, "utf8");
  const entries = [...ALLOWED_DS_IMPORTS].sort((a, b) => a.localeCompare(b));
  const section = publicEntryDocSection(normalized, content);
  const documentedEntries = findDocumentedPublicEntries(section);
  const missingEntries = entries
    .filter((entry) => !hasPublicEntryDocLine(normalized, content, entry))
    .map((entry) =>
      violation(
        file,
        findLineNumber(content, "公共入口"),
        `公共入口文档缺少 package exports 暴露的入口：${entry}`,
      ),
    );
  const staleEntries = documentedEntries
    .filter((entry) => !ALLOWED_DS_IMPORTS.has(entry))
    .map((entry) =>
      violation(
        file,
        findLineNumber(content, entry),
        `公共入口文档声明了 package exports 未暴露的入口：${entry}`,
      ),
    );

  return [...missingEntries, ...staleEntries];
}

function hasPublicEntryDocLine(file, content, entry) {
  if (file === DS_README_DOC) {
    return content.includes(`- \`${entry}\``);
  }
  return content.includes(`| \`${entry}\``);
}

function collectVersionDocViolations(file) {
  const normalized = normalize(file);
  const content = readFileSync(file, "utf8");
  const expected =
    normalized === DS_PACKAGE_DOC
      ? `| 版本   | \`${DS_PACKAGE_VERSION}\``
      : `版本：${DS_PACKAGE_VERSION}`;
  if (content.includes(expected)) return [];
  return [
    violation(
      file,
      findLineNumber(content, "版本"),
      `DS 文档版本必须与 packages/design/design-system/package.json 保持一致，期望：${expected}`,
    ),
  ];
}

function collectPackageStyleExportViolations(file) {
  const content = readFileSync(file, "utf8");
  const entries = Object.entries(DS_PACKAGE_MANIFEST.exports ?? {});
  return entries.flatMap(([key, value]) => {
    if (!key.startsWith("./styles/")) return [];
    if (typeof value !== "string") {
      return [
        violation(
          file,
          findLineNumber(content, `"${key}"`),
          `${key} 样式入口必须直接指向 CSS 文件。`,
        ),
      ];
    }
    const target = path.join(ROOT, "packages/design/design-system", value);
    if (exists(target)) return [];
    return [
      violation(
        file,
        findLineNumber(content, `"${key}"`),
        `${key} 指向的样式文件不存在：${value}`,
      ),
    ];
  });
}

function collectDesignMigrationArtifactViolations(file) {
  const designRoot = path.join(ROOT, "packages/design");
  if (!exists(designRoot)) return [];

  return readdirSync(designRoot, { withFileTypes: true }).flatMap((entry) => {
    const normalized = normalize(`packages/design/${entry.name}`);
    if (entry.isFile() && entry.name.endsWith(".css")) {
      return [
        violation(
          file,
          1,
          `packages/design 根目录不得保留迁移 CSS：${entry.name}；正式实现应进入 design-system/src/styles。`,
          normalized,
        ),
      ];
    }
    if (entry.isDirectory() && /^vxture-v[\d.]+-components$/.test(entry.name)) {
      return [
        violation(
          file,
          1,
          `packages/design 根目录不得保留迁移素材包：${entry.name}；迁入完成后只保留正式 DS 源码。`,
          normalized,
        ),
      ];
    }
    return [];
  });
}

function publicEntryDocSection(file, content) {
  if (file === DS_README_DOC) {
    return sliceBetween(content, "允许的公共入口：", "禁止从");
  }
  return sliceBetween(content, "## 公共入口", "其他 `@vxture/design-system/*`");
}

function findDocumentedPublicEntries(content) {
  return [...content.matchAll(/`(@vxture\/design-system(?:\/[^`]+)?)`/g)]
    .map((match) => match[1])
    .filter((entry) => !entry.includes("*"));
}

function sliceBetween(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  if (start < 0) return "";
  const end = content.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? content.slice(start) : content.slice(start, end);
}

function collectComponentDocCountViolations(file) {
  const normalized = normalize(file);
  const content = readFileSync(file, "utf8");
  const uiCount = countDsComponentFiles("ui");
  const aiCount = countDsComponentFiles("ai");
  const totalCount = uiCount + aiCount;
  const expectations =
    normalized === DS_README_DOC
      ? [
          {
            pattern: `### UI 组件（${uiCount} 个）`,
            message: `README UI 组件数量应为 ${uiCount}。`,
          },
          {
            pattern: `### AI 组件（${aiCount} 个）`,
            message: `README AI 组件数量应为 ${aiCount}。`,
          },
        ]
      : [
          {
            pattern: `│   ├── ui/       # ${uiCount} 个 UI primitive 和平台 pattern`,
            message: `包说明目录结构中的 UI 组件数量应为 ${uiCount}。`,
          },
          {
            pattern: `│   ├── ai/       # ${aiCount} 个 AI 组件`,
            message: `包说明目录结构中的 AI 组件数量应为 ${aiCount}。`,
          },
          {
            pattern: `当前公共组件共 ${totalCount} 个：\`src/components/ui\` ${uiCount} 个 \`.tsx\` 组件，\`src/components/ai\` ${aiCount} 个 AI 组件。`,
            message: `包说明公共组件总数应为 ${totalCount}，其中 UI ${uiCount}、AI ${aiCount}。`,
          },
        ];

  return expectations
    .filter(({ pattern }) => !content.includes(pattern))
    .map(({ pattern, message }) =>
      violation(
        file,
        findLineNumber(content, "UI 组件"),
        `${message} 缺少期望文本：${pattern}`,
      ),
    );
}

function countDsComponentFiles(group) {
  const directory = path.join(
    ROOT,
    "packages/design/design-system/src/components",
    group,
  );
  return readdirSync(directory).filter((name) => name.endsWith(".tsx")).length;
}

function violation(file, line, message, source = "") {
  return {
    file: normalize(path.relative(ROOT, file)),
    line,
    message,
    source,
  };
}

function normalize(value) {
  const forward = value.replaceAll("\\", "/");
  const rootForward = ROOT.replaceAll("\\", "/").replace(/\/?$/, "/");
  if (forward.startsWith(rootForward)) return forward.slice(rootForward.length);
  return forward.replace(/^([A-Za-z]:)?\/?MyWebSite\/vxture\//, "");
}
