/**
 * Flash Loan Atomic Unwind Engine
 *
 * Executes a single-PTB atomic unwind:
 * Flash loan → repay debt → withdraw collateral → swap → repay flash loan
 *
 * Uses navi-sdk exclusively to avoid ESM/CJS dual-package issues with @mysten/sui.
 */
import {
  flashloan,
  repayFlashLoan,
  repayDebt,
  withdrawCoin,
  updateOraclePTB,
  SignAndSubmitTXB,
  registerStructs,
  swapPTB,
} from 'navi-sdk';
import type { PoolConfig, CoinInfo } from 'navi-sdk';

export interface FlashloanUnwindParams {
  client: any;      // SuiClient from navi-sdk's CJS context
  keypair: any;     // Ed25519Keypair
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
export async function atomicFlashloanUnwind(params: FlashloanUnwindParams): Promise<FlashloanUnwindResult> {
  const {
    client,
    keypair,
    userAddress,
    debtPool,
    debtCoin,
    collateralPool,
    collateralCoin,
    debtAmountToRepay,
    collateralToWithdraw,
  } = params;

  try {
    registerStructs();

    // Dynamically require Transaction from navi-sdk's transitive dependency
    // to stay in the same CJS context and avoid dual-package hazard
    const { Transaction } = require('@mysten/sui/transactions');
    const tx = new Transaction();
    tx.setSender(userAddress);

    // Step 0: Update oracle prices for accurate HF calculation
    await updateOraclePTB(client, tx);

    // Step 1: Flash loan the debt token amount from NAVI
    const flashloanAmount = Math.ceil(debtAmountToRepay * (10 ** debtCoin.decimal));
    const [flashBalance, flashReceipt] = await flashloan(tx, debtPool, flashloanAmount);

    // Step 2: Repay the user's debt with flash-loaned tokens
    await repayDebt(tx, debtPool, flashBalance, flashloanAmount);

    // Step 3: Withdraw freed collateral
    const withdrawAmount = Math.ceil(collateralToWithdraw * (10 ** collateralCoin.decimal));
    const [withdrawnCoin] = await withdrawCoin(tx, collateralPool, withdrawAmount);

    // Step 4: Swap collateral → debt token via NAVI aggregator
    // Add 0.5% buffer for flash loan fee (0.06% current + slippage)
    const flashloanRepayAmount = Math.ceil(flashloanAmount * 1.005);
    const swappedCoin = await swapPTB(
      userAddress,
      tx,
      collateralCoin.address,
      debtCoin.address,
      withdrawnCoin as any,
      withdrawAmount,
      flashloanRepayAmount,
    );

    // Step 5: Repay the flash loan
    await repayFlashLoan(tx, debtPool, flashReceipt, swappedCoin);

    // Execute the atomic transaction
    const result = await SignAndSubmitTXB(tx, client, keypair);

    const gasUsed = result.effects?.gasUsed
      ? (
          BigInt(result.effects.gasUsed.computationCost) +
          BigInt(result.effects.gasUsed.storageCost) -
          BigInt(result.effects.gasUsed.storageRebate)
        ).toString()
      : '0';

    return {
      txDigest: result.digest,
      gasUsed,
      success: result.effects?.status?.status === 'success',
      error: result.effects?.status?.error,
    };
  } catch (error: any) {
    return {
      txDigest: '',
      gasUsed: '0',
      success: false,
      error: error.message || String(error),
    };
  }
}
