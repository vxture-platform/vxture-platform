# Portal 层包文档

> @layer `Presentation` | 框架：Next.js 15（App Router）| 迭代慢，设计稳定
> 架构层参考：[`docs/30-design/architecture/00-overview.md`](../../../30-design/architecture/00-overview.md)

---

## 包列表

| 包                              | 路径               | 端口 | 域名                 | 服务对象                              |
| ------------------------------- | ------------------ | ---- | -------------------- | ------------------------------------- |
| [`website.md`](./30-website.md) | `portals/website/` | 3010 | `vxture.com`         | 公众（官网、注册、登录）              |
| [`console.md`](./20-console.md) | `portals/console/` | 3020 | `console.vxture.com` | 租户管理员（工作台、成员、账单）      |
| [`admin.md`](./10-admin.md)     | `portals/admin/`   | 3030 | `y.vxture.com`       | 平台运营者（租户管理、工单、AI 配置） |

---

## Varda 嵌入点

Varda 智能助手嵌入 admin 和 console 两个 portal，作为侧边栏 / 浮动栏 / 全屏 AI 助手使用：

| Portal  | 嵌入入口文件                                      | surface 值 |
| ------- | ------------------------------------------------- | ---------- |
| admin   | `portals/admin/src/layout/VardaAdminChat.tsx`     | `admin`    |
| console | `portals/console/src/layout/VardaConsoleChat.tsx` | `console`  |

---

## 共同约束

- Portal 只通过 HTTP 调用 gateway-bff（`api.vxture.com`），**禁止**直接 import 任何后端包
- 国际化通过 `@vxture/core-locale` 在服务端解析，客户端无需重新请求
- 所有样式必须经过 Design System，禁止绕过 DS 自建组件（见 `docs/60-operations/audit/checklist-ds.md`）
- Next.js 必须配置 `output: 'standalone'` 以支持 Docker 镜像构建
