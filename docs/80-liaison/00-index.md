# 80-liaison

跨组织对接联络。**2026-07-27 起，新联络改用 GitHub Issues（`liaison` 标签），本目录停止新增
`NN-YYMMDDHHmm-slug.md` 文件**——原因与约定见
[`140-repo-governance-standard.md`](../10-standards/140-repo-governance-standard.md) §10。
既有信件文件保留作历史归档（本目录下同级文件），不追溯迁移、不删除。

下表是当前活跃的跨仓 issue 快照（人工维护，非自动同步——**状态以对应仓库里的 issue 实际状态为准**，
本表只供一眼概览）。**上次逐仓实读：2026-08-13。**

## 活跃 issue 追踪

**只列 OPEN**（2026-08-13 逐仓实读重建）。此前这张表把 Closed 行也留着，结果两件事同时发生：
状态格陆续过期（本次实读发现 **9 处**已关却仍标 Open：atlas `#36`/`#37`/`#39`/`#52`/`#66`/`#143`/`#144`/`#145`、
本仓 `#159`/`#164`/`#205`/`#220`、karda `#72`），而 **23 个新开的 issue 一个都没登记**。

> **维护规则（本次立）**：**关一个删一行**。关闭记录不进本表——issue 自己、PR、git 历史都留着，
> 在这里再抄一份只会变成第二个会过期的真相。本表唯一职责 = 「现在还欠着什么」。

### 本仓收到的（外部 → vxture-platform，16 个）

| Issue  | 来自  | 内容概要                                                                                                                                |
| ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `#188` | 自查  | 安全：标准点名第三方 action 供应链风险，却把生产 SSH 私钥交给可变 tag（钉 SHA 已办 PR#222；**换掉 appleboy 未办**——要重写活的部署路径） |
| `#226` | arda  | RFC 8693 token exchange（arda external-API step 3，最后一项）——**平台侧无需开发**，等 arda 实测换票后关闭                               |
| `#244` | runos | 3 项未确认事项（webhook / live entitlement / port registry），自 `#205` 拆出                                                            |
| `#245` | atlas | provider health + gateway performance API 已交付（`atlas#145` 的接口契约）                                                              |
| `#246` | atlas | 逻辑 Endpoint 目录 API 已交付（`atlas#143` 的接口契约）                                                                                 |
| `#247` | atlas | 网关 API Key 管理 API 已交付（`atlas#144` 的接口契约）                                                                                  |
| `#248` | runos | opera 现可注册 Skill 能力并跑 certified 审核清单（ADR-009）                                                                             |
| `#249` | runos | `/commerce/grants` = opera+admin 合并后的权益写入口（230/280，M2）                                                                      |
| `#250` | runos | `/governance/credentials` 提供 account-scoped 连接器凭证托管（250，M2）                                                                 |
| `#251` | atlas | `/capability/usage-summaries` 从永久空桩改为真数据，**形状变了**                                                                        |
| `#252` | —     | opera 无 step-up 登录流程，挡住全部 provider-key / gateway-api-key 写入                                                                 |
| `#253` | runos | 管理 API 变更：critical 风险操作现可注册，opera Capability/Grant 页需相应处理                                                           |
| `#254` | atlas | 操作码词表已交付，请注册进 operator RBAC 目录并标注 step-up（`product_250` M-2）                                                        |
| `#255` | atlas | Cost 计算归属已定为 platform-opera —— Atlas 侧两个因子均已就绪                                                                          |
| `#256` | atlas | operator token 签发契约两问：scope/realm/userType 绑定保证 + `mode` 的处置                                                              |
| `#257` | atlas | `atlas#159` 的 §1/§4/§5/§6 已实现（计量四维、Endpoint 可观测、Provider 探测、审计读端点）                                               |

### 本仓开给外部的（8 个）

> **2026-08-16 一次性开出 10 个**：`product_251` 三方一致性规范的上游条款，owner 全部授权。
> **逐条开、不打包**——规范自己的纪律是「逐条签署，不是全有全无」，打成一个 issue 就没法只签一半。
> platform 已先把自己那一列做完（见 `docs/70-workplan/30-l1-consistency-audit.md` §C6），
> 这 10 条是在那之后发的：**先自证，再提要求。**
>
> **2026-08-17 结果：8 条已关，2 条留作决策/记账位。** 上游不只是照做——他们**纠正了我们两处
> 判断**（atlas 封套基准、`outcome` 归属），**反提了三处**（不加版本列、`product-endpoint-grants`、
> `costUnit` 开放词表），都已采纳并改进规范 v0.4。runos 更进一步：不等三方定名就改了，
> 论证拆掉了我们「需协调」的前提——**那条纪律是我们写宽的**。
> 回冲代价：runos 硬切路由无并存期，opera 断了一天（已适配，见审查文档 §C7）。

