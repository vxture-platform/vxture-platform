# 00-meta

关于文档本身：本索引 + glossary + contributing + status + **跨仓共享文档指针**。

## ⭐ 跨仓共享文档 — 正文不在本仓

被**多个仓同时引用**的文档（跨仓契约、规范、审计结论），正文放在 Claude artifact，
本仓只指向；**不留副本**，因为副本必然漂移而漂移无声。索引与新增规程见
[`05-shared-docs.md`](./05-shared-docs.md)。

| 文档                                                                                                       | 定位                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**产品接入通则**](https://claude.ai/code/artifact/20e37039-ea59-4c5d-9fab-ba3ca3ad54f0)                   | **唯一权威**。四通道契约 + MUST 条款全集（X 共同 / G 消费面 / A·B 管理面 / D 准入）+ 豁免登记 + 被调方义务。约束 atlas / runos / platform 及此后所有接入运营台的 agent 产品 |
| [L1 API 规范（product_251）· 已归档](https://claude.ai/code/artifact/070c254f-148c-4d3e-abf2-92be1b46efd7) | 正文已并入上一行。只保留**旧条款号对照**与沿革。**符合性由 `pnpm lint:conformance` 重算，不再写进文档**                                                                     |
| [L1 一致性审查](https://claude.ai/code/artifact/3b04d38e-38bd-49e7-821d-5c6710888619)                      | **现状**（两章）：CH.1 管理面四轴对照 · CH.2 消费面四不变量。每条回指 251 条款号                                                                                            |

docs/ 顶层十进制分段（编号=正式、无编号=待删）见权威 [`../10-standards/docs-taxonomy.md`](../10-standards/070-docs-taxonomy.md)：
`00-meta · 10-standards · 20-specs · 30-design · 40-implementation · 50-deployment · 60-operations · 70-workplan · 80-liaison · 90-memory`
