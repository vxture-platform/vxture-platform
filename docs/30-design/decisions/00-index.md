# 架构决策记录（ADR）

> 记录重大技术决策的背景、选项、决策结果和后果。
> ADR 一旦 Accepted 不再修改，只能被新 ADR Supersede。
> 格式参照 [Nygard Lightweight ADR](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)。

---

## 决策列表

| 编号                                                | 标题                                                         | 状态        | 日期       |
| --------------------------------------------------- | ------------------------------------------------------------ | ----------- | ---------- |
| [ADR-001](./ADR-001-auth-bff-sole-jwt-issuer.md)    | auth-bff 作为唯一 JWT 签发者                                 | ✅ Accepted | 2026-03-01 |
| [ADR-002](./ADR-002-bcp47-locale-format.md)         | 全链路使用完整 BCP47 语言标签                                | ✅ Accepted | 2026-03-16 |
| [ADR-003](./ADR-003-pnpm-workspaces-monorepo.md)    | 采用 pnpm workspaces monorepo                                | ✅ Accepted | 2026-02-01 |
| [ADR-004](./ADR-004-nestjs-for-bff.md)              | BFF 层使用 NestJS 框架                                       | ✅ Accepted | 2026-02-01 |
| [ADR-005](./ADR-005-plg-tenant-model.md)            | PLG 自动租户模型                                             | ✅ Accepted | 2026-03-01 |
| [ADR-012](./ADR-012-sharing-grant-design.md)        | 共享授权模型 · 产品分层定名 · P 级资产供给                   | ✅ Accepted | 2026-07-06 |
| [ADR-013](./ADR-013-raw-token-ingest-per-caller.md) | 原始 token 用量按调用方产品接收 · 平台换算 credit · 小数结转 | ✅ Accepted | 2026-10-04 |

---

## 如何新增 ADR

1. 复制 `docs/30-design/decisions/000-template.md`，按序号命名
2. 填写背景、选项、决策、后果
3. 状态初始为 `Proposed`，团队评审后改为 `Accepted`
4. 在本索引表添加一行
5. 旧决策被取代时，在原文件顶部标注 `Superseded by ADR-XXX`，状态改为 `Deprecated`

---

## ADR 状态说明

| 状态       | 含义                                    |
| ---------- | --------------------------------------- |
| Proposed   | 草案，待评审                            |
| Accepted   | 已采用，是当前有效决策                  |
| Deprecated | 已废弃（被新 ADR supersede 或条件消失） |
| Superseded | 被特定 ADR 替代                         |
