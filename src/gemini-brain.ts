import { GoogleGenAI, type Chat, type FunctionCall, type Content } from '@google/genai';
import type { NoctuaConfig, ProtectionRule, AnalysisDecision, PositionSnapshot } from './types.js';
import type { VolatilityReport } from './price-volatility.js';
import { NOCTUA_TOOLS, ToolHandler } from './tools.js';

const MONITOR_MODEL = 'gemini-3-flash-preview';
const CHAT_MODEL = 'gemini-3-flash-preview';

const SYSTEM_PROMPT = `You are Watchdog 🐕, an autonomous DeFi guardian AI that protects NAVI Protocol lending positions on Sui blockchain.

Your personality:
- Calm, vigilant, data-driven
- Always cite specific numbers (HF values, USD amounts, percentages)
- Use concise language, be reassuring when safe, urgent when danger
- You can use owl metaphors sparingly

You have access to tools to check positions, view history, execute unwinds, and update rules.
When the user asks about their position, use the get_position tool.
When they ask about history, use get_history.
Only execute_unwind when explicitly asked or when the situation is critical.

Important: All monetary values are in USD. Health Factor (HF) below 1.0 means liquidation.
Below 1.2 is dangerous. Below 1.5 needs attention. Above 2.0 is generally safe.`;

const ANALYSIS_PROMPT = `You are a DeFi risk analysis engine. Analyze the position data and return ONLY a JSON object (no markdown, no extra text):

{"shouldAct": boolean, "shouldWarn": boolean, "reasoning": "brief explanation"}

Rules:
- shouldAct=true ONLY if HF is at or below the trigger threshold
- shouldWarn=true if HF is declining rapidly (compare history) or within 20% of trigger
- shouldWarn=false if HF is stable and far from trigger (avoid unnecessary alerts)
- reasoning should be 1-2 sentences in English
- If HF history shows rapid decline (dropping >0.1 in recent checks), warn even if above trigger
- If HF is stable or rising, no warning needed`;

export class GeminiBrain {
  private ai: GoogleGenAI;
  private toolHandler: ToolHandler;
  private chatSessions: Map<number, Chat> = new Map();  // per chatId

  constructor(config: NoctuaConfig, toolHandler: ToolHandler) {
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    this.toolHandler = toolHandler;
  }

