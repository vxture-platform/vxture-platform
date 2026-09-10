/**
 * formats.ts — 日期时间形态的 next-intl 配置。
 * @package @vxture/console
 * @layer Presentation
 * @category I18n
 *
 * ── 形态照 owner 2026-09-08 定的规范,不自建 ──
 * (原文在 `@vxture-platform/shared` 的 format.utils.ts 头部)
 *
 *     长日期 `2026/09/08`   短日期 `09/08`
 *     长时间 `15:04:05`     短时间 `15:04`
 *
 * **平台当前统一采用「长日期 + 长时间」。**「显示时间就必须带秒」正是从这里来的——
 * 排查订单、审计、通知时,同一分钟内的先后顺序恰恰最要紧,两个 `15:04` 摆在一起
 * 看不出谁先谁后。
 *
 * **字段顺序交给 locale,不写死**:日期的字段顺序属于语言——中文 `2026/09/08`、
 * 英文 `09/08/2026`。同一串数字,读出来是两个日期。
 *
 * ── 为什么放在这里,而不是各页面自己拼 ──
 * next-intl 的 `formats` 是**框架给形态定义留的位置**:`useFormatter()` 从这里取,
 * locale 由它自己带(是页面 locale,不是浏览器默认),Intl 实例由它缓存。
 * 三件事——形态一致、语言一致、不重复构造——在这一处同时成立。
 *
 * console 此前的 `hubModel.ts` 手拼了三个格式化函数(41+22+4 处调用),
 * 既不看语言、`fmtTime` 还漏了秒——正是规范里点名不许的「临时手搓」。
 */
export const DATETIME_FORMATS = {
  dateTime: {
    /** 长日期 + 长时间(平台默认)。 */
    long: {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    },
    /** 只要日期:注册时间、加入时间这类不需要时刻的场合。 */
    day: {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
    /** 只要时间(含秒)。与 day 拼用时优先用 `long`,少一次格式化。 */
    time: {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    },
    /**
     * 短日期。统计卡这类**只有一行、宽度就那么点**的地方用。
     *
     * 有它是因为此前有人拿 `fmtDate(x).slice(5)` 砍年份——那是在**格式化之后的串**
     * 上做字符串手术,只在「年份排最前、恰好 4 位 + 1 个分隔符」时对得上。
     * 英文 locale 下 `09/10/2026`.slice(5) 切出来的是 `2026`。
     * 字段顺序属于语言,所以要短日期就得让 Intl 给,不能自己切。
     */
    dayShort: {
      month: "2-digit",
      day: "2-digit",
    },
  },
} as const;
