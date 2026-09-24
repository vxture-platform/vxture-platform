# 站点接管：平台维护 / 临时门户

> 建立：2026-09-24（替代 2026-09-13 写死在 vhost 里的那段 rewrite）

「站点接管」是**在边缘层把一个域的对外形态换掉**的机制，不改应用、不重建容器、不发版。

三档：

| 档位          | 对外是什么 | 范围               | 状态码                     |
| ------------- | ---------- | ------------------ | -------------------------- |
| `off`         | 正常站点   | ——                 | 各 vhost 自己的去向        |
| `maintenance` | 平台维护页 | **整域每条路径**   | `503` + `Retry-After: 900` |
| `portal`      | 门户页     | **只有根路径** `/` | `200`                      |

三档不是同一件事的强弱，是三件不同的事。挑档位按「你想让访客看到什么」，不按「有多严重」。

「整域每条路径」的准确含义是**这个 vhost 放行的每条路径**：判定写在每个反代 location 的
首行，`= /api/health` 例外（健康检查要回答「它到底好不好」，不是「今天对外开不开」）。
一个本来就 404 的路径在维护期间照旧 404，那是对的——它不存在这件事和维护无关。

---

## 1. 怎么切

在 worker-01 上：

```bash
sudo bash /srv/vxture/deploy/scripts/35-site-takeover.sh                        # 看当前各域档位
sudo bash /srv/vxture/deploy/scripts/35-site-takeover.sh vxture.com maintenance # 进维护
sudo bash /srv/vxture/deploy/scripts/35-site-takeover.sh vxture.com off         # 恢复
```

它做三件事：写现场状态文件 → 重渲一份 nginx map + 投放接管页 → `nginx -t` + `nginx -s reload`。
**秒级，不重建任何容器、不动镜像、不碰数据库。** 重复设同一档位没有副作用。

维护窗口靠这条命令开合，不靠发版——发版本身往往正是维护的内容。

---

## 2. 档位住在哪，为什么切了不会被发版冲掉

```
仓内默认   deploy/nginx/site-takeover.defaults        新机 / 从没切过档时的答案
现场状态   /srv/vxture/runtime/site-takeover.state    人工维护区，deploy 不覆盖
```

`20-sync-nginx-config.sh` 每次同步都把这两处重新读一遍再渲染。现场状态之所以活得过发版，
是因为它**不在** `sites-enabled` 里——那个目录本脚本是先清后渲的，任何写在里面的现场状态
都活不过一次同步（这条教训在 2026-08-18 那次残留 vhost 上已经付过一次学费）。

现场状态只能覆盖仓内默认**登记过的域**。登记一个新域要改 `site-takeover.defaults`，
那是一次代码改动，会被守卫核对。域名拼错不会报错、只会悄悄不生效，所以脚本直接拦下。

---

## 3. 机制住在四处

| 处  | 文件                                  | 管什么                             |
| --- | ------------------------------------- | ---------------------------------- |
| 1   | `deploy/nginx/site-takeover.defaults` | 哪些域登记了档位                   |
| 2   | `deploy/nginx/sites-enabled/*.conf`   | 哪些 vhost 真的接了 `$vx_takeover` |
| 3   | `deploy/nginx/html/__takeover/*.html` | 每个档位发哪张页                   |
| 4   | `deploy/scripts/lib/site-takeover.sh` | 合并两处状态、渲染 map、投放页     |

外加 `deploy/nginx/conf.d/04-site-takeover.conf`：http 层那个 `map $host $vx_takeover`。
它必须在 `conf.d/`——compose 只挂 `conf.d / sites-enabled / html / ssl / logs`，仓里那份
`nginx.conf` 与 `snippets/` 都**不生效**。

四处之间没有任何机械链路，对不上时的症状都不是报错：登记了一个 vhost 没接的域 → 切档
「成功」而站点一动不动；档位有了而页没有 → 切到那一档才 404。所以
`scripts/guardrails/check-site-takeover.mjs` 对这四处双向对账，并另查三条性质（见 §6）。

