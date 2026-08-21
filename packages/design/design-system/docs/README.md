# Design System 对外规范

本目录随 `@vxture/design-system` 发包，是 DS 三包（design-tokens / design-ui / design-system）消费方的使用契约。工程过程（token 管线、守卫机制、偏离登记）留在平台仓内部文档，消费方无需关心。

| 文档                                                         | 内容                                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`01-usage.md`](./01-usage.md)                               | 使用契约：分层归属、T2 唯一 token 契约、三根尺寸轴、包与层映射、接入与禁止事项                                   |
| [`02-visual-spec.md`](./02-visual-spec.md)                   | 视觉规格：圆角派生与选档、透明模式、密度边界、排版与图标尺寸、标题阶梯                                           |
| [`03-patterns-guide.md`](./03-patterns-guide.md)             | 模式选用判据：Dialog/Drawer/整页、Toast/Banner、危险两档、模板五件、目录五级                                     |
| [`04-tokens-contract.md`](./04-tokens-contract.md)           | T2 全族表与各族档位清单（与生成物核对）                                                                          |
| [`05-content-standard.md`](./05-content-standard.md)         | 内容规范：术语表、文案语气、格式、句式模板                                                                       |
| [`06-a11y-standard.md`](./06-a11y-standard.md)               | 无障碍达标线：对比度、焦点环、点击目标、键盘可达等七条可验清单                                                   |
| [`07-consumption-pitfalls.md`](./07-consumption-pitfalls.md) | 接入陷阱：四条「接上去不报错、构建全绿、但结果是错的」——T2 token 撞名、暗色走 `.dark`、`/server` 子集、`@source` |
