# 服务监控（opera · ops/service-monitor）规格

> 上游：[`../../../10-standards/025-service-health-endpoint-contract.md`](../../../10-standards/025-service-health-endpoint-contract.md) §2（两类端点 + 路径约定）。
> 实现：`portals/opera/src/app/(shell)/ops/health/page.tsx` + `bff/opera-bff/src/routers/product-health.router.ts`。
> （2026-08-14 目录重构：路径由 `ops/service-monitor` 改为 `ops/health`，与导航名「服务状态」对齐。）
> 建档缘由（2026-08-12）：本页的**探测范围与呈现形态**由 owner 2026-08-11 口头拍板，此前**只写在上述两个源文件的注释里、docs/ 全目录 0 处**。口径本身有效，但只存在于它自己所授权的那段代码里就无法被独立核验——本文给它一个可引用的落点。同批处理的另一例（管理模块归属）见 [`../../../30-design/product_250_management-plane-contract.md`](../../../30-design/product_250_management-plane-contract.md) v0.2 头部修订。

---

## 1. 这不是 admin 那个「服务监控」

同一个入口位，**不同功能**。admin 那份探的是本地 dev-panel（`:8090`），从未连过生产——admin 自己的技术债登记（TD-036 / `../admin/20-admin-platform-refinement-plan.md` P4「Q6 维持 dev-only」）承认这一点；此前两次迁移都刻意跳过它（`49d60f2` 原话："moving it would relocate emptiness"）。

2026-08-11 迁入 opera 时**换了数据源和语义**：探的不是平台自己的门户/BFF，是**接入平台的产品线**。

## 2. 探测范围（owner 口径 2026-08-11；数据源口径 2026-08-30 改）

- **对象 = 产品目录里的每一个产品**，按 **stable / beta / canary 三个渠道**分别探。
- **不探平台自身**的门户/BFF（那是 dev-panel 的职责，不在本页范围）。

### 数据源：产品目录是主表，客户端表只回答「怎么探」

> 2026-08-30 改口径，依据 [`40-product-registry.md`](./40-product-registry.md) §4。此前主表是 `appoidc.oidc_clients` LEFT JOIN 产品表，外加一份硬编码豁免名单和一张按产品码猜层级的表，结果本页与「产品目录」是两份清单（目录 21 个、本页 12 个，其中 5 个目录里不存在）。根因是把「谁是产品」交给了客户端表回答。

`product.products`（`deleted_at IS NULL`，**全部状态**）LEFT JOIN 它名下 `client_kind='product'` 且 `status='active'` 的 `appoidc.oidc_clients`，按 `release_channel` 分到三个渠道：

- **清单 = 目录**：目录里有的产品本页一定有。没有任何客户端的产品显示 **未接入**（`onboarded=false`），并带产品状态（草稿/已上线/已停用/已退役）——"目录里有、监控里没有"正是运营者要看见的事实。
- **origin** = 该渠道客户端 `redirect_uris[0]` 去掉路径；要换探测目标去改那个客户端的回调地址。
- **层级**只由 `product.products.product_type` 判定（`product_100_matrix.md` §2：model/capability→L1，data/knowledge→L2，agent→L3，client，external）；没有按产品码的回退表，类型没填对就如实显示「未分类」。
- **渠道的唯一口径是 `release_channel`**。"stable 客户端的第二个 `redirect_uri` = beta"这条 seed 期的派生路径已退役：回调白名单里多一个地址，不等于登记了一个渠道。同一渠道登记了多个活跃客户端时，探最早登记的那个。

### 空平台起步时本页的样子

新部署、目录为空 → 本页为空，提示先去「产品管理 · 产品目录」登记。登记一个草稿产品 → 本页出现一行「未接入」。在「接入凭据」为它签发 stable 客户端 → 主行开始探测。签发 `release_channel='beta'` 的客户端 → beta 子行开始探测。全程没有任何一步需要改本页或 BFF 的代码。

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
- **「未接入」是另一个正常态**（2026-08-30）：产品在目录里但没有任何客户端。它与「未配置」（有产品客户端、只是这个渠道没登记）是两件事，各用各的词；两者都不计入「需要关注」。
- **「不适用」是第三个正常态**（2026-08-31）：`product_type='client'` 的产品（桌面 / 原生客户端，如 ruyin）登记了渠道，但它的回调是 RFC 8252 loopback（`http://127.0.0.1/...`），没有服务面可探——按 origin 探下去探到的是 opera-bff 自己的容器，永远「不可达」。这类渠道**不发探测**，存活 / 就绪两列都标「不适用」，渠道本身照样列出；未登记的渠道仍是「未配置」。三个中性态都不计入「需要关注」。
- **刷新节奏 30s**（owner 口径：不用太频繁），另留手动刷新按钮。

## 5. 边界

- 只读页面，**无能力门**（不涉及任何写操作，也不暴露密钥/配置）。
- **零持久化**：每次请求现探，不落库、不缓存趋势。趋势/告警不在本页范围。
- 骨架与 opera 既有页面同构（`ListPageTemplate` 三槽 + `FilterBar` + `DataTable` + `useListPagination`），不带 admin 遗留的 `vx-*` 产品 CSS 类。