---

## 4. 接管页

两张页都在 `deploy/nginx/html/__takeover/`，由 nginx **自己**发（`root /var/www/html`），
不经过上游。这是整套机制的理由：上游全挂时它们照样出得来。实测——把 website 容器停掉：

```
off          /   502   （上游真的挂了，502 是实情）
portal       /   200   门户页照常
maintenance  /   503   维护页照常
```

因此接管页**必须自包含**：不许有任何本地子资源，一个 `/favicon.ico` 就能把上面这条作废。
外链只允许 Google Fonts 与备案链接。

### 页面上写什么、不写什么

- **说明一律不写进 HTML。** 这两份文件随请求原样下发，连注释一起——`view-source` 就能读到。
  说明写进 nginx 配置（那份不下发）。2026-09-13 第一版把仓内路径写进页头，那比页脚那行字
  更直接地把内部结构送了出去。
- **门户页上不出现「临时 / 占位 / 筹备 / 尚未 / 暂不」**（owner 2026-09-13 定）。它对外是一个
  站，不是一段过渡。
- **门户页必须 `noindex`；维护页必须不写 `noindex`。** 门户页是 200 的真内容，不拦就会被当成
  这个域的首页收录；维护页随 503 发出，503 已经说清「暂时不可用、别摘掉我」，再叠一个
  noindex 等于在长维护里主动要求除名。

---

## 5. 两个实测撞出来的坑

### 5.1 同一个 location 里 `try_files` 会吃掉 `if`

第一版 `location = /` 写的是：

```nginx
if ($vx_takeover = maintenance) { return 503; }
try_files /__takeover/$vx_takeover.html @website;
```

靠「这个档位有没有对应的页」自己当开关，看着更省事。**它是错的，而且错得很安静**：
`nginx -t` 通过，维护页也确实发出去了，只是状态码是 **200** 而不是 503——正好踩中 §4 里
刚写下的那件要避免的事。

实测确认：把 `try_files` 换成 `return 599`，同一请求立刻回 599；放回去就又变 200。

所以两档统一走 `if` + 内部跳转（`return 503` → `error_page`，或 `rewrite … last` → `internal`
location），接管相关的 location 里不出现 `try_files`。守卫判据 H 直接禁掉这个组合。

### 5.2 `expires` 对 503 不生效

`expires -1` 只对 200/3xx 那一组状态生效。维护页是 503，实测回来时**一个 Cache-Control 都没有**，
所以那一段显式写了 `add_header Cache-Control "no-store" always;`。

顺带一条相关的：`add_header` **不跨层级合并**——location 里一旦写了一条，server 块那组
（HSTS / X-Frame-Options / nosniff / Referrer-Policy）就整组不再继承。所以维护页那段把四个
安全头照抄了一遍，而门户页那段只用 `expires`（它不参与那套继承）就够。

### 5.3 接管页目录有两个身份不同的写者

`/srv/vxture/data/nginx/html/__takeover/` 被两处写：

- `20-sync-nginx-config.sh`（deploy 链）以**部署用户**跑；
- `35-site-takeover.sh` 要求 sudo，以 **root** 跑。

`takeover_sync_pages` 原来用 `rm -rf "$dst"; mkdir -p "$dst"` 同步，于是**谁跑谁拿走目录归属**。
root 切过一次档之后，下一次 deploy 就停在

```
rm: cannot remove '/srv/vxture/data/nginx/html/__takeover/portal.html': Permission denied
```

——**unlink 看的是目录的写权限，不是文件的归属**，所以部署用户对 root 建的目录里的文件无能为力。
v0.26.263 的生产 deploy 实际因此失败；在此之前一直正常，因为「先切档、再发版」这个顺序是那天
第一次出现。

现在的做法：

