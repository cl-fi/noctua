import type { FunctionDeclaration } from '@google/genai';
import type { NaviClient } from './navi-client.js';
import type { UnwindEngine } from './unwind-engine.js';
import type { WalrusLogger } from './walrus-logger.js';
import type { DaemonState, ProtectionRule, Strategy } from './types.js';

/** Gemini function declarations for Noctua tools */
export const NOCTUA_TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_position',
    description: 'Get current NAVI lending position: Health Factor, collaterals (with USD values), debts (with USD values), total collateral and debt in USD',
    parameters: {
      type: 'OBJECT' as any,
      properties: {},
    },
  },
  {
    name: 'execute_unwind',
    description: 'Execute flash loan atomic unwind to restore Health Factor. This sells collateral to repay debt. DANGEROUS operation - only use when explicitly confirmed by user or when HF is critically low.',
    parameters: {
      type: 'OBJECT' as any,
      properties: {
        confirm: {
          type: 'BOOLEAN' as any,
          description: 'Must be true to execute. Safety check.',
        },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'get_history',
    description: 'Get recent unwind operation history with Walrus audit trail links',
    parameters: {
      type: 'OBJECT' as any,
      properties: {
        count: {
          type: 'NUMBER' as any,
          description: 'Number of recent entries to return (default: 5)',
        },
      },
    },
  },
  {
    name: 'get_walrus_trace',
    description: 'Read full audit trace from Walrus decentralized storage by blob ID',
    parameters: {
      type: 'OBJECT' as any,
      properties: {
        blobId: {
          type: 'STRING' as any,
          description: 'Walrus blob ID to fetch',
        },
      },
      required: ['blobId'],
    },
  },
  {
    name: 'update_rule',
    description: 'Update protection rule: trigger HF threshold, target HF to restore, strategy, or pause/resume',
    parameters: {
      type: 'OBJECT' as any,
      properties: {
        triggerHF: {
          type: 'NUMBER' as any,
          description: 'Health Factor threshold to trigger protection (e.g. 1.5)',
        },
        targetHF: {
          type: 'NUMBER' as any,
          description: 'Health Factor to restore after unwind (e.g. 2.0)',
        },
        strategy: {
          type: 'STRING' as any,
          description: 'Protection strategy: collateral_swap, wallet_repay, or full_exit',
        },
        paused: {
          type: 'BOOLEAN' as any,
          description: 'true to pause monitoring, false to resume',
        },
      },
    },
  },
];

/** Tool call handler — executes the actual function and returns result as string */
export class ToolHandler {
  constructor(
    private naviClient: NaviClient,
    private unwindEngine: UnwindEngine,
    private walrusLogger: WalrusLogger,
    private getState: () => DaemonState,
    private updateRule: (rule: Partial<ProtectionRule>) => void,
  ) {}

  async handle(name: string, args: Record<string, any>): Promise<string> {
    switch (name) {
      case 'get_position': {
        const snapshot = await this.naviClient.getPosition();
        return JSON.stringify({
          healthFactor: snapshot.healthFactor,
          totalCollateralUsd: snapshot.totalCollateralUsd,
          totalDebtUsd: snapshot.totalDebtUsd,
          collaterals: snapshot.collaterals.map(c => ({
            symbol: c.symbol, amount: c.amount, valueUsd: c.valueUsd,
          })),
          debts: snapshot.debts.map(d => ({
            symbol: d.symbol, amount: d.amount, valueUsd: d.valueUsd,
          })),
        }, null, 2);
      }

      case 'execute_unwind': {
        if (!args.confirm) {
          return 'Unwind NOT executed — confirm must be true. This is a safety check.';
        }
        const snapshot = await this.naviClient.getPosition();
        const state = this.getState();
        try {
          const trace = await this.unwindEngine.execute(snapshot, state.rule);
          return JSON.stringify({
            success: true,
            triggerHF: trace.triggerHF,
            restoredHF: trace.restoredHF,
            collateralSold: trace.collateralSold,
            debtRepaid: trace.debtRepaid,
            txDigest: trace.txDigest,
            walrusBlobId: trace.walrusBlobId,
          }, null, 2);
        } catch (err: any) {
          return `Unwind failed: ${err.message}`;
        }
      }

      case 'get_history': {
        const state = this.getState();
        const count = args.count || 5;
        const traces = state.recentTraces.slice(-count);
        if (traces.length === 0) return 'No unwind operations recorded yet.';
        return JSON.stringify(traces.map(t => ({
          time: new Date(t.timestamp).toISOString(),
          triggerHF: t.triggerHF,
          restoredHF: t.restoredHF,
          collateralSold: `${t.collateralSold.amount} ${t.collateralSold.symbol}`,
          debtRepaid: `${t.debtRepaid.amount} ${t.debtRepaid.symbol}`,
          txDigest: t.txDigest,
          walrusBlobId: t.walrusBlobId,
        })), null, 2);
      }

      case 'get_walrus_trace': {
        try {
          const trace = await this.walrusLogger.readUnwindTrace(args.blobId);
          return JSON.stringify(trace, null, 2);
        } catch (err: any) {
          return `Failed to read Walrus trace: ${err.message}`;
        }
      }

      case 'update_rule': {
        const update: Partial<ProtectionRule> = {};
        if (args.triggerHF !== undefined) update.triggerHF = args.triggerHF;
        if (args.targetHF !== undefined) update.targetHF = args.targetHF;
        if (args.strategy !== undefined) update.strategy = args.strategy as Strategy;
        if (args.paused !== undefined) update.paused = args.paused;
        this.updateRule(update);
        const state = this.getState();
        return `Rule updated: trigger=${state.rule.triggerHF}, target=${state.rule.targetHF}, strategy=${state.rule.strategy}, paused=${state.rule.paused}`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }
}
