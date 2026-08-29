# 70-workplan

计划 / 路线 / 批次跟踪。（命名见 [`../10-standards/070-docs-taxonomy.md`](../10-standards/070-docs-taxonomy.md)。）

| 文件                                                                           | 内容                                                                                 | 状态                                                                                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`10-platform-support-tasks.md`](./10-platform-support-tasks.md)               | 支撑 template / arda 按标准重构的平台侧配套任务（2026-07 工作线）                    | Tier 1–2 已完成，Tier 3–4 有遗留                                                                                                         |
| [`20-opera-ia-restructure.md`](./20-opera-ia-restructure.md)                   | Opera 目录重构六批次（DS → 导航迁移 → 审计重整 → 产品上线 → 能力用量 → 收尾）        | **六批全部完成**（B6-3 已于 2026-08-16 关闭 `#258`，无遗留）                                                                             |
| [`30-l1-consistency-audit.md`](./30-l1-consistency-audit.md)                   | Atlas / Runos / platform 三个 L1 产品管理面的一致性审查（名称 · 接口 · 逻辑 · 风格） | **platform 那一列已全部执行并联调验证**（2026-08-16，见 §C6）；上游 10 条已开 issue（atlas `#202`–`#206` / runos `#117`–`#121`），等回复 |
| [`40-entitlement-data-and-closeout.md`](./40-entitlement-data-and-closeout.md) | 权益配置的数据接入（D 系列）与关联板块收尾（E 系列）                                 | **全部完成**（2026-08-16）：D1/D2/D3-1' 与 E1–E4 已落；D2-3、D3-2、D3-3 经复核关闭（前提不成立 / 现状即正确）                            |

| [`60-console-p1-open-decisions.md`](./60-console-p1-open-decisions.md) | console P1 四份决策简报(通知中心 / 多 workspace / 危险区 / 个人实名):设计缺口或文档冲突,等 owner 裁定 | **等裁定**(2026-08-21 立项;P0 四项与 P1 两项已落地,清单见文末) |
| [`50-release-resequencing.md`](./50-release-resequencing.md) | 发布节奏重排：生产落后 main 63 个提交，拆成四次可回滚的上线（R0 收口 → R1 基础设施 → R2 DDL → R3 应用 → R4 一致性） | **五批全部走完**（2026-08-29 复核，生产在跑 `v0.25.0`）。文件已加 §5 承接下一次发布（`v0.25.0..main`，零 DDL，四步待 owner 执行）。**本格此前写「R0 进行中」，过时 12 天**——正是本表自己那条纪律 |
| [`70-design-system-phase-closeout.md`](./70-design-system-phase-closeout.md) | Design System 阶段收尾:三包自足与发布现状、守卫矩阵、拆仓就绪度与要一起搬走的工装清单 | **本阶段收口**(2026-08-21):设计线 issue 清零、tokens 2.2.0 / ui 3.1.1 / system 6.4.0 已发布;拆仓技术前提已备齐,余下为配置与产品裁定 |
| [`80-repo-split-and-scope-rename.md`](./80-repo-split-and-scope-rename.md) | 拆仓 + `@vxture/shared` 改名 + 新仓 secrets/environments 分层:判据、逐项裁定、五批任务 | **规划完成,待执行**(2026-08-21):批 0 有两处**阻断项**(缺 TAILSCALE_OAUTH_CLIENT_TAG、部署 secret 名不一致);三件待 owner 回答见 §5 |

> 设计与批次分开放：**判断**在设计文件里（`portals/opera/docs/opera-navigation-design.md`），
> **顺序与验收**在本目录。两者冲突以设计文件为准。

> **本表的状态格必须跟着改。** 2026-08-16 复核发现 30 与 40 两行还写着「未开工」，
> 而它们一份当天做完、一份 D/E 系列全绿——**索引说未开工，下一个读的人就会去重做**。
> 这与本仓在 `80-liaison/00-index.md` 立的是同一条纪律：归档不等于免于维护。
