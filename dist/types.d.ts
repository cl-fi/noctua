export interface NoctuaConfig {
    suiRpcUrl: string;
    privateKey: string;
    walrusPublisherUrl: string;
    walrusAggregatorUrl: string;
    walrusEpochs: number;
    defaultTriggerHF: number;
    defaultTargetHF: number;
    telegramBotToken: string;
    geminiApiKey: string;
}
export type Strategy = 'collateral_swap' | 'wallet_repay' | 'full_exit';
export interface ProtectionRule {
    triggerHF: number;
    targetHF: number;
    strategy: Strategy;
    paused: boolean;
}
export interface AssetPosition {
    coinType: string;
    symbol: string;
    amount: number;
    valueUsd: number;
    decimal: number;
}
export interface PositionSnapshot {
    healthFactor: number;
    collaterals: AssetPosition[];
    debts: AssetPosition[];
    totalCollateralUsd: number;
    totalDebtUsd: number;
    timestamp: number;
}
export interface UnwindTrace {
    triggerHF: number;
    restoredHF: number;
    strategy: Strategy;
    collateralSold: {
        coinType: string;
        symbol: string;
        amount: string;
    };
    debtRepaid: {
        coinType: string;
        symbol: string;
        amount: string;
    };
    swapRoute: string;
    txDigest: string;
    gasUsed: string;
    walrusBlobId?: string;
    timestamp: number;
}
export interface DaemonState {
    running: boolean;
    rule: ProtectionRule;
    lastCheck: number;
    lastHF: number;
    hfHistory: number[];
    recentTraces: UnwindTrace[];
    telegramChatIds: number[];
}
export interface AnalysisDecision {
    shouldAct: boolean;
    shouldWarn: boolean;
    reasoning: string;
}
