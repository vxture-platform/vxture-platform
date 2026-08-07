# 门户认证链路 + DS 接入 整改计划

**起点**：2026-08-04 会话。最后一个 commit `100d7a1b`，此后 200 个文件未提交。

判据：每项都有可机检的验收；非绿即未完成。

---

## 批 0 · 落袋（阻塞其余全部）

| #   | 任务                      | 验收                                             |
| --- | ------------------------- | ------------------------------------------------ |
| 0.1 | 按主题拆提交现有 200 文件 | `git status` 干净；每个 commit 单独过 type-check |

拆分建议（六个主题，各自独立可回滚）：DS 档名对齐+新件（ActionButton/ViewModeSwitch/ShellBootScreen） · admin 外壳 DS 化 · admin 对齐 DS taxonomy（230→0） · 认证链路（middleware+presence+SDK 前身） · dev-panel 重构 · seed-demo。

**为什么排第一**：200 个文件里同时压着 DS 破坏性改名、admin 全量迁移、认证流程重写三件事。任何一件出问题，现在都无法单独回滚。

---

## 批 1 · 认证链路（有回归疑点，最高优先）

| #   | 任务                         | 验收                                              |
| --- | ---------------------------- | ------------------------------------------------- |
| 1.1 | 排查 presence 5 分钟掉线     | 登录态下停留 >10 分钟刷新仍在系统内               |
| 1.2 | RP 会话 cookie 按应用命名    | 登过 console 后访问 admin，不被误判 Authenticated |
| 1.3 | 抽 Identity SDK + admin 回接 | ✅ 三态五种输入实测与改造前逐项一致               |
| 1.4 | console + website 接入       | ✅ 两侧三态实测；`/signin` 中转已从链路上摘掉     |
| 1.5 | opera 接入                   | ✅ 零 `isExempt`/零 `onAllow`，未开任何逃生口     |

**1.1 是回归嫌疑，不是既有缺陷。** 系统里没有任何 5 分钟会话时效（RP 会话 30 天 / opera 12 小时，access token 900s 提前 60s 刷新）。浏览器链路上唯一 5 分钟的东西是 `vx_admin_sso_presence`。可能的机制：RP 会话缺失但 IdP 中央会话仍在时，presence 让本可成功的静默 SSO 被跳过。**先证实再改**。

**1.2 是本地专有陷阱。** 四个 BFF 共用 `vx_rp_session`（生产 `__Host-` 前缀 + 各自 host，不串）。本地四门户同在 `localhost`，cookie 无视端口 → middleware 的"cookie 在不在"判定会被别的门户的会话骗过。BFF 侧安全（会话存储按应用分 keyspace，查不到即 401），所以是体验问题不是安全问题。

**1.3 落地形态**（2026-08-05）：`@vxture/core-identity-sdk`，双入口——`.` 给 BFF（presence cookie 描述 / `resolveLoginPrompt` / `silentFailureReturnTo`），`./edge` 给门户 middleware（`createAuthMiddleware` / 三态判定 / cookie 名契约）。分入口是硬约束：Edge runtime 拖进 node 内建会在**构建期**炸且错误指不到引入点；实测 `dist/edge.mjs` 只引 `next/server`。

cookie 名契约从 `@vxture/core-oidc-rp` **移入** SDK，oidc-rp 改 re-export——middleware import 不了 oidc-rp（ioredis），原先在 middleware 里手抄了一份，现在只剩一处定义。

不进 SDK = 登录后去哪页、realm 选择、加载页外观（归 DS）、各门户豁免路径。`createAuthMiddleware` 留 `onAuthenticated`/`onUnauthenticated` 两个口子：console/website 认证后要接 next-intl，且跳的是自己的 `/{locale}/signin`——**接 SDK 与改登录页拓扑是两件事**，混做会让回归不可归因。

admin 回接后 middleware 只剩 `app` + `isExempt` 两行门户自有知识（113 行 → 12 行）。

**1.4 落地**（2026-08-05）：console 与 admin 同构；website 是公开站点，`isExempt` 取反（只保护 `/dashboard`）——这是 SDK 通用性的检验点，它表达得了就不必开特例。两侧都把 `/signin` 从认证链路上摘掉：那是个纯跳板页（渲染"正在跳转到登录…"→ 水合 → `location.assign` 去同一个 `/auth/login`），一次完整页面加载换零信息量，与 admin 已拆的 `/login` 同类。页面文件保留（可能有外链）并仍在豁免名单里。console-bff / website-bff 各补四处 presence 接线（静默决策 / 失败标记 / 建会话清 / 登出清）。

**1.5 落地**（2026-08-05）：opera 是四个门户里配置最短的一个——`createAuthMiddleware({ app: "opera" })`，没有 `isExempt` 也没有 `onAllow`。它生产上有 nginx `auth_request` 网关（打 opera-bff `/auth/check`，204 放行 / 401 转登录），未认证请求到不了 Next，所以这道闸在**生产恒真**；吃这一层的是开发环境（无边缘网关，此前正是"渲染→水合→401→replace"的老路）。**没有为这个拓扑差异开逃生口**——"生产上另有网关"不构成放宽契约的理由。

