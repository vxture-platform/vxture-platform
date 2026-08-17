# @vxture/website

> ⚠️ 待大版本重构 | 迁移自 `portals/website/AGENTS.md`
> 架构层参考：[`docs/30-design/architecture/00-index.md`](../../../30-design/architecture/00-index.md)

---

## 包信息

| 项     | 值                                       |
| ------ | ---------------------------------------- |
| 包名   | `@vxture/website`                        |
| 路径   | `portals/website/`                       |
| @layer | `Presentation`                           |
| 框架   | Next.js 15.5.6（App Router + Turbopack） |

| 版本 | 2.0.0（2026-05-06） |

## 依赖约束

```typescript
✅ @vxture/design-system（组件、theme、tokens、icons）
✅ @vxture/shared（基础工具、Locale 类型/常量）
✅ @vxture/core-locale（i18n 格式化工具，唯一允许的 core 包）
✅ BFF（HTTP only，禁止包引用）
❌ @vxture/service-* / core-api / core-auth / core-config / core-tenant / core-utils
❌ @vxture/model-runtime-client / agent-server/*
```

## 核心路由结构

```
[locale]/
  (public)/layout.tsx        ← Header + Footer 唯一实例
  (marketing)/               ← 营销页
  (content)/                 ← Content Registry（通配路由）
  (auth)/                    ← 认证页（无 Header/Footer）
```

## Content Registry 系统

通过 `(content)/[...slug]/page.tsx` 统一接管所有内容类页面（legal / blog / faq 等）。

```typescript
CONTENT_REGISTRY = {
  legal: { loader: legalLoader, staticParams: legalStaticParams },
  blog: { loader: blogLoader, staticParams: blogStaticParams },
  faq: { loader: createStubLoader("faq") },
};
```

扩展三步：`types.ts` 追加 key → 实现 Loader → `registry.ts` 注册。

## 目录结构

```
src/
├── app/              # Next.js App Router 页面
├── components/
│   ├── layout/       # Header / Footer / Sidebar
│   ├── marketing/    # 营销页区块
│   ├── cases/        # 案例库
│   ├── auth/         # 认证页
│   └── ui/           # 应用级 UI 扩展
├── hooks/
├── stores/           # Zustand（只存 UI 状态，不存 token）
├── api/              # BFF 接口调用层（axios）
├── data/             # 结构数据（只含 href / 图片路径 / i18n key）
├── lib/
│   ├── i18n/         # next-intl 配置
│   └── content/      # Content Registry
├── constants/
├── types/
└── middleware.ts     # 认证重定向 → intl → x-pathname
```

## Middleware 设计

固定三个关注点顺序：

1. 认证重定向（读取 `vx_tenant_refresh_token`，保护 /dashboard）
2. `intlMiddleware`（next-intl 语言前缀路由）
3. `response.headers.set('x-pathname', ...)`（供 request.ts 按需加载翻译）

## 编写要求

- API 调用统一放在 `api/` 目录，页面组件不直接调用 fetch
- 结构数据与翻译分离（data/ 只含 i18n key，文本在 messages/ 中）
- 组件导出统一通过 `index.ts`
- 组件文件不超过 150 行
- 新增内容页优先使用 Content Registry 机制，不创建静态路由文件
