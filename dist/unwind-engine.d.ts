import type { PositionSnapshot, ProtectionRule, UnwindTrace } from './types.js';
import type { NoctuaConfig } from './config.js';
import { NaviClient } from './navi-client.js';
import { WalrusLogger } from './walrus-logger.js';
export declare class UnwindEngine {
    private naviClient;
    private walrusLogger;
    private config;
    constructor(naviClient: NaviClient, walrusLogger: WalrusLogger, config: NoctuaConfig);
    /**
     * Calculate the debt amount to repay to restore health factor to target.
     *
     * Health Factor = (totalCollateral * avgLTV) / totalDebt
     * To reach targetHF, we need: newDebt = totalCollateral * avgLTV / targetHF
     * debtToRepay = currentDebt - newDebt
     *
     * But since we're also withdrawing collateral to swap for repayment,
     * we use the flash loan approach which doesn't reduce collateral during repayment.
     */
    calculateRepayAmount(snapshot: PositionSnapshot, targetHF: number): {
        debtToRepay: number;
        collateralToWithdraw: number;
        debtSymbol: string;
        collateralSymbol: string;
    };
    execute(snapshot: PositionSnapshot, rule: ProtectionRule): Promise<UnwindTrace>;
}
