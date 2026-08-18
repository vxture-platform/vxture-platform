# 产品文档索引

> 产品规格、功能设计、实施状态。
> 按产品面和 Agent 分类组织。

---

## Platform 产品面

| 路径                                     | 内容                            | 状态      |
| ---------------------------------------- | ------------------------------- | --------- |
| [`platform/admin/`](platform/admin/)     | 运营后台（Admin）功能规格与设计 | ✅ 已完成 |
| [`platform/console/`](platform/console/) | 租户工作台（Console）功能规格   | ✅ 已完成 |
| [`platform/website/`](platform/website/) | 营销站点（Website）功能规格     | ✅ 已完成 |

## L2 域平台产品

> 产品对接文档采用**编号交接包**规范 → [`000_handoff-package-convention.md`](./10-000_handoff-package-convention.md)

| 路径                                                                                                        | 内容                                                          | 状态    |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------- |
| [`arda/arda_000_definition.md`](./210-arda/10-arda_000_definition.md)                                       | Arda 产品定义 v1.0                                            | ✅ 定稿 |
| [`arda/arda_100_handoff.md`](./210-arda/20-arda_100_handoff.md)                                             | Arda 对接交接总纲 v2.0（数据平台，L2；实施仓为独立 arda 仓）  | ✅ 定稿 |
| [`arda/arda_200_interface.md`](./210-arda/30-arda_200_interface.md)                                         | Arda 对接接口契约 v2.0（C1/C2/C3/webhook/值域/鉴权）          | ✅ 定稿 |
| [`arda/arda_300_integration-final.md`](./210-arda/40-arda_300_integration-final.md)                         | Arda 最终对接要求 + 决策留痕 v1.0（三通道定型，取代逐轮回函） | ✅ 定稿 |
| [`arda/arda_301_deeplink-live-2607141357.md`](./210-arda/50-arda_301_deeplink-live-2607141357.md)           | 通知：console `/subscribe` 深链落地页上产 + 联测请求          | 📨 通知 |
| [`arda/arda_302_shared-150-release-2607212151.md`](./210-arda/60-arda_302_shared-150-release-2607212151.md) | 回函：@vxture/shared@1.5.0 已发布（health 助手 / 根导出核实） | 📨 回函 |

## 模板线（repo template）

| 路径                                                                                                                        | 内容                                                                | 状态    |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------- |
| [`vxtpl/vxtpl_301_shared-150-health-import-2607212159.md`](./940-vxtpl/10-vxtpl_301_shared-150-health-import-2607212159.md) | 通知：shared@1.5.0 已发，health 切回共享助手 + 偏离纪律（140 新规） | 📨 通知 |

## Agent 产品面

| 路径             | 内容                                                 | 状态   |
| ---------------- | ---------------------------------------------------- | ------ |
| Varda 规格与进度 | 已迁独立仓 vxture-varda(2026-08-18),见该仓 docs/spec | ➡ 迁出 |

Ruyin 产品规格已随代码迁移到 `vxture/agentstudio-ruyin`，本仓不再维护 Ruyin 实现文档。

---

## 全局实施状态

见 → [`docs/00-meta/status.md`](../00-meta/30-status.md)
