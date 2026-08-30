# Ruyin 桌面登录上线交接（执行清单）

> 交接方：ruyin 线（vxture-ruyin 会话）。#85（原生 public client 支持，`014f25b`）
> 已合并进 main，**代码已齐、生产未生效**。剩余全部是本仓的生产操作，按下面顺序执行。
> 交接依据：owner 裁定跨仓边界——ruyin 线对本仓止于分支+提交+push，发版/生产操作归本仓工作线。

## 现状（2026-08-30 探测）

- 生产 discovery `token_endpoint_auth_methods_supported` 尚无 `none`（auth-bff 未部署新代码，最新部署 v0.26.9 在 #85 之前）。
- `authorize?client_id=ruyin&redirect_uri=http://127.0.0.1:7420/oauth/callback` → `invalid_redirect_uri`（seed 未跑，ruyin 行仍是旧 web-RP 登记）。
- `client_id=ruyin-beta` → `invalid_client`（行不存在）。

## 执行步骤（顺序不可反）

**① 生产库迁移 + seed**（先行：加 `token_endpoint_auth_method` 列 + 写 ruyin/ruyin-beta 公共客户端行。旧代码不读新列，先跑无害；反之新代码先上会因缺列报错）：

```bash
gh workflow run db-init.yml --repo vxture-platform/vxture-platform \
  -f ref=main \
  -f expected_sha=014f25b0e1452f9bf8889c27b4ee1d9c1051665e \
  -f action=migrate-seed
```

等 run 结束为 success。预期日志可见：迁移 `2026-08-30-oidc-public-client.sql` 应用；
seed 输出 `oidc_clients — ruyin (product=ruyin, realm=customer, auth=none, secret=unset)`
与 `ruyin-beta` 同款一行。

**② 发版 auth-bff**（生产 tag，production 环境审批门照常）：

```bash
git tag v0.26.10 014f25b0e1452f9bf8889c27b4ee1d9c1051665e
git push origin v0.26.10
```

随后在 GitHub Actions 的 production 环境门上批准；等 deploy run success。

## 验收探针（部署后任何人可跑，全部无需凭证）

```bash
# 1) discovery 应包含 "none"
curl -s https://accounts.vxture.com/.well-known/openid-configuration | grep -o '"token_endpoint_auth_methods_supported":\[[^]]*\]'

# 2) ruyin + loopback 任意端口：不再是 invalid_redirect_uri（应 302 进登录/发码流程）
curl -s -o /dev/null -w '%{http_code}\n' "https://accounts.vxture.com/oidc/authorize?response_type=code&client_id=ruyin&redirect_uri=http%3A%2F%2F127.0.0.1%3A7420%2Foauth%2Fcallback&scope=openid%20profile%20email%20phone&state=x&code_challenge=vU74qJsG6Vj7MXHA-ESqAo1KDWbs8bSJQgpKGfjyJ60&code_challenge_method=S256"

# 3) ruyin-beta 存在：同上把 client_id 换 ruyin-beta，不再 invalid_client
```

三项过后通知 ruyin 线，由其驱动桌面端跑真实登录闭环（Web 登录授权由 owner 本人完成）。

## 风险与回退

- ① 幂等可重跑；只影响 `appoidc.oidc_clients`（加列 + ruyin/ruyin-beta 两行），机密客户端行为零变化。
- ② 的代码路径对机密客户端逐字未变（#85 回归 115/50 全绿）；如需回退，重部署上一 tag（v0.26.9）即可，DB 新列可留（旧代码不读）。
- public 客户端已被禁 token-exchange，S2S 面不受影响。
