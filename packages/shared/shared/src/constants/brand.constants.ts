/**
 * brand.constants.ts — 官网品牌名的**单一权威**。
 * @package @vxture-platform/shared
 *
 * owner 2026-09-10 走查:页面标题已改「Ruyin Studio」,但**浏览器 tab 与
 * `<title>` 还是「vxture AI」**。根因是品牌名散在四处各写一份——
 * 两份 header 词条(zh/en)+ `layout.tsx` 的静态 metadata + `metadata.ts` 的
 * 双语标题。改了看得见的那两处,看不见的两处没人会想起来。
 *
 * tab 标题恰恰是**最不容易被自己发现**的一处:改站的人盯着页面看,
 * 而 tab 上那行字要切出去才看得到。
 *
 * 所以收成一处。词条里的 `logo.text` 仍各自保留(它可能因语言而不同的排版需要),
 * 但**值必须与这里一致**——`check-brand-name` 守卫比对二者。
 */

/** 品牌名(拉丁形,中英一致)。 */
export const BRAND_NAME = "Ruyin Studio";

/** 浏览器 tab / `<title>` 上的完整标题:品牌名 + 一句定位。 */
export const BRAND_TITLE: Record<"zh-CN" | "en-US", string> = {
  "zh-CN": `${BRAND_NAME} | 释放数据潜力`,
  "en-US": `${BRAND_NAME} | Unleash Data Potential`,
};

/**
 * 备案信息 —— 中国大陆站点的**法定标识**。
 *
 * 为什么在常量里而不在 i18n 词条里:备案号**不随语言变化**。此前它挂在
 * `messages/{zh-CN,en-US}/layout/footer.json` 的 `icp.text` /
 * `publicSecurity.text` 下,于是被当成"待翻译的文案"——`en-US` 两处都留了空串,
 * 英文页面因此一个备案号都不显示(owner 2026-09-20 要求补上)。把它挪到这里,
 * 英文页面显示同一个号就不再需要"翻译"它。
 *
 * 这与本文件头记的品牌名教训同构:散在多处各写一份,改了看得见的那处,
 * 看不见的那处没人会想起来。website 页脚与 accounts 登录页页脚现在读同一份。
 *
 * 号码本身不可改写或翻译,所以英文页面也原样显示中文号,且不加任何英文前缀。
 */
export interface SiteFiling {
  /** 法定公示文字,原样显示。 */
  readonly text: string;
  /** 对应的官方查询地址。 */
  readonly link: string;
}

/** 工信部 ICP 备案。 */
export const ICP_FILING: SiteFiling = {
  text: "陕ICP备2025076448号",
  link: "https://beian.miit.gov.cn",
};

/**
 * 公安网信备案。链接带 `code` 查询参数直达本站这条记录——只给域名根的话
 * 点过去是公安部备案系统首页,查不到我们这一条。
 */
export const PUBLIC_SECURITY_FILING: SiteFiling = {
  text: "陕公网安备61011602000908号",
  link: "https://beian.mps.gov.cn/#/query/webSearch?code=61011602000908",
};

/** 页脚按此顺序排布:先 ICP 再公安,与备案要求的常见排序一致。 */
export const SITE_FILINGS: readonly SiteFiling[] = [
  ICP_FILING,
  PUBLIC_SECURITY_FILING,
];