**遗留（非本次引入）**：nginx 网关 401 时直接转交互登录，因此 **opera 生产拿不到静默 SSO**，presence 三态只有 Authenticated 一态是活的。要享受静默 SSO 需改 nginx 那条 401 分支带 `prompt=none`，待 owner 定夺。

**踩到并已修**：豁免路径原先直接 `NextResponse.next()`，绕过了 `onAllow`，于是 website 的 `/` 不再经 next-intl 补 locale 而静静 404，**没有任何一处报错指向 middleware**。豁免 = 不参与认证决策，≠ 不参与后续处理。已改为 `isDefaultExempt`（静态资源）才短路，门户自声明的豁免仍走 `onAllow`；钩子随之更名 `onAuthenticated` → `onAllow`，并加 `next-middleware.spec.ts` 锁住。

---

## 批 2 · 刷新体验（与批 1 正交，可并行）

三个门户刷新表现各异，**没有哪个更好，各对一半**：

|               | 现象                       | 根因                                                              | 判定         |
| ------------- | -------------------------- | ----------------------------------------------------------------- | ------------ |
| opera         | 整页白屏再加载             | 背景色等 React 把 `bg-background` 挂上 `.app` 才铺                | 最差         |
| console       | header 不刷新（avatar 会） | header 在初始 HTML 里即最终态                                     | **正确方向** |
| console/admin | 导航先展开再收起           | `useState(false)` + `useEffect` 读 localStorage，首帧必然是默认值 | 次差         |
| opera         | 收缩态不闪                 | 无"先默认后纠正"的时序                                            | **正确方向** |

| #   | 任务                          | 验收                                  |
| --- | ----------------------------- | ------------------------------------- |
| 2.1 | 背景色由 CSS 铺               | 刷新无白屏（暗色模式下尤其可见）      |
| 2.2 | UI 偏好 localStorage → cookie | 收起态刷新首帧即收起，无展开→收起跳变 |

原则与批 1 同源：**凡是首帧需要知道的东西，都不能等 JS**。2.2 选 cookie 而非 inline blocking script，因为 middleware 已经在读 cookie，且脚本会阻塞首绘。

---

## 批 3 · admin DS 接入续

| #   | 任务                             | 验收                               |
| --- | -------------------------------- | ---------------------------------- |
| 3.1 | admin CSS 结构盘点 → owner 挑选  | 产出清单；owner 勾选哪些进 DS      |
| 3.2 | 批 B：列表页迁 DS 骨架（~12 页） | 页面功能等价；`lint:design` 不退化 |
| 3.3 | 批 C：详情/仪表盘迁 DS           | 同上                               |
| 3.4 | admin 登录态视觉走查             | header/侧栏/面板/列表页逐项确认    |

**3.1 是 3.2/3.3 的前置，不能跳。** owner 明确要求：admin 的 style **不删**，里面有好结构（多组合内容的 card 等）应吸收进 DS。所以顺序是「先盘点 → owner 挑 → 挑中的成组件 → 再迁页面」，而不是「先迁页面顺手删 CSS」。

---

## 批 4 · 零散

| #   | 任务                               | 验收                                          |
| --- | ---------------------------------- | --------------------------------------------- |
| 4.1 | website 3 个既有类型错误           | `pnpm --filter @vxture/website type-check` 绿 |
| 4.2 | 核查 CI 里 DS 导出守卫与构建的顺序 | 守卫能看到当次构建产物                        |

**4.2 的由来**：导出守卫读的是 `dist`，不是源码。本会话实测——没重建 design-system 时它报"0 违规"，新导出根本没进它视野；重建后立刻抓到。若 CI 里构建步骤排在守卫之后，这道门是空的。

---

## 已完成（本会话，未提交）

- DS：档名与 token 名对齐（xs24/sm28/md32/lg36/xl40）；收回 `ActionButton` / `ViewModeSwitch`；`ActionMenu` 补 `disabled`/`hint`；新增 `ShellBootScreen`
- admin：外壳 DS 化（header/sidebar/AppShell）；对齐 DS taxonomy 重构，类型错误 **230 → 0**，build 通过
- admin-bff：全局搜索端点（库侧 ILIKE，按能力码逐源放行）
- 认证：middleware 三态机；presence 缓存；去 `/login` 中转；冷启动 9 跳 3 绘制 → **7 跳 0 绘制**，Anonymous 4 跳
- dev-panel：12 → 16 服务（补 accounts/opera/opera-bff/platform-api）；三份 id 清单合一；外部占用可见化；`RP_COOKIE_INSECURE` 注入
- seed-demo：4 租户覆盖状态矩阵，幂等（三次连跑行数不变）