  /**
   * Analyze position data and decide whether to act.
   * Uses structured output (no tool calling) for speed and token efficiency.
   */
  async analyze(data: {
    hf: number;
    rule: ProtectionRule;
    hfHistory: number[];
  }): Promise<AnalysisDecision> {
    const prompt = `${ANALYSIS_PROMPT}

Position data:
- Current Health Factor: ${data.hf.toFixed(4)}
- Trigger threshold: ${data.rule.triggerHF}
- Target HF: ${data.rule.targetHF}
- HF history (recent 20, oldest first): [${data.hfHistory.map(h => h.toFixed(4)).join(', ')}]
- Monitoring paused: ${data.rule.paused}`;

    try {
      const response = await this.ai.models.generateContent({
        model: MONITOR_MODEL,
        contents: prompt,
        config: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const text = response.text?.trim() || '';
      console.log(`[Gemini raw] ${text.slice(0, 300)}`);
      // Extract JSON from response — handle markdown wrapping, thinking tags, etc.
      const jsonMatch = text.match(/\{[\s\S]*?"shouldAct"[\s\S]*?\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in Gemini response');
      }
      const decision = JSON.parse(jsonMatch[0]) as AnalysisDecision;

      return {
        shouldAct: decision.shouldAct ?? false,
        shouldWarn: decision.shouldWarn ?? false,
        reasoning: decision.reasoning || 'No analysis available',
      };
    } catch (err: any) {
      console.error(`Gemini analysis error: ${err.message}`);
      // Fallback to simple threshold check
      return {
        shouldAct: data.hf <= data.rule.triggerHF && data.hf > 0,
        shouldWarn: data.hf <= data.rule.triggerHF * 1.2 && data.hf > data.rule.triggerHF,
        reasoning: `Gemini analysis failed, using threshold fallback. Current HF: ${data.hf.toFixed(4)}`,
      };
    }
  }

  /**
   * Chat with the user — supports function calling for tool use.
   * Maintains per-chat session for context.
   */
  async chat(chatId: number, userMessage: string): Promise<string> {
    let session = this.chatSessions.get(chatId);

    if (!session) {
      session = this.ai.chats.create({
        model: CHAT_MODEL,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations: NOCTUA_TOOLS }],
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      });
      this.chatSessions.set(chatId, session);
    }

    try {
      let response = await session.sendMessage({ message: userMessage });

      // Handle function calls (may need multiple rounds)
      let maxRounds = 5;
      while (response.functionCalls && response.functionCalls.length > 0 && maxRounds > 0) {
        maxRounds--;

        const functionResponses: any[] = [];
        for (const fc of response.functionCalls) {
          const result = await this.toolHandler.handle(fc.name!, fc.args as Record<string, any> || {});
          functionResponses.push({
            name: fc.name!,
            response: { result },
          });
        }

        // Send function results back to Gemini
        response = await session.sendMessage({
          message: functionResponses.map(fr => ({
            functionResponse: fr,
          })),
        });
      }

      return response.text || 'No response from Gemini.';
    } catch (err: any) {
      console.error(`Gemini chat error: ${err.message}`);
      // Reset session on error
      this.chatSessions.delete(chatId);
      return `Sorry, I encountered an error: ${err.message}`;
    }
  }

  /**
   * Auto-calibrate trigger/target HF based on market volatility + position data.
   * Called at startup (if no manual HF set) and every 24h.
   */
  async calibrateHF(volatility: VolatilityReport, position: PositionSnapshot): Promise<{
    triggerHF: number;
    targetHF: number;
    reasoning: string;
  }> {
    const prompt = `You are a DeFi risk calibration engine. Based on the market volatility data and user's current position, recommend optimal Health Factor thresholds.

Return ONLY a JSON object (no markdown, no extra text):
{"triggerHF": number, "targetHF": number, "reasoning": "brief explanation in English"}

Constraints:
- triggerHF must be between 1.2 and 2.0
- targetHF must be between triggerHF + 0.3 and triggerHF + 1.0
- Higher volatility → higher triggerHF (more conservative, act earlier)
- Lower volatility → lower triggerHF (less unnecessary unwinds)
- Consider max drawdown: if 24h drawdown > 10%, be very conservative
- Consider current HF: if already low, recommend higher trigger

Market Data:
${volatility.klineSummary}

Position Data:
- Current Health Factor: ${position.healthFactor.toFixed(4)}
- Total Collateral: $${position.totalCollateralUsd.toFixed(2)}
- Total Debt: $${position.totalDebtUsd.toFixed(2)}
- Collaterals: ${position.collaterals.map(c => `${c.symbol}: ${c.amount.toFixed(4)} ($${c.valueUsd.toFixed(2)})`).join(', ')}
- Debts: ${position.debts.map(d => `${d.symbol}: ${d.amount.toFixed(4)} ($${d.valueUsd.toFixed(2)})`).join(', ')}`;

    try {
      const response = await this.ai.models.generateContent({
        model: MONITOR_MODEL,
        contents: prompt,
        config: {
          temperature: 0.2,
          maxOutputTokens: 512,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const text = response.text?.trim() || '';
      console.log(`[Calibrate raw] ${text.slice(0, 300)}`);

      const jsonMatch = text.match(/\{[\s\S]*?"triggerHF"[\s\S]*?\}/);
      if (!jsonMatch) throw new Error('No valid JSON in calibration response');

      const result = JSON.parse(jsonMatch[0]);
      const triggerHF = Math.max(1.2, Math.min(2.0, result.triggerHF));
      const targetHF = Math.max(triggerHF + 0.3, Math.min(triggerHF + 1.0, result.targetHF));

      return {
        triggerHF: Math.round(triggerHF * 100) / 100,
        targetHF: Math.round(targetHF * 100) / 100,
        reasoning: result.reasoning || 'Auto-calibrated based on market volatility',
      };
    } catch (err: any) {
      console.error(`[Calibrate] LLM calibration failed: ${err.message}`);
      // Fallback: conservative defaults based on volatility
      const trigger = volatility.maxDrawdown24h > 10 ? 1.8 : volatility.maxDrawdown24h > 5 ? 1.5 : 1.3;
      return {
        triggerHF: trigger,
        targetHF: trigger + 0.5,
        reasoning: `LLM calibration failed, using conservative defaults based on 24h max drawdown (${volatility.maxDrawdown24h.toFixed(1)}%)`,
      };
    }
  }
}
