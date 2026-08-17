# 平台侧配套任务计划(支撑 template / arda 按标准重构)

> **背景**:`vxture-template`(产品模板仓)与 `vxture-arda`(参照产品)正照 product_240 + 治理标准重构;平台侧(vxture-platform)有一批**配套义务与缺口**需完善,否则产品仓走不到端到端。
> **来源**:本工作线(2026-07)分析 + §6 未落平台文档项 + 代码级缺口核准(2026-07-20)。
> **排序原则**:是否**卡住 template/arda 进度**;Tier 1 优先。
> **执行**:每项一 PR + 机检/测试验收;涉活库/发包/生产写须 owner 逐次授权。

---

## Tier 1 — 卡进度或潜在 live bug(✅ 完成 2026-07-21)

| #    | 任务                                | 为什么(卡谁)                                                                                                                                                                                                                                                                                                | 落点                                          | 状态                                                                                                                                                                           |
| ---- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1-1 | **core-oidc-rp access-claim 对齐**  | 初判"仍读 `active_tenant`=潜在 live bug"**核查后否定**:`claims.ts` 早已(2026-07-15 迁移)读 `active_org`/`active_workspace`/`roles`,console/website 无 bug。降级为 **cosmetic**:两处 spec fixture 仍造已退役的 `active_tenant` 形状,仅因 `mapAccessClaims` 容忍未知字段而绿,误导抄样者 → 对齐真实 claim 形状 | `packages/core/oidc-rp/`(spec fixtures)       | ✅ PR #97(31 specs 绿;**无生产码改动**)                                                                                                                                        |
| T1-2 | **平台"注册一个产品"runbook**       | template 批 3(三通道 + 档位**在线**验证)需平台 seed:目录 product 行 + OIDC client(+beta)+ product_webhooks + webhook secret;现无此 runbook                                                                                                                                                                  | `docs/60-operations/40-register-a-product.md` | ✅ PR #98(7 件清单 + agent 可做 / owner 手动切分 + SQL 验收);**演示产品活库 seeding 属 owner-gated,未代做**                                                                    |
| T1-3 | **@vxture/shared 导出 C2 信封类型** | 信封 v2 类型(ProductEntitlementView/SubscriptionFacts/QuotaPoolView)现只在 `bff/platform-api`,不在 @shared → template/产品 C2 客户端须手抄、漂移风险                                                                                                                                                        | `packages/shared` + `bff/platform-api`(回引)  | ✅ PR #96(@shared 1.4.0→1.5.0,7 类型;platform-api 回引 re-export=零 consumer churn;type-check+build+81 specs 绿);**发包 @shared@1.5.0 到 GitHub Packages 属 owner-gated,待发** |

## Tier 2 — template 批 2 照着写的契约文档(§6 未落平台文档)

