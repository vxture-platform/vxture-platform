# TD-027 — Finance/Commerce 授权码补齐变更集（送审）

> 状态：🔧 已实现待审定 · 2026-07-11 · 依据 = owner 四点裁决
> 范围：seed + 路由 patch + 前端 step-up + 设计文档同步**已就绪在分支**；**未 commit / 未 push / 未 reseed**，等你过目。
> 定性（owner）：finance 进不了订阅页、operation 却能改订阅 = **生产运行中的授权倒挂**，性质等同 C4 封掉的洞，成因是缺码借码。

## 0. owner 裁决落地 + 核验结果

**四点裁决落地**：

1. **完整对称集 10 码**（无伞码，每聚合成对 read/manage；order 为只读合成视图故仅 read）。
2. **危码只 discount 归危**，更名 `commerce:billing.discount`；adjustment/supplement 归 `commerce:billing.manage`（不可逆提交点在下游 `payment.settle` 已守）；`payment.settle`、`invoice.void` 照准。
3. **角色矩阵照准**：finance 拿全结算链（含三危码，mfa=required 满足 step-up）；operation `product:price.manage` 回归产品定价、不再触达财务写。
4. **先 perm 后代码**：seed 先入 catalog（无路由引用惰性无害）→ 路由 patch 部署原子切换。

**10 新码**：read `commerce:{billing,invoice,payment}.read`；manage `commerce:{subscription,billing,invoice,payment}.manage`；危 `commerce:{billing.discount,invoice.void,payment.settle}`。seed 校验：`OPERATOR_PERMISSIONS` 37→47（node 计数确认），commerce 段 3→13。

**核验①（auditor 五聚合读码全授）**：✅ auditor 补 `commerce:{billing,invoice,payment}.read`（原已有 subscription.read/order.read）→ 五聚合读全覆盖。

**核验②（product:price.manage 硬切干净）**：✅ 全库反查 `platform.pricing.manage`（=`product:price.manage` 桥）在 admin-bff 的消费方**仅四个财务路由**（subscriptions/payments/invoices/commercial），products.router 用的是 `platform.product.manage` 不碰它。四路由切走后**该桥无残留消费 → 已退役**（`auth.service.ts`）。console-bff/console 门户的同名串是租户端独立体系，不受影响。`platform.tenant.manage` 桥保留（tenants/accounts/tickets 仍用，不在本次范围）。**后记（2026-10-04）：租户 / 工单（#577，2026-10-03）与账号 / 待办 / 搜索 / 产品目录 / 解决方案 / 套餐 / 定价（2026-10-04）两批拆完，`LEGACY_CAPABILITY_BRIDGE` 整个删除。**

**一个边界判断（需你确认或否决）**：`commercial` 只读仪表盘跨 metering/promotion/billing 三域，而 promotion/usage 域无 perm 码（独立缺口）。本次将其归 `commerce:billing.read`（财务读最贴近码），使 pricing 桥可退役；**后果：operation 无 billing.read → 看不到商业化仪表盘**（此前借 pricing 能看）。若你要 operation 保留仪表盘可见，需另定（如给 operation billing.read，或 commercial 单列 promotion/usage 域码——后者超 TD-027 范围）。

**危码端点拆分（实现决策）**：discount/red 原与 routine 动作共用多-action 端点，@RequireStepUp 是方法级无法按 body.action 条件加，故**拆独立端点**：`POST :billId/discount`、`POST :billId/invoice-receipts/:receiptId/void`（各 @RequireStepUp + 危码守卫）；前端 API client 内部按 action 路由到新端点，调用点名不变，仅 BillingDetailPage 的两处 dispatch 加 `runWithStepUp`。payment verify、order offline-confirm 本就是独立端点，直接加 @RequireStepUp + `payment.settle`。

