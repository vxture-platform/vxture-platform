/**
 * dep-cruiser 包边界规则
 *
 * 执行 CLAUDE.md 和 docs/architecture/02-package-boundaries.md 中定义的依赖方向约束。
 * 违反规则的 import 在 CI 中报 error 级别错误。
 *
 * 层级顺序（高→低，只能向下引用）：
 *   Presentation (portals / business)
 *     → Application (bff)
 *       → Domain (services)
 *         → Infrastructure (packages/core)
 *           → Shared (packages/shared)
 *
 * 门户层必须通过 HTTP 调用 BFF，禁止任何直接包引用。
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    // ── 门户层（Presentation）不可直接引用后端包 ──────────────────────
    {
      name: 'no-portal-to-backend',
      comment:
        '门户层（portals / business）禁止直接引用 core / service / bff 包，只能通过 HTTP 调用 BFF',
      severity: 'error',
      from: { path: '^(portals|business)/' },
      to: {
        path: '^(packages/core|services|bff)/',
      },
    },

    // ── Service 层不可向上引用 ────────────────────────────────────────
    {
      name: 'no-service-to-upper',
      comment: 'Service 层禁止引用 BFF / 门户层',
      severity: 'error',
      from: { path: '^services/' },
      to: { path: '^(bff|portals|business)/' },
    },


    // ── Core 层不可向上引用 ───────────────────────────────────────────
    {
      name: 'no-core-to-upper',
      comment: 'Core 层禁止引用 service / bff / portal',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^(services|bff|portals|business)/' },
    },

    // ── Shared 层不可引用任何业务包 ───────────────────────────────────
    {
      name: 'no-shared-to-upper',
      comment: 'Shared 层禁止引用任何业务包（含 core），必须保持零依赖',
      severity: 'error',
      from: { path: '^packages/shared/' },
      to: {
        path: '^(packages/core|services|bff|portals|business)/',
      },
    },

    // 设计三包的依赖方向规则（tokens ← ui ← system）已随拆仓迁出（2026-08-21）：
    // 三包现在住 vxture/vxture-design，本仓从 registry 消费，这里没有它们的源码可扫。
    // 那两条规则在 design 仓仍然有效，由那边的 dependency-cruiser 执行。

    // ── Design System / Platform 不可引用业务层 ───────────────────────
    {
      name: 'no-infra-package-to-business',
      comment: 'Design System 和 Platform 工具包禁止引用业务层（service / bff / portal）',
      severity: 'error',
      from: { path: '^packages/(design|platform)/' },
      to: { path: '^(services|bff|portals|business)/' },
    },
  ],

  options: {
    /* 不跟进 node_modules 内部 */
    doNotFollow: {
      path: 'node_modules',
    },

    /* 排除构建产物和类型声明文件 */
    exclude: {
      path: '(node_modules|[\\/]dist[\\/]|\\.d\\.ts$)',
    },

    /* TypeScript 路径别名解析 */
    tsConfig: {
      fileName: 'tsconfig.json',
    },

    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },

    /* pnpm workspace 符号链接穿透 */
    combinedDependencies: false,

    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
