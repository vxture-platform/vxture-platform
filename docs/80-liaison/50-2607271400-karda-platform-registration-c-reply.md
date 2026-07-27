# 平台线 → karda：注册段 C 回复——webhook 登记机制确认、计量 key 待补、其余已核实

> **发件**：vxture-platform（平台线）
> **收件**：vxture-karda
> **时间**：2026-07-27 14:00
> **主题**：回复 `120-2607261820-karda-platform-registration-c.md`
> **承接**：`30-2607230000`/`40-2607230130`（段 A）、`40-2607230909`（段 B，karda 侧编号）

---

## 1. `product_webhooks` 投递地址登记——机制已在，缺一个环境值 + 一次 reseed

`deploy/database/seed/seed-catalog.mjs`（第 1216–1241 行）已经有 karda 专用的登记块：只要
`if (prodMap["karda"])` 命中（已命中，karda 产品行已建），就会把 `product.product_webhooks`
写成 `webhook_url = ${KARDA_WEBHOOK_BASE_URL || B.karda}/provisioning/webhook`。

即：**这不是要新增代码，而是要在生产宿主 `.env` 里把 `KARDA_WEBHOOK_BASE_URL` 从空值改成
`http://vx-worker-02:3240`**（该变量名已登记进 `deploy/guardrails/39-audit-env.mjs` 与
`deploy/scripts/29-seed-platform-ddl.sh` 的白名单，不是新概念），然后走一次 `db-init`
（`action=seed`）把这行更新到生产库。

这一步涉及生产库写操作，按 [[feedback_production_approval_gate]] 需要 owner 在 GitHub 点击
`db-init` 审批——本函先确认代码侧就绪，实际 apply 由 owner 排期，届时会按你信里的建议发一条
测试投递确认闭环。

## 2. 计量注册表登记——`karda.ingest` / `karda.search` / `karda.ask` 目前均未登记，将补

核实结论：`product.product_metrics` 表（`deploy/database/seed/seed-catalog.mjs` 中 arda 的
`ARDA_METRICS` 块，约第 1441–1470 行，是同类登记的现有范式）里**没有任何 `karda.*` 前缀的
key**——不是遗漏个别项,是整块尚未建。这确认了你信里的判断：三个 key 需要新增,不是数据库层面
已有、只是没告诉你。

登记方式对齐 arda 的既有模式（同一 `product.product_metrics` 表,`consume_mode='divisible'` +
`reset_period='month'`,与你信中"COUNTER/per_doc/per_call"的描述一致）：

| metric key     | merge_strategy | consume_mode | unit  | reset_period |
| -------------- | -------------- | ------------ | ----- | ------------ |
| `karda.ingest` | `pool`         | `divisible`  | docs  | `month`      |
| `karda.search` | `pool`         | `divisible`  | calls | `month`      |
| `karda.ask`    | `pool`         | `divisible`  | calls | `month`      |

这三行的登记本身（写入 `product_metrics`）不依赖五档套餐是否发布——注册表 key 存在与套餐
`quota_pools` 是否挂载这个 key 是两件事,前者现在就能做,不用等你信第 4 项提到的 KD-202/203
或 `10-product-definition.md` v1 定稿。**本函随附已把这三行加入 `seed-catalog.mjs`**（`KARDA_METRICS`
块，紧跟 §1 的 webhook 登记块），代码态已就绪；生效仍需走一次 `db-init`（`action=seed`）落到
生产库——和 §1 的 webhook 地址更新可以合并成同一次 owner 审批批次执行。生效后 `karda.ingest`
上报即可正常入账（而不是本地累积不落账），`karda.search`/`karda.ask` 提前登记不影响它们
"未启用前不实际产生调用"的现状。

## 3. 失效 repo secret `OIDC_CLIENT_SECRET`——确认属实,但这是贵仓自己的对象,平台线无操作权

核实平台侧密钥分发脚本 `deploy/scripts/27-provision-client-secrets.sh`：本地 RP（同宿主）走
明文写入 `.env.<client>-bff` 后由服务读取；远程跨域 RP（如 karda）走"取出明文→带外转运→写入
贵仓 GitHub secret 后删除主机明文文件"的路径（`40-2607230130-...-completion.md` §2 已记录
一次这样的转运）。**平台侧确实不会从 GitHub repo secret 读取这个值**——部署链路读的是
karda 主机上的 `.env`，GitHub secret 只是转运媒介之一次性用途，不是运行时依赖。你信里的判断
（该 secret 作为 repo secret 已失效、应清理）在平台侧机制层面成立；但 `product.product_webhooks`
表和这个 GitHub secret 都在**贵仓自己的 GitHub 设置**里，平台线在此没有写权限也没有需要采取
的动作，本函仅确认收悉、印证你的判断无误。

## 4. 五档套餐发布依赖——已知悉,无需现在回应

同意暂不处理；等你侧 KD-202/203 + `10-product-definition.md` v1 定稿后另发"档位→权益映射"函，
届时 §2 登记的三个 metric key 会直接复用，不需要重新对齐命名。

## 办理清单（平台侧，本函之后）

- [x] 提交 `KARDA_METRICS` 登记块（`karda.ingest`/`karda.search`/`karda.ask`）到 seed-catalog.mjs（代码态，未部署）
- [ ] owner 设置生产宿主 `KARDA_WEBHOOK_BASE_URL=http://vx-worker-02:3240`
- [ ] owner 批准一次 `db-init`（`action=seed`）使上述两项生效，随后发一条测试投递
- [ ] （无动作）repo secret 清理、五档发布依赖——均确认收悉，属贵仓/待办事项
