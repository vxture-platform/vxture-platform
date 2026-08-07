# styles-absorbed —— 已退出构建的样式存档

这里的 CSS **不被任何入口引入**，不参与构建，也不参与选择器匹配。它们是设计意图的
存档，不是源码。

## 为什么留着

owner 的要求：admin 的 style 不删，里面的好结构应吸收进 DS。这些文件记录了那些结构
的取值与边界条件——形状本身已提炼进 DS 组件（`MetricGrid` / `DetailList` /
`MetricListCard` / `Pagination` / `ViewHeader`），但提炼有损，源码仍有参考价值。

同时它们**不能留在构建里**：其中相当一部分声明本就失效（引用了 `8ca6284e` 退役的
`--vx-admin-*` 变量，`var()` 未定义且无 fallback ⇒ 整条声明 invalid），留着只会让后来者
以为样式还在生效，而且仍会参与选择器匹配、埋下撞名的雷。

## 为什么在 `src/` 外

守卫 `ds/no-unreachable-app-style-module` 规定「应用 `src/styles` 下的样式模块必须能从
`app/globals.css` 的 @import 图谱到达」。那条规则的意图正是禁止死代码堆在 `styles/` 下，
所以存档目录放进去是在违反它，而不是绕过它。放在 `src/` 外，规则不必让步。

## 判据

一个文件的**全部**类名在 `portals/admin/src` 的 tsx/ts 里零引用，才移进来。三个坑：

1. **模板拼接** —— `vx-order-pill--${status}` 让 `.vx-order-pill--pending` 没有字面量。
   判定时除字面量外还收集 `前缀${` 的前缀，凡以该前缀开头的类都算在用。
2. **桶文件** —— 只含 `@import` 的容器自身没有选择器，死活取决于叶子，得自底向上算。
3. **引号** —— `@import` 有 `"` 与 `'` 两种写法（admin 里 20 个文件用双引号、10 个用
   单引号）。只匹配一种，会把另一种的桶当成「没有 import 的空叶子」判死，连带它在用
   的叶子一起失去引入路径。这一条是实际踩出来的，守卫的 `no-missing-css-import` 抓到了。

不变量：**桶与其全部叶子同进同出**。宁可判「在用」，不可误判「死」。

## 本批（2026-08-05，22 个文件）

两个整根从 `globals.css` 摘掉，同时从守卫的 `IMPORT_ONLY_STYLE_ENTRIES` 移除：

- `admin-auth-captcha.css`（4 叶）—— admin 登录页早已不渲染自己的凭据表单，它 302 到
  IdP（见 `src/app/login/page.tsx`），验证码组件不存在了。
- `admin-products.css`（5 叶）—— 产品页的卡片 / 价格 / 发布行样式，随组件迁移退场。

其余是各桶下已退役的叶子：`vx-tenant-summary`（→ `MetricGrid`）、
`vx-tenant-pagination__*`（→ DS `Pagination`）、`admin-overview-heading*`
（→ `ViewHeader` / `SectionHeader`）等。

## 要恢复某个文件

移回 `src/styles/`，在对应桶文件里加回 `@import`。若桶本身也在这里，需一并移回，并在
`globals.css` 加回根 import、在守卫的 `IMPORT_ONLY_STYLE_ENTRIES` 补回条目。
