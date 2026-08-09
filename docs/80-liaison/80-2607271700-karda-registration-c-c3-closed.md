# 平台线 → karda：C3 闭环实测通过——120 函三通道全部确认完成

> **发件**：vxture-platform（平台线）
> **收件**：vxture-karda
> **时间**：2026-07-27 17:00
> **主题**：`70-2607271500-karda-registration-c-completion.md` 补充——C3 测试投递已实测送达，
> 你侧回执确认，120 函自此三通道全部闭环
> **承接**：`120-2607261820`（karda 侧）、`50`/`70`（本仓回函）

---

## 1. C3 测试投递结果

平台线补了一个 `db-init` 的 `test-delivery` action（此前没有手动触发测试投递的工具，
`50` 函提过这个缺口），向你侧 `http://<worker-02-tailnet-ip>:3240/provisioning/webhook` 发了一条
真实的 `subscription_changed` 通知（非伪造响应，走的是 platform-api 现有的签名/派发/HTTP
真实路径）：

- delivery id：`3421924b-1b1a-4916-9876-e92b4f459472`
- 入队后 10s 内被 platform-api 定时任务派发
- `provisioning.webhook_deliveries.status` = `delivered`（对方 HTTP 2xx）

你侧确认已收到并处理，回执如下（转录你侧确认）：

| 通道    | 状态                                                           |
| ------- | -------------------------------------------------------------- |
| C1 OIDC | 登录闭环（Redis 会话有 token 集）✅                            |
| C2 权益 | 三路探针 + 内网基址活 ✅                                       |
| C3 供给 | live 闭环确认（本次）✅ + 计量键已登记、`karda.ingest` 入账 ✅ |

## 2. 结论

`120-2607261820` 函的四项办理清单：

- [x] `product_webhooks` 投递地址登记 + 确认 `http://<worker-02-tailnet-ip>:3240` 可达（本函闭合）
- [x] 计量注册表 `karda.ingest`/`karda.search`/`karda.ask` 登记（`70` 函已确认，你侧回执
      `karda.ingest` 入账正常）
- [x] 失效 repo secret `OIDC_CLIENT_SECRET`——`50` 函已确认属实，属贵仓自行处理
- [x]（仅同步）五档套餐发布依赖 KD-202/203 + 产品定义 v1——不变，等你侧另发映射函

**120 函三通道（C1/C2/C3）现已全部确认完成，本函作为收尾。**

后续（beta 主机、五档发布）按既有约定分别走独立函件。
