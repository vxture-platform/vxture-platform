# 域名 DNS & 子域名整理清单

> 更新：2026-06-01

本文件只维护 `vxture` 仓库负责的平台域名。业务域名和 vx-worker-02 Tunnel 由外部业务仓库维护；本仓仅记录边界，避免误规划。

## 基础信息

- 解析主 IP：`39.103.62.17`
- 代理平台：Cloudflare
- TTL：Auto

---

## DNS 记录总表

| 类型   | 主机记录 (Name)                     | 记录值 (Content)   | 代理状态 | TTL  | 用途说明                                        |
| ------ | ----------------------------------- | ------------------ | -------- | ---- | ----------------------------------------------- |
| A      | vxture.com                          | 39.103.62.17       | Proxied  | Auto | 主域名/官方首页                                 |
| A      | www                                 | 39.103.62.17       | Proxied  | Auto | 官网 www 别名，重定向到 vxture.com              |
| A      | admin                               | 39.103.62.17       | Proxied  | Auto | 平台管理后台                                    |
| A      | console                             | 39.103.62.17       | Proxied  | Auto | 用户运营控制台                                  |
| A      | api                                 | 39.103.62.17       | Proxied  | Auto | 公共 API 接口服务（gateway-bff）                |
| A      | account                             | 39.103.62.17       | Proxied  | Auto | 账号中心（预留，当前由 website-bff 承载）       |
| A      | agent                               | 39.103.62.17       | Proxied  | Auto | AI Agent 服务接口（预留）                       |
| A      | beta                                | 39.103.62.17       | Proxied  | Auto | 公测版本/功能体验环境（预留）                   |
| A      | billing                             | 39.103.62.17       | Proxied  | Auto | 账单/财务付费管理（预留）                       |
| A      | model                               | 39.103.62.17       | Proxied  | Auto | AI 模型服务接口（预留）                         |
| A      | open                                | 39.103.62.17       | Proxied  | Auto | 开放平台入口（预留）                            |
| A      | platform                            | 39.103.62.17       | Proxied  | Auto | AI 平台核心入口（预留）                         |
| A      | profile                             | 39.103.62.17       | Proxied  | Auto | 用户个人资料页（预留）                          |
| A      | sandbox                             | 39.103.62.17       | Proxied  | Auto | 沙箱调试/模拟环境（预留）                       |
| A      | telemetry                           | 39.103.62.17       | Proxied  | Auto | 日志监控/遥测数据采集（预留）                   |
| A      | tenant                              | 39.103.62.17       | Proxied  | Auto | 多租户管理入口（预留）                          |
| A      | test                                | 39.103.62.17       | DNS only | Auto | 内部纯测试环境                                  |
| A      | vector                              | 39.103.62.17       | Proxied  | Auto | 向量库/Embedding 检索服务（预留）               |
| A      | workspace                           | 39.103.62.17       | Proxied  | Auto | 工作区管理平台（预留）                          |
| Tunnel | ruyin                               | vxture-worker-H01  | Proxied  | Auto | 外部业务域名，vx-worker-02 Tunnel；不由本仓部署 |
| MX     | mail                                | mx01.dm.aliyun.com | DNS only | Auto | 阿里云邮件接收服务器（优先级 10）               |
| TXT    | aliyun-cn-hangzhou.\_domainkey.mail | DKIM 域名密钥      | DNS only | Auto | 邮箱 DKIM 验证                                  |
| TXT    | \_dmarc.mail                        | DMARC 策略         | DNS only | Auto | 邮箱反伪造策略                                  |
| TXT    | mail                                | SPF 记录           | DNS only | Auto | 邮箱 SPF 发件人身份验证                         |

---

## ruyin.work（第二个注册域，2026-09-18）

`ruyin.work` 托管在 Cloudflare（与 `vxture.com` 同账号、**不同 zone**），边缘同为
worker-01。它当前只承载与 `vxture.com` 同一张占位页，配置见
`deploy/nginx/sites-enabled/ruyin.work.conf`。

| 类型 | 主机记录   | 记录值 (Content) | 代理状态 | TTL  | 用途说明                         |
| ---- | ---------- | ---------------- | -------- | ---- | -------------------------------- |
| A    | ruyin.work | 39.103.62.17     | DNS only | Auto | 占位页（只放行根路径，其余 404） |
| A    | www        | 39.103.62.17     | DNS only | Auto | **尚未创建**；建后 301 → 裸域    |

两点与本文上半部分口径不同，记下来免得下次对账时以为是漏填：

1. **DNS-only（灰色云）**。2026-09-17 实测 `ruyin.work`、`vxture.com`、`www.vxture.com`
   的 A 记录都直接回 `39.103.62.17`——橙云会回 Cloudflare 的边缘 IP，回真实源站 IP
   即灰云。本文上半表格里那一列「Proxied」是 2026-06-01 的状态，已被 §12 的灰云切换
   覆盖，尚未逐行订正。
2. **DNS 没有通配**这一条对第二个域同样成立。`www.ruyin.work` 现在是 NXDOMAIN；vhost
   里虽然已经收下这个 `server_name`、证书 SAN 也含 `*.ruyin.work`，但在建出 A 记录
   之前没有人能到达它。

> **备案**：备案号按域名发。占位页页脚现在显示的是 `vxture.com` 的号，所以那行字在本
> 域上并不属于本域。owner 2026-09-18 定：`ruyin.work` 自己的号下来之前本域不对外宣传，
> 届时改页脚。境内 IP 上挂未备案域名本身有被拦风险，这一项在阿里云/注册商侧处理，不是
> 本仓能落地的事。

---

## 备注说明

1. 绝大部分业务子域名已开启 **Cloudflare Proxied 代理**，隐藏源站 IP、防 DDoS
2. `test` 测试环境、邮箱 MX/TXT 记录均为 **DNS only**，不走 CF 代理
3. `ruyin` 为外部业务域名记录，Tunnel 名：`vxture-worker-H01`；本仓不维护 vx-worker-02 部署或业务域名切换
4. 邮箱全套配置：MX + SPF + DKIM + DMARC，阿里云企业邮件标准配置
5. **Cloudflare SSL 模式必须设置为 Full (strict)**，否则 Nginx 端 HTTPS 握手失败

---

## 预注册子域名（暂无对应服务）

以下子域名 DNS 记录已建，但尚未有对应部署服务，仅为占位/规划：

| 子域名      | 规划用途                                                              | 状态 |
| ----------- | --------------------------------------------------------------------- | ---- |
| `account`   | 独立账号中心（当前功能由 website-bff 承载）                           | 预留 |
| `agent`     | AI Agent 统一服务入口                                                 | 预留 |
| `billing`   | 独立账单服务                                                          | 预留 |
| `model`     | 模型服务接口                                                          | 预留 |
| `open`      | 开放平台对外入口                                                      | 预留 |
| `platform`  | AI 平台核心入口                                                       | 预留 |
| `profile`   | 用户个人资料页                                                        | 预留 |
| `sandbox`   | 沙箱调试环境                                                          | 预留 |
| `telemetry` | 日志监控/遥测                                                         | 预留 |
| `tenant`    | 多租户管理入口                                                        | 预留 |
| `vector`    | 向量库/Embedding 检索服务                                             | 预留 |
| `workspace` | 工作区管理平台                                                        | 预留 |
| `beta`      | 未来平台临时 beta 入口，目标服务器为 `vxture-beta`，不是 vx-worker-02 | 预留 |

> 上线任一预留子域名前，需先在 [overview.md § 域名规划](./00-overview.md) 登记目标服务与节点。
