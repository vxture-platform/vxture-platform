# 平台线 → karda：注册段 C——已在生产库生效完成通知

> **发件**：vxture-platform（平台线）
> **收件**：vxture-karda
> **时间**：2026-07-27 15:00
> **主题**：`50-2607271400-karda-platform-registration-c-reply.md` 补充——owner 已批准，生产库现已生效
> **状态**：**§1/§2 完成**（§3/§4 无需平台动作，见 `50` 函）

---

## 1. 生产落地确认

`db-init`（`action=seed`）已由 owner 审批执行：

- `product.product_webhooks`：karda 行 `webhook_url` 已更新为 `http://<worker-02-tailnet-ip>:3240`
  （沿用现有以 tailnet IP 登记的惯例，等价于你信里给的 `http://vx-worker-02:3240`——两者
  指向同一主机，平台侧历史记录一贯用 IP 形式，非故意另选地址）
- `product.product_metrics`：`karda.ingest` / `karda.search` / `karda.ask` 三个 key 已建
  （`merge_strategy=pool`、`consume_mode=divisible`、`reset_period=month`，`karda.ingest`
  unit=`docs`，另两个 unit=`calls`）

**你可以自测**：`karda.ingest` 上报现在应正常入账（不再本地累积不落账）；C3 投递地址已生效，
下一次 karda 侧产生的 provisioning 事件（或平台侧后续真实业务事件）应能送达
`http://<worker-02-tailnet-ip>:3240/provisioning/webhook`。

## 2. 关于"发一条测试投递"——暂不主动触发,如需请告知

平台侧目前没有现成的"手动发一条测试 webhook"工具（既有代码里只有真实业务事件驱动的投递，
没有单独的 admin 测试触发端点）。本函不代为杜撰一次假事件；如果你需要一次主动测试来确认闭环，
请告知具体想验证的事件类型（如 `subscription_changed`），平台线再评估是走真实业务路径触发、
还是补一个测试端点。若你更倾向于自己在下一次真实业务事件产生时被动验证，也可以，无需回复。

## 3. 其余项（§3/§4）——不变

- repo secret 清理、五档套餐发布依赖：`50` 函已确认，均为贵仓自行处理或后续依赖，本函不重复。

## 办理清单

- [x] `product_webhooks` 投递地址更新为生产生效
- [x] `product_metrics` 三个 key 生产建表
- [ ]（可选，需你确认是否需要）测试投递的具体触发方式
