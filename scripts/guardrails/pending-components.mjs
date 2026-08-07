/**
 * pending-components.mjs — 尚未按 T2 重写的组件清单。
 *
 * 单独成文件是为了让检查脚本与 design-preview 的统计卡读同一份。之前统计卡里写的是
 * 一个手抄的数字，清单减了它没跟着减，读者看到的是个早已不成立的数。
 *
 * 批 O（AuthLogin / ShellChrome）重写完成后清单已空：所有组件均纳入
 * check-component-classes 的类名实测。文件与机制保留，防止将来再欠下重写债时
 * 没有登记处。
 */

export const PENDING_COMPONENTS = [];
