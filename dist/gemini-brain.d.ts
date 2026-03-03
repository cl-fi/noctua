import type { NoctuaConfig, ProtectionRule, AnalysisDecision, PositionSnapshot } from './types.js';
import type { VolatilityReport } from './price-volatility.js';
import { ToolHandler } from './tools.js';
export declare class GeminiBrain {
    private ai;
    private toolHandler;
    private chatSessions;
    constructor(config: NoctuaConfig, toolHandler: ToolHandler);
    /**
     * Analyze position data and decide whether to act.
     * Uses structured output (no tool calling) for speed and token efficiency.
     */
    analyze(data: {
        hf: number;
        rule: ProtectionRule;
        hfHistory: number[];
    }): Promise<AnalysisDecision>;
    /**
     * Chat with the user — supports function calling for tool use.
     * Maintains per-chat session for context.
     */
    chat(chatId: number, userMessage: string): Promise<string>;
    /**
     * Auto-calibrate trigger/target HF based on market volatility + position data.
     * Called at startup (if no manual HF set) and every 24h.
     */
    calibrateHF(volatility: VolatilityReport, position: PositionSnapshot): Promise<{
        triggerHF: number;
        targetHF: number;
        reasoning: string;
    }>;
}