- 目录**只建不删**，只清内容——归属就不会被重置；
- 以 root 跑时结束前 `chown -R --reference=<html 根>`，把归属还给部署用户；
- 已经被锁住的现场能自愈：目录不可写时走 `sudo -n chown --reference`（与
  `13-prepare-runtime-env.sh` 同一条提权路径），拿不到权限就报错并原样打出该跑的命令；
- `35-site-takeover.sh` **不创建** `conf.d/` 与 html 根目录，只断言它们存在——以 root 建出来的
  父目录会让上面那个 `--reference` 基准本身变成 root，自愈就再也修不回来。

单测里对应的那条断言是「同步不重建目标目录（inode 不变）」：归属在非 root 的测试里造不出来，
而 inode 不变正是被违反的那条性质。

---

## 6. 守卫

`node scripts/guardrails/check-site-takeover.mjs`（CI 里始终运行，含 docs-only）。
**没有** `pnpm lint:` 入口是有意的：加一个 lint 入口要改根 `package.json`，那会触发一次
全栈重建（14 个镜像），代价与这条守卫本身不成比例。照 `audit-env` 的先例直接用 node 调。

判据：

- **A–D（对账）** 档位值域合法；登记的域有 vhost 且那份 vhost 真的读 `$vx_takeover`；反向亦然；
  每个非 `off` 档位有页，`off.html` 不许存在。
- **E（自包含）** 接管页没有本地子资源，也不出现仓内路径 / 容器名。
- **F（状态码与 robots 一致）** 见 §4。
- **G** `conf.d` include 的 map 文件名必须与渲染函数写出的一致——对不上时 `nginx -t` 直接失败、
  边缘拒绝 reload（2026-09-10 智能体路由表踩过同一条）。
- **H** 见 §5.1。

另有 `deploy/scripts/lib/site-takeover.test.sh`（CI 跑 `deploy/scripts/lib/*.test.sh`）：
合并与拒绝逻辑的纯文本单测，外加投放函数的目录性质，21 条。

---

## 7. 当前登记的域

| 域           | 默认档位 | 说明               |
| ------------ | -------- | ------------------ |
| `vxture.com` | `off`    | 官网主域，真站在跑 |

**`ruyin.work` 已摘出登记表**（owner 2026-09-24：「应该和 vxture.com 同一个真实主页」）。
那个域现在整域 301 到 vxture.com，一个只出 301 的域没有「对外形态」可换，维护与门户两档
都由 vxture.com 那一侧承担——跳过去就看到。理由与那条 301 的代价写在
`deploy/nginx/sites-enabled/ruyin.work.conf` 文件头。

那张门户页仍留在 `deploy/nginx/html/__takeover/portal.html`，随时可以给 vxture.com 切
`portal` 档用；它不因为少了一个消费方而失效。

### 摘掉一个域时会遇到什么

主机上那份现场状态里会多出一个**已退役**的域。这时候两个调用方的正确答案不一样：

- `35-site-takeover.sh`（人在敲命令）→ **拒绝**，因为域名不在登记表里只可能是敲错了；
- `20-sync-nginx-config.sh`（deploy 路径）→ **丢弃并提示**（`takeover_resolve … prune`）。
  这里报错会让整次 deploy 失败（那个脚本 `set -e`），等于「把一个域从登记表里摘掉」这件
  事永远做不成。

## 8. 给一个新域接上接管

1. `deploy/nginx/site-takeover.defaults` 加一行 `<域名> off`；
2. 那个域的 vhost 里，在每个反代 location 首行加 `if ($vx_takeover = maintenance) { return 503; }`，
   根路径那个 location 再加一条 `if ($vx_takeover = portal) { rewrite ^ /__takeover/portal.html last; }`，
   并把两个 `internal` 页 location 与 `error_page 503` 抄过去（照 `vxture.com.conf`）；
3. 跑 `node scripts/guardrails/check-site-takeover.mjs`；
4. 合并发版后，在 worker-01 上 `35-site-takeover.sh <域名> maintenance` 真切一次再切回来——
   守卫全绿也拦不住「页面打不开」。
