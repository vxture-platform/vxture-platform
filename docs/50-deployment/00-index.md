# 部署文档

> 更新：2026-06-01

---

## 权威边界

`vxture` 仓库只负责平台控制面部署：当前 prod 部署到 `VXTURE_DEPLOY_HOST`；未来平台 beta 若启用，使用临时按量服务器 `vxture-beta`，不使用 `vx-worker-02`。

业务执行面（vx-worker-02 上的业务 beta/prod 双环境）属于外部业务仓库，本仓不得继续规划或实现 vx-worker-02 部署 workflow、secrets、compose 或脚本。详细边界见 [`08-code-environment-map.md`](./08-code-environment-map.md)。

---

## 文档职责划分

每份文档只负责一个关注点，避免重复。

| 文件                                                         | 唯一职责           | 内容                                                                                                                                                |
| ------------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`00-overview.md`](./00-overview.md)                         | **架构全景**       | 平台部署全景、VXTURE_DEPLOY_HOST 当前状态、未来 vxture-beta 约束、外部业务边界                                                                      |
| [`01-environments.md`](./01-environments.md)                 | **env 文件设计**   | VXTURE_DEPLOY_HOST env 文件职责、变量归属、共享密钥边界、重复项禁止清单                                                                             |
| [`02-infrastructure.md`](./02-infrastructure.md)             | **运维操作手册**   | VXTURE_DEPLOY_HOST Nginx/PostgreSQL/Redis、volume 映射、备份脚本、内存优化                                                                          |
| [`03-containers.md`](./03-containers.md)                     | **构建规范**       | 平台容器 Dockerfile 模板、构建顺序、服务调用拓扑、健康检查约定、资源规格                                                                            |
| [`04-services.md`](./04-services.md)                         | **Compose 编排**   | 平台 Compose、启动顺序、端口总表；P7b 后本仓不再保留 vx-worker-02 Compose                                                                           |
| [`05-ci-cd.md`](./05-ci-cd.md)                               | **CI/CD 流水线**   | 分支触发、CI、按变更动态镜像构建矩阵（detect + cache mounts）、deployability gate、VXTURE_DEPLOY_HOST prod 部署、构建/部署提效（B 组）、Husky hooks |
| [`06-subdomain-dns.md`](./06-subdomain-dns.md)               | **DNS 记录**       | 平台域名 Cloudflare DNS 记录、预注册子域名说明；业务域名只记录外部边界                                                                              |
| [`07-checklist.md`](./07-checklist.md)                       | **部署检查单**     | 平台部署前后验证步骤、回滚预案                                                                                                                      |
| [`08-code-environment-map.md`](./08-code-environment-map.md) | **代码环境对照表** | 本仓代码目录、分支、服务器、部署职责的权威边界；防止把业务 vx-worker-02 误纳入本仓规划                                                              |
| [`09-deployment-scripts.md`](./09-deployment-scripts.md)     | **脚本设计**       | 部署脚本命名、职责边界、执行顺序、审计与验证关系                                                                                                    |
| [`10-version-baseline.md`](./10-version-baseline.md)         | **版本基线**       | Ubuntu / Node / Docker / Compose / 容器镜像 / CI 的生产与开发版本基线                                                                               |

**端口分配** → [`docs/40-implementation/ai/port-allocation.md`](../40-implementation/ai/10-port-allocation.md)（端口权威来源，部署文档只引用，不重复定义）

---

## 本仓平台服务清单

| 服务           | 端口     | 类型    | 节点               |
| -------------- | -------- | ------- | ------------------ |
| Nginx          | 80 / 443 | nginx   | VXTURE_DEPLOY_HOST |
| gateway-bff    | 8000     | Node.js | VXTURE_DEPLOY_HOST |
| auth-bff       | 3090     | NestJS  | VXTURE_DEPLOY_HOST |
| website-portal | 3010     | Next.js | VXTURE_DEPLOY_HOST |
| website-bff    | 3011     | NestJS  | VXTURE_DEPLOY_HOST |
| console-portal | 3020     | Next.js | VXTURE_DEPLOY_HOST |
| console-bff    | 3021     | NestJS  | VXTURE_DEPLOY_HOST |
| admin-portal   | 3030     | Next.js | VXTURE_DEPLOY_HOST |
| admin-bff      | 3031     | NestJS  | VXTURE_DEPLOY_HOST |

业务执行面服务（例如 vx-worker-02 上的业务 BFF / Server / 数据库）不在本表维护，也不由本仓部署。
