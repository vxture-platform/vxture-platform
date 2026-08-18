# Design Assets

平台级视觉资产母本库：**只收跨产品共用、不绑定任何单一业务/产品的东西**
（owner 2026-08-18 判）。运行时应用把需要的资产拷进自己的 `public/assets/...`
自行伺服，不做跨包静态文件假设。

## 现存内容

- `brands/vx-brand/vxture-logo-icon.svg` — 平台自己的织环标（房牌，唯一的品牌母本）。
- `brands/social-brands/` — 三方登录品牌标（飞书 / 钉钉 / 微信 / Google），
  accounts / console / website 多产品共用。
- `icons/avatar-default.{svg,png}` — 通用缺省用户头像。
- `icons/tenant-default.png` — 通用缺省租户/组织头像（未上传 logo 时的楼宇图形）。
- `icons/levels/01–05.svg` — 通用五档等级图，配 DS 的 `LevelMarker`（第几名/哪一档
  配哪张图是业务判断，由调用方决定）。
- `shell-template/` — console + admin 共用的后台外壳遗留样式层（`shell-template.css`
  聚合入口）。方向：随 Shell* 组件族收敛逐步消亡——opera 已零依赖跑通该路线。
  2026-08-18 尸检+GC：整包出身是「城市数据中台」演示应用的逐字誊抄，78% 的
  选择器（app.css 282/365，含血缘画布、环图/雷达、演示助手 `.vela-*` 等整屏
死件）与 213 个 token 定义全仓零引用，已删；`tokens-admin-shell.css` 从 97
  个变量剩 6 个。存者皆有 console/admin/website 消费方，判据=全仓源码整词
  可达性（根含模板串），git 史可回。同日第三轮：user-panel.css 与
  shell-template-user-panel.css 切片入口整体删除——website 头部迁 DS
  ShellUserMenu 后四端用户面板同源，styles 导出随 6.0 批结清。

## 2026-08-18 迁出记录（产品自有 → 各归其主）

- `admin-tokens/` → `portals/admin/assets/legacy-tokens/`（admin 取值桥，自识别
  `@package @vxture/admin`，命运=吸附进 T2 后消失）
- `website-tokens/` → `portals/website/assets/legacy-tokens/`（同上，website）
- `ai/ai-agent-icon*.gif` → `agent-studio/varda/public/assets/ai/`（Varda 的动图
  身份标——产品身份资产归产品）
- `icons/roles/` → `portals/console/public/assets/icons/roles/`（租户角色图，
  角色 UI 的主人是 console）
- `brands/vx-brand/vx-{admin,opera}-logo-icon.svg` → 各自门户 `public/brand/`
- 删除：`vx-ruyin-logo-icon.svg`（外部产品自带品牌）、`anlan/forge/raven`
  占位标（未建仓 agent，brand 由各 agent 仓自带）、`avatar-default-NN` /
  `tenant-default-NN` 编号选型残渣（全部零消费，git 史可回）