**危码执法点在服务端（owner commit 前置，已闭合）**：client 侧按 action 路由对攻击者无约束力，step-up 执法必须在服务端。旧多-action 端点已加**处理器顶部 allow-list fail-fast**（DB 之前显式 400）：`runBillAction` 只接受 cancel/mark_overdue/create_adjustment/create_supplement，`runInvoiceReceiptAction` 只接受 update_shipping/finish；`discount`/`red` 打旧端点 → 400（提示走专用端点），持 billing.manage/invoice.manage 无法绕 step-up。回归测试 `billing-action-guard.spec.ts`（4 例）：①旧端点收危 action 必拒且 DB 未被触达；②专用 /discount、/void 端点对 manage-only 持有者返 403（需 billing.discount/invoice.void）——防将来重构把分支加回去。

**验证**：admin-bff + portal type-check + lint + 45 vitest（route-order 遮蔽扫描确认 2 新端点无遮蔽 + billing-action-guard 4 例危码执法）全绿。

---

## （以下为原分析稿，保留作依据）

## 1. 病因（一句话）

catalog（data_admin_200 §4）commerce 域**只有读码**（`commerce:subscription.read`、`commerce:order.read`）+ 一个危码（`commerce:refund.execute`），**没有账单/发票/支付/订阅的写码**。所有财务写路径借 `product:price.manage`（经 `platform.pricing.manage` 桥）兜底 → `product:price.manage` 授给了 operation 而非 finance → **operation 能改订阅、finance 不能**。

## 2. 财务读写端点全量清单（事实）

| 端点                                                                                | 动作                         | 触碰                                                   | 现守卫                    | 性质                             |
| ----------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------ | ------------------------- | -------------------------------- |
| `GET /api/subscriptions`(+`:id`)                                                    | 读                           | metering.subscriptions                                 | `platform.pricing.manage` | 读                               |
| `POST /api/subscriptions/:id/actions`                                               | renew/suspend/resume/cancel  | subscriptions+histories                                | `platform.pricing.manage` | 写·可逆·有审计                   |
| `GET /api/orders`(+`:id`)                                                           | 读                           | 合成(subscriptions/billing)                            | `platform.tenant.manage`  | 读                               |
| `POST /api/orders/:orderId/offline-payment-confirm`                                 | 确认线下收款                 | payments/invoices/transactions/subscriptions/histories | `platform.tenant.manage`  | 写·**动钱(收款)**·写流水         |
| `GET /api/billing`(+`:id`)                                                          | 读                           | billing.invoices/receipts/payments                     | `platform.tenant.manage`  | 读                               |
| `POST /api/billing/:billId/actions` `cancel`                                        | 作废账单(仅未收未开票)       | billing.invoices                                       | `platform.tenant.manage`  | 写·守卫下低危                    |
| `POST /api/billing/:billId/actions` `mark_overdue`                                  | 标记逾期                     | billing.invoices                                       | `platform.tenant.manage`  | 写·可逆                          |
| `POST /api/billing/:billId/actions` `discount`                                      | **减免应收**                 | billing.invoices                                       | `platform.tenant.manage`  | 写·**动钱(减应收)**              |
| `POST /api/billing/:billId/actions` `create_adjustment`/`create_supplement`         | **新建应收账单**             | 新 invoice+item                                        | `platform.tenant.manage`  | 写·**动钱(增应收)**·可 cancel 撤 |
| `POST /api/billing/:billId/offline-invoice-sync`                                    | 登记线下已开发票             | billing.invoice_receipts                               | `platform.tenant.manage`  | 写·记录既成发票                  |
| `POST /api/billing/:billId/invoice-receipts/:id/actions` `update_shipping`/`finish` | 寄送/完成                    | invoice_receipts                                       | `platform.tenant.manage`  | 写·可逆                          |
| `POST /api/billing/:billId/invoice-receipts/:id/actions` `red`                      | **发票红冲(作废已出账发票)** | invoice_receipts                                       | `platform.tenant.manage`  | 写·**法定不可逆**                |
| `GET /api/payments`                                                                 | 读                           | billing.payments                                       | `platform.pricing.manage` | 读                               |
| `POST /api/payments/:paymentId/verify`                                              | **核销(确认收款)**           | payments+transactions+invoices                         | `platform.pricing.manage` | 写·**动钱(收款)**·写流水         |
| `POST /api/payments/:paymentId/reject`                                              | 驳回待核销                   | payments(置 failed)                                    | `platform.pricing.manage` | 写·不动钱·可逆                   |
| `GET /api/invoices`                                                                 | 读                           | billing.invoice_receipts                               | `platform.pricing.manage` | 读                               |
| `GET /api/commercial/*`(usage/promotions/redemptions/overview)                      | 读                           | metering/billing/promotion 聚合                        | `platform.pricing.manage` | 读·仪表盘                        |