| Issue                                                            | 内容概要                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`atlas#205`](https://github.com/vxture/vxture-atlas/issues/205) | X-4 模型无版本与弃用信号——**已确认为债并记账，不承诺排期**。反提案「不加版本列，`modelCode` 即版本标识」已接受；本条作记账位保持开启               |
| [`atlas#206`](https://github.com/vxture/vxture-atlas/issues/206) | X-4 路由改名——名字已定（`product-endpoint-grants` / `tenant-model-grants` / `model-routes`）。**等 atlas 部署后 opera 切 `PUT`→`PATCH`，严格顺序** |
| [`atlas#38`](https://github.com/vxture/vxture-atlas/issues/38)   | 实现 A2 `POST /v1/parse`（A1/A3 已交付并关闭，本条是 A 系列最后一个）                                                                              |
| [`atlas#131`](https://github.com/vxture/vxture-atlas/issues/131) | grants 上缺 `taskProfile` 字段（自本仓 `#148` 承接；provider-keys 那半 2026-08-12 已解决）                                                         |
| [`atlas#159`](https://github.com/vxture/vxture-atlas/issues/159) | Atlas 1.0 范围逐条验收 —— 6 项要求 + 路由机制澄清                                                                                                  |
| [`atlas#165`](https://github.com/vxture/vxture-atlas/issues/165) | step-up 的判据与执行位归 platform/console —— 请撤 `StepUpRequiredGuard` + 注册操作级词表                                                           |
| [`runos#65`](https://github.com/vxture/vxture-runos/issues/65)   | opera 管理面接入回报 —— 4 项接口问题 + 本仓 `#252` 前提更正                                                                                        |
| [`runos#67`](https://github.com/vxture/vxture-runos/issues/67)   | step-up 不必对齐 atlas —— 判据归 platform 目录、执行归 console                                                                                     |

### 不涉本仓（登记备查）

| Issue                                                          | 内容概要                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`arda#211`](https://github.com/vxture/vxture-arda/issues/211) | runos→arda：首个真实 Connector 注册 —— 凭证路径 + 一把测试 API key |

vxture-karda 当前 **0 个 open**。

## 历史归档（既有信件文件，本目录同级，不再新增同类文件）

> **2026-07-27 记录**（所述 5 个 issue 均已关闭，按「关一个删一行」不再进上表，注解移存于此）：atlas 侧 5 个 issue（#34/#35/#41/#42/#43）在开出后数十分钟内即被关闭——
> 核实并非误报或异常，是 atlas 仓另一并行会话已提前于 `254092f` 提交完成（capability discovery、
> 租户过滤模型清单、taskProfile 路由、A2.3 结论、karda 回函 `vxture-karda#70`），双方时间线有重叠，
> 关闭时机早于本表更新纯属巧合，已逐条核实（commit 存在、karda#70 存在且内容吻合）。

`10`–`80` 号为 2026-07-22～27 期间的信件往来，保留原状，仅供追溯，不代表当前进行中的对接状态
——当前状态以上表 Issues 为准。

| 文件      | 内容                                                                    | 平台侧结案状态（2026-08-13 核实）                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `10`–`40` | taxonomy 修订回函 / karda 注册 A 段回函 + 完成确认                      | 历史，无遗留                                                                                                                                                                                                                               |
| `50`      | karda 注册段 C 回复（webhook 登记 / 计量 key / repo secret / 五档依赖） | **无遗留**——§1/§2 已由 `70` 函确认生产生效，代码态与运行态本次已复核                                                                                                                                                                       |
| `60`      | karda A4 端点请求回复（转达 Atlas 状态）                                | **两条跟进项均已完成但未回填**：token-exchange 签发端点**已实现在产**（本函当时的"还没实现"前提已作废）、Atlas 行主机已确认 worker-02。遗留：①是否补一封回函告知 karda（外发，待 owner）②Atlas 行 `stack_root` / beta 域名两格仍「待分配」 |
| `70`      | karda 注册段 C 生产生效通知                                             | **无遗留**——唯一开放项（测试投递触发方式）挂在 karda 回复上，两周余无跟进，可作自然失效                                                                                                                                                    |
| `80`      | karda 注册 C 段 C3 关闭                                                 | 历史，无遗留                                                                                                                                                                                                                               |

> **一个教训值得记在这里**：`60` 函那两条「平台线跟进」在完成后**没有人回填**，导致这封信在归档
> 目录里以一份**过期前提**的形态挂了两周多——它告诉 karda「你现在拿不到能通过验签的 token」，
> 而实际上早就拿得到了。归档不等于免于维护：**信里写下的待办项，完成后要回到信里销号**，
> 否则下一个读它的人会照着作废结论行事。
