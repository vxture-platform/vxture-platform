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

    // ── 设计三包的依赖方向：tokens ← ui ← system ─────────────────────
    // 单向，且不得成环。ui 一旦 import system 就把 React context（主题 / 密度）
    // 拖进无状态组件层，伞包也就无法再独立于组件层演进——拆包的意义随之消失。
    {
      name: 'no-design-ui-to-system',
      comment: '@vxture/design-ui 禁止引用 @vxture/design-system（方向只能反过来）',
      severity: 'error',
      from: { path: '^packages/design/design-ui/' },
      to: { path: '^packages/design/design-system/' },
    },
    {
      name: 'no-design-tokens-to-upper',
      comment: '@vxture/design-tokens 是零依赖叶子，禁止引用 ui 与 system',
      severity: 'error',
      from: { path: '^packages/design/design-tokens/' },
      to: { path: '^packages/design/design-(ui|system)/' },
    },

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
