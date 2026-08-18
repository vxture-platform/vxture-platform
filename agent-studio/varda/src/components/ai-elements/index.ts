/**
 * index.ts - AI 组件族导出入口
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - AI
 * @author AI-Generated
 * @date 2026-05-16
 */

/**
 * ai-elements - AI 助手界面件（气泡 / 流式输出 / 模型徽章 / 提示输入 / token 计数）。
 * @package @vxture/agent-studio-varda
 *
 * 2026-08-18 由 design-ui 迁入（owner 判：DS 只收通用、无业务含义的件）。
 * 这五件说的是模型部署状态、AI 会话、token 用量——智能体业务的界面语汇，
 * 由 DS 原语组合而成，组合的知识归 AI 助手的主人 varda。迁入时**零消费方**
 * （工作计划批 G 本就记着「暂缓，随 agent-studio 迁移」）；其他 agent 要同款，
 * 从这里复制或届时再谈抽共享，两个消费方之前不开包。
 */
export * from "./AIAssistantBubble";
export * from "./GenerationStream";
export * from "./ModelBadge";
export * from "./PromptInput";
export * from "./TokenCounter";
