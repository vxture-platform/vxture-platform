# 服务监控（opera · ops/service-monitor）规格

> 上游：[`../../../10-standards/025-service-health-endpoint-contract.md`](../../../10-standards/025-service-health-endpoint-contract.md) §2（两类端点 + 路径约定）。
> 实现：`portals/opera/src/app/(shell)/ops/health/page.tsx` + `bff/opera-bff/src/routers/product-health.router.ts`。
> （2026-08-14 目录重构：路径由 `ops/service-monitor` 改为 `ops/health`，与导航名「服务状态」对齐。）
> 建档缘由（2026-08-12）：本页的**探测范围与呈现形态**由 owner 2026-08-11 口头拍板，此前**只写在上述两个源文件的注释里、docs/ 全目录 0 处**。口径本身有效，但只存在于它自己所授权的那段代码里就无法被独立核验——本文给它一个可引用的落点。同批处理的另一例（管理模块归属）见 [`../../../30-design/product_250_management-plane-contract.md`](../../../30-design/product_250_management-plane-contract.md) v0.2 头部修订。

---

## 1. 这不是 admin 那个「服务监控」

同一个入口位，**不同功能**。admin 那份探的是本地 dev-panel（`:8090`），从未连过生产——admin 自己的技术债登记（TD-036 / `../admin/20-admin-platform-refinement-plan.md` P4「Q6 维持 dev-only」）承认这一点；此前两次迁移都刻意跳过它（`49d60f2` 原话："moving it would relocate emptiness"）。

2026-08-11 迁入 opera 时**换了数据源和语义**：探的不是平台自己的门户/BFF，是**接入平台的产品线**。

## 2. 探测范围（owner 口径 2026-08-11）

- **对象 = 接入平台的产品线**，每个产品的 **prod 与 beta 两个渠道**分别探。
- **不探平台自身**的门户/BFF（那是 dev-panel 的职责，不在本页范围）。

### 数据源：单一权威，不另起清单

`appoidc.oidc_clients LEFT JOIN product.products`——origin 就是各产品登记的 OIDC 回调地址去掉路径，与 seed 侧同一份数据（`deploy/database/seed/seed-catalog.mjs` 的 `appUris()`）。

**LEFT JOIN 而非 INNER JOIN**：ontos / raven / anlan / forge / xuanzhen 五个产品已注册 OIDC 客户端，但 `product.products` 还没有目录行（产品定义待建，见 `product_100_matrix.md`），INNER JOIN 会把这五个直接丢掉。缺目录行时用客户端自己的 name/display_name 顶上，分组键退化为「product_id 或裸 client_id 去 `-beta` 后缀」。

### 两种 prod/beta 建模并存（seed 历史遗留，两种都要认）

| 形态                        | 产品                                                             | 建模                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 单 client + 多 redirect_uri | runos / atlas / ontos / raven / anlan / forge / xuanzhen / ruyin | 同一 `client_id`，`redirect_uris = [prod 回调, beta 回调?]`（`appUris()` 固定序，prod 在前；beta 未配置时数组长度为 1） |
| 双 client                   | arda / karda                                                     | 两个独立 `client_id`（如 `arda` / `arda-beta`），后者 `release_channel='beta'`                                          |

## 3. 探什么端点

**两类端点的划分与路径约定归 `025` 标准 §2**（本页不另立规矩）：

| 类                | 语义                                 | Next.js 前端      | NestJS 后端    |
| ----------------- | ------------------------------------ | ----------------- | -------------- |
| liveness          | 进程在听，不代表能对外服务           | `GET /api/health` | `GET /healthz` |
| readiness（可选） | 关键依赖是否就绪，返回 `checks` 明细 | `GET /api/ready`  | `GET /readyz`  |

owner 口径「health、status」指的就是这两类，对应 UI 上的**存活 / 就绪**两列——不是要求产品必须用 `/status` 这个路径名（真实探测走的是上表 025 路径）。

**探测策略**：每类端点两种运行时路径约定并发探，先拿到的非 404 响应视为命中；两条都 404 → liveness 记「异常」（它不是可选项）、readiness 记「未实现」；两条都连不上 → 「不可达」。

**已知现状（诚实标注，非缺陷）**：readiness 在 `025` 里是可选项，全仓目前**零产品真正接上**，所以「就绪」列大概率显示「未实现」。

## 4. 呈现形态（owner 口径 2026-08-11）

- **一个产品一行，标题只出一次**。每个信息列内部拆成 prod（上，主）/ beta（下，辅）两条紧凑子行，中间虚线分隔——复用 `DataTable` 已在用的 hairline 虚线令牌，不新发明分隔线。总行高贴着单行走，不因两个渠道变成两倍高。
- **渠道标注只出现一次**：prod/beta 文字只在专门的「渠道」列（紧跟「产品」列）出现，不在其余列重复。
- **主辅对比靠字重与色阶**：prod 是主读数（`font-semibold` + 前景色），beta 是辅助参照（常规字重 + `text-muted-foreground`）。**字号全列统一**，不靠放大区分（2026-08-12 修正：此前 prod 用了大一档字号，与全站字号体系不一致）。
- **`not_configured` 是正常态**：beta 未注册不是异常，显式区分，不与「不可达」混在一起。
- **刷新节奏 30s**（owner 口径：不用太频繁），另留手动刷新按钮。

## 5. 边界

- 只读页面，**无能力门**（不涉及任何写操作，也不暴露密钥/配置）。
- **零持久化**：每次请求现探，不落库、不缓存趋势。趋势/告警不在本页范围。
- 骨架与 opera 既有页面同构（`ListPageTemplate` 三槽 + `FilterBar` + `DataTable` + `useListPagination`），不带 admin 遗留的 `vx-*` 产品 CSS 类。