## 3. 补码方案（推荐）

规则（owner）：**读写对称、命名对齐、常规写走 manage 聚合、真危险单独拆码（refund.execute 先例）、硬切无并存窗口**。

⚠️ **与 owner 口述的出入（需裁）**：owner 点名「subscription/billing/invoice 三个 manage，按既有读码一一对应」。但实际 ①既有 commerce 读码只有 subscription/order 两个，billing/invoice/payment **无读码**；②payment verify/reject 与 order offline-confirm 两类写端点不在这三者内，必须有归属。故要真正读写对称 + 让 auditor 只读可达，需补的码多于三个。下表是**完整对称集**推荐；§3.3 附「最小集」备选供裁剪。

### 3.1 常规写码（manage 聚合，无 step-up）

| 新码                           | 覆盖端点                                        | 对应读码                           |
| ------------------------------ | ----------------------------------------------- | ---------------------------------- |
| `commerce:subscription.manage` | 订阅 renew/suspend/resume/cancel                | `commerce:subscription.read`(已有) |
| `commerce:billing.manage`      | 账单 cancel/mark_overdue + offline-invoice-sync | `commerce:billing.read`(新)        |
| `commerce:invoice.manage`      | 发票 update_shipping/finish                     | `commerce:invoice.read`(新)        |
| `commerce:payment.manage`      | 支付 reject + 订单读侧运营                      | `commerce:payment.read`(新)        |

### 3.2 危码（单独拆码 + step-up，对齐 refund.execute）

owner 要求：逐个过危码标准（**不可逆性 + 爆炸半径**），动钱且不可逆的单独拆码标危。逐项裁定如下，**报你确认**：

