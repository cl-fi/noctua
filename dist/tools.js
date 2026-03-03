/** Gemini function declarations for Noctua tools */
export const NOCTUA_TOOLS = [
    {
        name: 'get_position',
        description: 'Get current NAVI lending position: Health Factor, collaterals (with USD values), debts (with USD values), total collateral and debt in USD',
        parameters: {
            type: 'OBJECT',
            properties: {},
        },
    },
    {
        name: 'execute_unwind',
        description: 'Execute flash loan atomic unwind to restore Health Factor. This sells collateral to repay debt. DANGEROUS operation - only use when explicitly confirmed by user or when HF is critically low.',
        parameters: {
            type: 'OBJECT',
            properties: {
                confirm: {
                    type: 'BOOLEAN',
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
            type: 'OBJECT',
            properties: {
                count: {
                    type: 'NUMBER',
                    description: 'Number of recent entries to return (default: 5)',
                },
            },
        },
    },
    {
        name: 'get_walrus_trace',
        description: 'Read full audit trace from Walrus decentralized storage by blob ID',
        parameters: {
            type: 'OBJECT',
            properties: {
                blobId: {
                    type: 'STRING',
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
            type: 'OBJECT',
            properties: {
                triggerHF: {
                    type: 'NUMBER',
                    description: 'Health Factor threshold to trigger protection (e.g. 1.5)',
                },
                targetHF: {
                    type: 'NUMBER',
                    description: 'Health Factor to restore after unwind (e.g. 2.0)',
                },
                strategy: {
                    type: 'STRING',
                    description: 'Protection strategy: collateral_swap, wallet_repay, or full_exit',
                },
                paused: {
                    type: 'BOOLEAN',
                    description: 'true to pause monitoring, false to resume',
                },
            },
        },
    },
];
/** Tool call handler — executes the actual function and returns result as string */
export class ToolHandler {
    naviClient;
    unwindEngine;
    walrusLogger;
    getState;
    updateRule;
    constructor(naviClient, unwindEngine, walrusLogger, getState, updateRule) {
        this.naviClient = naviClient;
        this.unwindEngine = unwindEngine;
        this.walrusLogger = walrusLogger;
        this.getState = getState;
        this.updateRule = updateRule;
    }
    async handle(name, args) {
        switch (name) {
            case 'get_position': {
                try {
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
                catch (err) {
                    return JSON.stringify({ error: true, message: `Failed to fetch position from NAVI: ${err.message}. Do NOT make up data — tell the user the request failed and to try again later.` });
                }
            }
            case 'execute_unwind': {
                if (!args.confirm) {
                    return 'Unwind NOT executed — confirm must be true. This is a safety check.';
                }
                let snapshot;
                try {
                    snapshot = await this.naviClient.getPosition();
                }
                catch (err) {
                    return JSON.stringify({ error: true, message: `Cannot execute unwind — failed to fetch position: ${err.message}` });
                }
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
                }
                catch (err) {
                    return `Unwind failed: ${err.message}`;
                }
            }
            case 'get_history': {
                const state = this.getState();
                const count = args.count || 5;
                const traces = state.recentTraces.slice(-count);
                if (traces.length === 0)
                    return 'No unwind operations recorded yet.';
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
                }
                catch (err) {
                    return `Failed to read Walrus trace: ${err.message}`;
                }
            }
            case 'update_rule': {
                const update = {};
                if (args.triggerHF !== undefined)
                    update.triggerHF = args.triggerHF;
                if (args.targetHF !== undefined)
                    update.targetHF = args.targetHF;
                if (args.strategy !== undefined)
                    update.strategy = args.strategy;
                if (args.paused !== undefined)
                    update.paused = args.paused;
                this.updateRule(update);
                const state = this.getState();
                return `Rule updated: trigger=${state.rule.triggerHF}, target=${state.rule.targetHF}, strategy=${state.rule.strategy}, paused=${state.rule.paused}`;
            }
            default:
                return `Unknown tool: ${name}`;
        }
    }
}
//# sourceMappingURL=tools.js.map