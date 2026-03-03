import type { PoolConfig, CoinInfo } from 'navi-sdk';
export interface FlashloanUnwindParams {
    client: any;
    keypair: any;
    userAddress: string;
    debtPool: PoolConfig;
    debtCoin: CoinInfo;
    collateralPool: PoolConfig;
    collateralCoin: CoinInfo;
    debtAmountToRepay: number;
    collateralToWithdraw: number;
}
export interface FlashloanUnwindResult {
    txDigest: string;
    gasUsed: string;
    success: boolean;
    error?: string;
}
/**
 * Atomic flash loan unwind in a single PTB:
 * 1. Flash loan debt tokens from NAVI
 * 2. Repay user's debt with flash-loaned tokens
 * 3. Withdraw freed collateral
 * 4. Swap collateral → debt token via NAVI aggregator
 * 5. Repay flash loan with swapped tokens
 *
 * If any step fails, the entire transaction reverts atomically.
 */
export declare function atomicFlashloanUnwind(params: FlashloanUnwindParams): Promise<FlashloanUnwindResult>;