| #     | 任务(§6#)                                                                                                                                             | 落点                                                                     | 状态                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| T2-1  | 新产品 S2S 凭证默认 = token exchange(#5)                                                                                                              | product_200 §2.2                                                         | ✅ PR #99                                                                                                                       |
| T2-2  | 门控公式钦定 canonical + 两式等价确认(#6)                                                                                                             | product_220 §3                                                           | ✅ PR #99(§3 早已 pin `tier != null`,本次补等价性确认)                                                                          |
| T2-3  | 信封版本标号统一 v2/v3(#7)                                                                                                                            | product_200 / 220                                                        | ⏸ 平台侧已 v3 一致(免改);arda 系列(product_310/arda_200/300)仍 v2 = 一次标号裁决,涉 arda 契约面 → **arda 线/owner 点定**,不擅改 |
| T2-4  | OIDC 双 client 定正典(#9)                                                                                                                             | product_200 §2.1                                                         | ✅ PR #99                                                                                                                       |
| T2-5  | intent 词表补 subscribe(#12)                                                                                                                          | product_200 §3.2                                                         | ✅ PR #99(**同时解锁 product_320 console + arda 深链容错**)                                                                     |
| T2-6  | webhook 平台侧键名惯例(#13)                                                                                                                           | product_200 §4.3                                                         | ✅ PR #99                                                                                                                       |
| T2-7  | agent-db 口径措辞收窄=SoR 归属(#16)                                                                                                                   | product_100 §2 / product_200 §7                                          | ✅ PR #99(§7 顺修退役 schema 名残留=§6#23)                                                                                      |
| T2-8  | OIDC allowed_scopes 去 `{product_code}`(#20)                                                                                                          | product_200 §2.1                                                         | ✅ PR #99(并闭 arda letter D1/F)                                                                                                |
| T2-9  | **基建分配登记表**(#10,新建:每产品 端口/主机/stack_root/域名/namespace/tailnet)                                                                       | `docs/50-deployment/13-infra-allocation-registry.md`                     | ✅ PR #104(三路事实核验;在产行实值填齐,未分配格标"待 owner 拍板";端口对 32X0/32X1 方案作**建议**待拍板)                         |
| T2-10 | §6 tracker 同步:#1/#2/#3/#4/#8 标 ✅(#85 已改标准、tracker 未标;**#8 的 runbook 实质修订另立 T2-14**)                                                 | product_240 §6                                                           | ✅ PR #100(五行标 ✅,标准侧逐条核对;#8 runbook 部分随 T2-14 齐)                                                                 |
| T2-11 | 平台仓 `.gitattributes` 补 `*.md text eol=lf` 等(liaison F:平台仓待补自证)                                                                            | `.gitattributes`                                                         | ✅ PR #94 已合                                                                                                                  |
| T2-12 | `commerce.*→metering.*` 文档改名残留(§6#23):迁移本已完成,残留=改名说明 note 的 prettier-mangled 表引用(`metering._`/`usage*gauges`),已 backtick 修正  | data_platform_100(§2.2/§8 note)                                          | ✅ PR #100(mangled note 修;deprovision "拆除"措辞判为 provisioning 级正确=行拆后复用、免改,§6#21)                               |
| T2-13 | product_210 §4.2 工具发现端点措辞对齐 tailnet 面(§6#14/#89 裁定):discovery 归 tailnet、S2S 绝不公网,删"按 provider 公网域名直连(arda.vxture.com)"表述 | `product_210` §4.2                                                       | ✅ PR #100(补 tailnet/绝不公网限定 + 边缘 openid-configuration 区分)                                                            |
| T2-14 | 自整顿 runbook 批F/§2 补 `lint:schema-residue`,收口 DB-lint 四→五件口径(§6#8 实质残留)                                                                | `docs/50-deployment/rebuild/20-self-rectify-runbook.md` 批F(:67)/§2(:83) | ✅ PR #100(五件齐,对齐 §0 护栏清单)                                                                                             |

## Tier 3 — L3 agent profile 启用(卡 L3,不卡 L2 template 基座)

| #    | 任务                                                                                         | 落点                           | 状态                          |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------- |
| T3-1 | LLM 通路裁决:发布 `@vxture/model-runtime-client` 供外部仓 **或** 给 Atlas 网关定纯 HTTP 契约 | packages/ai / product_240 §4.2 | 待 owner 裁(agent profile 前) |
| T3-2 | T3:首个 agent→Arda 的 S2S 工具协议消费场景落地                                               | bff/auth-bff + arda            | 待 owner 排期                 |

## Tier 4 — 平台能力缺口 / 安全 tech-debt(reserved,有消费方再做)

| #     | 任务                                                                                                                        | 落点                                                        | 状态                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| T4-1  | 成员 roster 拉取 API + per-member 失效事件(#29,v1 已裁延后)                                                                 | platform-api / commerce                                     | reserved                                                              |
| T4-2  | 成员 display 缓存失效通道(#31)                                                                                              | product_200 §4.2 + platform                                 | reserved                                                              |
| T4-3  | 产品级 metric kind 视图/C2 下发(#30)                                                                                        | product_220 §4 / @shared                                    | reserved                                                              |
| T4-4  | webhook 双 secret 轮换机制(#19)                                                                                             | services/commerce/provisioning                              | reserved                                                              |
| T4-5  | S2S 签发审计(TD-034)                                                                                                        | bff/auth-bff                                                | tech-debt                                                             |
| T4-6  | platform router 自报 product/workspace_id 绑 token(TD-035)                                                                  | bff/platform-api                                            | tech-debt                                                             |
| T4-7  | frozen 冻结态 claim 源 + switch-tenant 服务端查成员(080-rp §2.11 cutover 缺口)                                              | bff/auth-bff                                                | tech-debt                                                             |
| T4-8  | boot-smoke 护栏(#15,若上 NestJS agent-server 形态)                                                                          | 140 §8                                                      | 待判                                                                  |
| T4-9  | order_no 部分唯一索引进 DDL 治理(`WHERE order_no IS NOT NULL`),订单幂等                                                     | `deploy/database/ddl`(98_column_locks / 50_metering)        | reserved(product_320 §8#3/§O2 待办;现仅列锁不可变、无唯一索引)        |
| T4-10 | admin `subscriptions.router` renew/resume 裸 SQL provisioning 旁路 → 登记新 TD                                              | `10-tech-debt.md` + `bff/admin-bff` subscriptions.router.ts | ✅ PR #102(登记 **TD-041**,Architecture/MED;顺补 TD-039/040 index 行) |
| T4-11 | promotion.vouchers 可用券查询补部分索引(V1 延后,量起后 `(assigned_workspace_id, assigned_user_id) WHERE status='assigned'`) | `deploy/database/ddl`(promotion)                            | reserved(product_321 §10#9;**待核=文档定位、未跑活库**)               |
| T4-12 | 变更门控方法论 `classify-changes.mjs` 沉淀进 cicd playbook(TD-040 纳入本表跟踪)                                             | `docs/10-standards/010-cicd-optimization-playbook.md`       | ✅ PR #103(playbook 手法 F 六要点 + 实测验收;TD-040 已销号)           |

---

## 跨线依赖关系(哪项解锁谁;2026-07-21 关系分析)

消费方三线:**T-批** = vxture-template 计划1 批 0–4(product_240 §7)·**Arda** = 整改函 groups A–G(`docs/80-liaison/10-arda-rectification-requirements.md`)·**320** = product_320 PR0–PR6(线下订单/CD)。

| 任务       | 解锁的外部消费方                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1-1       | T-批2(RP 模块参照);闭 §6#25 core-oidc-rp 消费侧滞后                                                                                                                                                        |
| T1-2       | T-批3(在线联测需平台 seed product/OIDC/webhook)、T-批4(首个真产品);**refine:档位在线门控还需 metering fixtures=demo subscription+product_metrics+quota_pools;已补入 runbook #98 §2.7+§4(C2 探针加订阅态)** |
| T1-3       | T-批2 C2 client(消除每产品 C2 手抄漂移)                                                                                                                                                                    |
| T2-1/2/6/7 | T-批2(platform-client / quota.ts / C3 webhook / DB 基座)                                                                                                                                                   |
| T2-4       | T-批1/2 OIDC RP;**Arda 已合规**(letter F)                                                                                                                                                                  |
| **T2-5**   | **320 §4.4/§8.4(console 加 subscribe,合入知会 arda 线)+ Arda intent 容错 + T-批2 深链**——唯一同时解锁 320+arda 的项                                                                                        |
| T2-8       | Arda(letter D1/F 退 `{product_code}` scope)+ T-批1 平台登记                                                                                                                                                |
| T2-9       | T-批4(首次真部署)+ T-批3(三通道在线联测需 tailnet 可达演示产品,同依赖登记)                                                                                                                                 |
| T3-1       | L3 仓(raven/anlan/forge/xuanzhen)+ T-批3 agent 增量(product_240 §4.2 前置#2)                                                                                                                               |
| T3-2       | product_240 §4.2 前置#3(caller SDK 参照)+ Arda 为消费方                                                                                                                                                    |
| **T4-4**   | **Arda group D3**——直接卡 arda day-one webhook 双 secret 接线(letter :43,待平台 §6#19 标准化)+ template 批2 day-one dual-secret 消费                                                                       |
| T4-7       | 闭 §6#25 cutover 缺口 ①②(frozen 态 claim / switch-tenant 预检)+ 外部 RP 消费方                                                                                                                             |
| T4-1/2/3   | 产品成员表 / local_authz / local_usage(v1 已裁延后)                                                                                                                                                        |

| T2-13 | T-批2(tool-protocol 参照) |
| T2-14 | T-批F(自整顿 runbook 逐字复制) |
| T4-9 | product_320 后续 PR(订单幂等治理) |
| T4-12 | T-批1(CI/CD 复制,弱依赖:批1 逐字复制 arda ci.yml,不必先有 playbook) |

**纯平台内部、无外部消费方**:T2-10、T4-5、T4-6、T4-10、T4-11。

**有意不列为平台任务**(边界外,记明防漏判):

- **§6#24 产品级功能 RBAC `local_authz` schema 骨架** = **template 侧**(product_240 §2.4,明标"非平台标准";平台仍不拥有产品 RBAC 表结构)→ 归 vxture-template 批2,不是平台义务。
- **§6#21 deprovision "归档不硬删"** 平台侧**已满足**(`080-rp` §4 明写"降级只读/归档,不硬删");arda_200 §4.1 "拆除"措辞属 arda 线(letter E2);平台 provisioning schema 文档(data_commerce_220/data_platform_200)的"拆除"措辞仅是可选对齐(行本就复用不硬删)= T2-12 尾项。
- **seed 7 未接入 agent 产品的 `{code}:subscription` scope "清理"** = **否决**(前提被推翻):D12 退 `arda:subscription` 是 **arda 专属契约例外**(C2-only token,回函 06 §3;liaison 明限 arda),**非全目录政策**——活库产品 umbra 仍保留同型 scope。T2-8 处理的是 `product_200 §2.1` 裸 `{product_code}` **文档措辞**,不是 seed `:subscription` 行;7 产品为未接入占位,scope 随各自集成/owner 契约逐一定。
- **97_service_roles svc 白名单扩(console-bff/platform-api/admin-bff 加 promotion/provisioning/billing)** = **已就位**(97_service_roles.sql:138/141/146 已授,含 product_321 引注),非缺口;唯一残留 = TD-020 逐进程 `DATABASE_URL` cutover(owner-gated 批量生产动作)。
- **订单申报/确认/驳回邮件通知** = 已在 product_321 §10#1 / product_320 PR6 按 V1 刻意延后并跟踪,commerce/console-bff 内部特性,不解锁任何 template/arda 消费方,不入本 workplan。

## 推进记录

- 2026-07-20 立本计划;Tier 1 起(三路调研 grounding → 逐项 PR)。
- 2026-07-21 Tier 1 三项完成(#96/#97/#98);**Tier 2 §6 钦定措辞批 T2-1/2/4/5/6/7/8 完成(PR #99)**——两路调研 grounding(Tier 2 落点精确核对 + 跨线关系分析)。新增 T2-11(.gitattributes,已在 #94)/T2-12(改名残留);T2-3 判为 arda 线/owner 裁。剩 Tier 2 = T2-9(登记表,真产品部署前)/T2-10(tracker cosmetic)/T2-12(cosmetic);Tier 3 待 owner 裁;Tier 4 reserved。
- 2026-07-21 **Tier 1 三项全完成并 PR**:T1-3 #96(@shared 信封类型)、T1-1 #97(RP fixture 对齐,
  原判 live bug 经核查否定=已于 07-15 迁移,降级 cosmetic)、T1-2 #98(注册产品 runbook)。
  两处 owner-gated 待办已在表内记名:@shared@1.5.0 发包、演示产品活库 seeding。下一步 Tier 2(§6 未落平台文档)。
- 2026-07-21 **全量对账审计**(18-agent 工作流:七路 obligation sweep → reconcile → 对抗式 verify → report)。产出 6 CONFIRMED 新任务:T2-13(product_210 §4.2 tailnet 措辞欠账,§6#14)、T2-14(自整顿 runbook 补 `lint:schema-residue`,§6#8 实质残留)、T4-9(order_no 部分唯一索引)、T4-10(admin subscriptions.router 旁路登记 TD)、T4-11(voucher 部分索引,待核)、T4-12(TD-040 变更门控进 playbook)。对抗式**否决**两个诱人候选:seed `:subscription` 清理(arda 专属例外非全目录政策)、订单邮件(V1 已延后无消费方);查实 97_service_roles 白名单**已就位**(仅剩 TD-020 owner-gated cutover)。relationship map 精化:T4-4 +template 批2、T2-9 +T-批3、T1-2 +metering fixtures 缺口。残余不确定:工作树 PRE-#99(T2-1..8/T1-3 按 PR 记 DONE)、T4-11 文档定位未跑活库。
- 2026-07-21 **Tier 2 可执行尾批完成(PR #100)**:T2-13(product_210 §4.2 tailnet 措辞)、T2-14(自整顿 runbook 补 `lint:schema-residue`)、T2-12(mangled note 修,deprovision 措辞判正确免改)、T2-10(§6 tracker 五行标 ✅,标准侧核对);runbook #98 补 metering fixtures 维度(闭 T1-2 refine)。剩 Tier 2 = 仅 T2-9(基建登记表,需 owner 端口/主机分配);Tier 3/4 待 owner 裁/reserved。
- 2026-07-21 **合并交付 + 收尾三连**:owner 授权后 #93–#104 **全部合入 main**(SCA 门 body-parser 顺修 #101);T2-9 完成(#104,基建分配登记表,三路事实核验,在产行 arda·varda 实值已核,未分配格待 owner)、T4-10 完成(#102,登记 TD-041)、T4-12 完成(#103,playbook 手法 F,TD-040 销号)。**Tier 1+2 全清**;剩:Tier 3 待 owner 裁(T3-1 LLM 通路/T3-2 S2S 场景)、T2-3 标号裁决、Tier 4 reserved(T4-1/2/3/4/9/11)+ tech-debt(T4-5/6/7/8 + TD-041);owner-gated 待发:@shared@1.5.0 发包、演示产品活库 seeding、登记表分配格拍板。
