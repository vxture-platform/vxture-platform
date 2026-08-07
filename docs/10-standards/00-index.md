# 工程规范索引

> 面向工程师的研发规范，覆盖代码提交、国际化、工具函数等。
> AI 编码规范见 `docs/40-implementation/ai/`。

---

| 文件                                                                                 | 内容                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`design-system.md`](./060-design-system.md)                                         | DS 内部工程规范：token 管线决策、守卫机制、偏离登记（对外使用规范随包发布：`packages/design/design-system/docs/`）                                                                        |
| [`design-system-release.md`](./050-design-system-release.md)                         | DS 版本发布规范：版本判断、dry run、真实发布、发布后验证                                                                                                                                  |
| [`design-system-consumer-trial.md`](./030-design-system-consumer-trial.md)           | DS 跨仓库消费试点验证：试点选择、安装验证、真实仓库接入流程                                                                                                                               |
| [`design-system-package-convergence.md`](./040-design-system-package-convergence.md) | DS 包结构收敛规划：单包策略、样式分层、公开入口治理                                                                                                                                       |
| [`design-token-pipeline.md`](./065-design-token-pipeline.md)                         | **Design Token 构建规范**：Figma=设计/导出=真值源 · 单向管线 · `aliasData` 权威而 `$description` 不可信 · 禁用 Tailwind 内置调色板 · 导出缺陷与三条回收断言 · 同步流程                    |
| [`font-system.md`](./090-font-system.md)                                             | 字体体系：品牌字体 / 产品字体 / CJK / Mono 分层规范                                                                                                                                       |
| [`locale-layer.md`](./110-locale-layer.md)                                           | Locale 层规范：i18n key 命名、翻译文件结构                                                                                                                                                |
| [`utils-layer.md`](./170-utils-layer.md)                                             | Utils 层规范：工具函数分层、命名约定                                                                                                                                                      |
| [`repo-governance-standard.md`](./140-repo-governance-standard.md)                   | **全栈产品仓模板与治理规范（整顿依据）**：主干模式 · 敏感信息/SCA · secret/variable 分类 · tag→env CD · **稳健 CD 构件** · **环境/部署 bootstrap** · 数据层/护栏 · **仓库骨架/docs 分类** |
| [`docs-taxonomy.md`](./070-docs-taxonomy.md)                                         | **docs/ 编号与标识体系**：元规则(编号=正式/无编号=待删) · 顶层十进制分段 · 域文档命名 · 域码表 · ADR/TD 寄存器 · `lint:docs-numbering`                                                    |
| [`git-workflow.md`](./100-git-workflow.md)                                           | Git 工作流规范（**主干模式**）：单 main + PR squash、提交格式、tag→env 发布                                                                                                               |
| [`cicd-optimization-playbook.md`](./010-cicd-optimization-playbook.md)               | CI/CD 提效 / 去冗余 playbook：去冗余触发、最小重建部署、覆盖缺口（可迁移方法论）                                                                                                          |
| [`container-healthcheck-standard.md`](./020-container-healthcheck-standard.md)       | 容器健康探测（healthcheck）标准：无依赖 liveness 探针、绑 `0.0.0.0`、探测参数、部署就绪闸门                                                                                               |
| [`service-health-endpoint-contract.md`](./025-service-health-endpoint-contract.md)   | **服务健康端点响应契约**：liveness/readiness 分离 · 统一身份块(service/version/gitSha/stage/buildTime/time) · 构建期溯源注入 · 各框架落地 · 反面模式 · 现状对账                           |
| [`testing.md`](./160-testing.md)                                                     | 测试策略：各层测试类型、禁止 mock DB、E2E 范围                                                                                                                                            |
| [`security.md`](./150-security.md)                                                   | 安全规范：Secrets 管理、JWT 约束、各层安全边界、CORS                                                                                                                                      |
| [`error-handling.md`](./080-error-handling.md)                                       | 错误处理：统一响应格式、错误码命名、各层异常传播规则                                                                                                                                      |
| [`logging.md`](./120-logging.md)                                                     | 日志规范：日志级别、结构化格式、敏感字段过滤、各层约定                                                                                                                                    |
| [`package-json.md`](./130-package-json.md)                                           | package.json 规范：必填字段、命名、版本策略、脚本约定、锁定版本表                                                                                                                         |