| 候选危码                  | 覆盖动作                                                   | 危码裁定理由                                                                                                                                                                     | 建议                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commerce:payment.settle` | payments `verify` 核销 + orders `offline-payment-confirm`  | **确认收款**：写 append-only 交易流水、置发票已付、激活订阅；撤销需反向补偿分录，实质不可逆；爆炸半径=资金账实                                                                   | **拆危 + step-up**（owner 明示「直接改支付状态」）                                                                                                   |
| `commerce:invoice.void`   | invoice-receipts `red` 红冲                                | **发票红冲**：作废已出账发票，法定不可逆（红冲后只能另开），涉税                                                                                                                 | **拆危 + step-up**（owner 明示「作废已出账发票」）                                                                                                   |
| `commerce:billing.adjust` | billing `discount`/`create_adjustment`/`create_supplement` | **动应收**：discount 直接减少应收（近似 write-off）；adjustment/supplement 新增应收账单。爆炸半径=收入确认；discount 不可逆性高（减免难追回），adjustment 可 cancel 撤（未收时） | **建议拆危 + step-up**；若认为 adjustment/supplement 可 cancel 撤属可逆，可只把 `discount` 归危、adjustment/supplement 留 `billing.manage`——**请裁** |

**明确判为 routine（不拆危、走 manage、无 step-up）**：订阅四动作（可逆有审计）、billing cancel（守卫限未收未开票，低危）、mark_overdue、offline-invoice-sync（登记既成发票非开票）、invoice shipping/finish、payment reject（不动钱）。

### 3.3 读码

对称补 `commerce:billing.read` / `commerce:invoice.read` / `commerce:payment.read`（让 auditor 只读可达、read/manage 分级成立）。

**最小集备选**（若嫌读码过多）：不补 billing/invoice/payment 三读码，其读端点统一归到 `commerce:order.read`（作「财务台账读」伞码），仅补 4 manage + 3 危 = 7 码。代价：读粒度粗、auditor 看财务读走 order.read 伞。**请在「完整对称集(10 码)」与「最小集(7 码)」间裁一个。**

## 4. 角色矩阵 diff（推荐，基于完整对称集）

| 角色                 | +新增                                                                                                                                          | 说明                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `super_admin`        | 全部新码（computed ALL 自动含）                                                                                                                | §4.4 显式全授                                                                      |
| `admin`              | 全部 4 manage + 3 危 + 3 read                                                                                                                  | admin 掌全业务域（现已含 refund.execute）                                          |
| `finance`            | `subscription.manage`、`billing.read/manage`、`invoice.read/manage`、`payment.read/manage`、`payment.settle`、`invoice.void`、`billing.adjust` | **修复倒挂核心**：finance 域拿回结算全链；mfa=required 满足危码 step-up            |
| `auditor`            | `billing.read`、`invoice.read`、`payment.read`                                                                                                 | 只读可达                                                                           |
| `operation`          | **无新增**；并 **移除财务写可达**                                                                                                              | operation 保留 `product:price.manage`（产品定价本职），但不再经它触达财务写——见 §5 |
| `tech_ops`/`support` | 无                                                                                                                                             | 非财务角色                                                                         |

危码 step-up 可行性核对：finance/admin `mfa_min_level='required'` ✓，step-up 前置满足。

## 5. 硬切改造清单（同一变更集，无并存窗口）

1. **seed**：`OPERATOR_PERMISSIONS` 补新码；`OPERATOR_ROLE_PERMS` 按 §4 更新；生产 reseed（先 perm 后代码，TD-021 教训）。
2. **路由守卫改造**（bff/admin-bff）：
   - subscriptions：读→`commerce:subscription.read|manage`；`:id/actions`→`commerce:subscription.manage`。
   - billing：读→`commerce:billing.read|manage`；cancel/mark_overdue/offline-sync→`commerce:billing.manage`；discount/adjustment/supplement→`commerce:billing.adjust`(危,`@RequireStepUp`)。
   - invoice-receipts actions：shipping/finish→`commerce:invoice.manage`；red→`commerce:invoice.void`(危,`@RequireStepUp`)。
   - payments：读→`commerce:payment.read|manage`；verify→`commerce:payment.settle`(危,`@RequireStepUp`)；reject→`commerce:payment.manage`。
   - orders：读→`commerce:order.read|manage`；offline-payment-confirm→`commerce:payment.settle`(危,`@RequireStepUp`)。
   - invoices(只读)/commercial(只读仪表盘)→对应 `.read`（或最小集伞码）。
3. **摘除借用码**：以上路径不再引用 `platform.pricing.manage`/`platform.tenant.manage`；`product:price.manage` 回归只守 products 定价端点。同步收敛 `LEGACY_CAPABILITY_BRIDGE`（`product:price.manage`→`platform.pricing.manage` 若仅财务在用则可退役该桥项，待确认 products 侧消费）。**2026-10-04：桥已整个删除。**
4. **前端**：危码写端点（payment.settle/invoice.void/billing.adjust 对应的 UI 动作）以 `runWithStepUp` 包裹（复用 C2 ceremony）；其余 manage 端点无需前端改动（capability 不足时 403，配合导航过滤另项）。
5. **危码前端 step-up 包裹点**：BillingDetailPage（discount/adjustment/supplement + 发票红冲）、PaymentsPage（verify）、OrderDetailPage（offline-payment-confirm）。

## 6. 待你裁的决策点（汇总）

1. **码集规模**：完整对称集（10 新码：3 read + 4 manage + 3 危）↔ 最小集（7 码，读归 order.read 伞）——选哪个？
2. **billing.adjust 危码边界**：discount+adjustment+supplement 全归危，还是只 discount 归危、adjustment/supplement 留 routine manage？
3. **角色矩阵 §4** 是否照准（尤其 finance 拿全结算链 + 三危码）。
4. 确认后我出**精确 seed diff（可直接 apply）+ 路由改造 patch**，再走生产 reseed（先 perm 后代码）。

> 注：本轮不动任何生产/代码，等你在 §6 四点上给方向。
