import type { PositionSnapshot, ProtectionRule, UnwindTrace, Strategy } from './types.js';
import type { NoctuaConfig } from './config.js';
import { NaviClient } from './navi-client.js';
import { WalrusLogger } from './walrus-logger.js';
import { atomicFlashloanUnwind } from './flashloan-unwind.js';

export class UnwindEngine {
  private naviClient: NaviClient;
  private walrusLogger: WalrusLogger;
  private config: NoctuaConfig;

  constructor(naviClient: NaviClient, walrusLogger: WalrusLogger, config: NoctuaConfig) {
    this.naviClient = naviClient;
    this.walrusLogger = walrusLogger;
    this.config = config;
  }

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
  } {
    if (snapshot.debts.length === 0 || snapshot.collaterals.length === 0) {
      throw new Error('No debts or collaterals found');
    }

    // Pick the largest debt and largest collateral
    const primaryDebt = snapshot.debts.reduce((max, d) => d.valueUsd > max.valueUsd ? d : max);
    const primaryCollateral = snapshot.collaterals.reduce((max, c) => c.valueUsd > max.valueUsd ? c : max);

    // With flash loan approach:
    // After repaying debtToRepay, the HF increases.
    // We then withdraw some collateral and swap to repay the flash loan.
    //
    // newHF = (totalCollateralUsd - withdrawUsd) * avgLTV / (totalDebtUsd - debtRepayUsd)
    // We want newHF = targetHF
    //
    // Simplification: assume avgLTV ≈ currentHF * totalDebt / totalCollateral
    // (since currentHF = totalCollateral * avgLTV / totalDebt)
    const currentHF = snapshot.healthFactor;
    const avgLTV = currentHF * snapshot.totalDebtUsd / snapshot.totalCollateralUsd;

    // With flash loan, we repay debt first (no collateral change), then withdraw collateral
    // to cover the flash loan cost. The net effect on HF:
    //
    // After repaying X USD of debt:
    //   intermediateHF = totalCollateral * avgLTV / (totalDebt - X)
    //
    // After withdrawing Y USD of collateral (Y ≈ X * 1.005 for flash fee):
    //   finalHF = (totalCollateral - Y) * avgLTV / (totalDebt - X)
    //
    // We want finalHF = targetHF
    // Let fee = 1.005
    // targetHF = (totalCollateral - X * fee) * avgLTV / (totalDebt - X)
    // targetHF * (totalDebt - X) = (totalCollateral - X * fee) * avgLTV
    // targetHF * totalDebt - targetHF * X = totalCollateral * avgLTV - X * fee * avgLTV
    // X * (fee * avgLTV - targetHF) = totalCollateral * avgLTV - targetHF * totalDebt
    // X = (totalCollateral * avgLTV - targetHF * totalDebt) / (fee * avgLTV - targetHF)

    const fee = 1.005;
    const numerator = snapshot.totalCollateralUsd * avgLTV - targetHF * snapshot.totalDebtUsd;
    const denominator = fee * avgLTV - targetHF;

    let debtRepayUsd: number;
    const rawRepay = numerator / denominator;

    if (denominator === 0) {
      // Edge case: exactly balanced, repay all
      console.log(`🐕 Edge case: repaying all debt`);
      debtRepayUsd = snapshot.totalDebtUsd * 0.98;
    } else if (rawRepay > 0 && rawRepay <= snapshot.totalDebtUsd) {
      // Normal case: partial repay is sufficient (works for both +/+ and -/- signs)
      debtRepayUsd = rawRepay;
    } else if (rawRepay > snapshot.totalDebtUsd) {
      // Need more than total debt — cap at 98% full repay
      console.log(`🐕 Partial unwind insufficient, executing full debt repayment`);
      debtRepayUsd = snapshot.totalDebtUsd * 0.98;
    } else {
      // Negative result means position is already above target
      console.log(`🐕 Position already safe, no repayment needed`);
      debtRepayUsd = 0;
    }

    // Convert USD to token amounts
    const debtPrice = primaryDebt.valueUsd / primaryDebt.amount;
    const collateralPrice = primaryCollateral.valueUsd / primaryCollateral.amount;

    const debtToRepay = debtRepayUsd / debtPrice;
    const collateralToWithdraw = (debtRepayUsd * fee) / collateralPrice;

    return {
      debtToRepay,
      collateralToWithdraw,
      debtSymbol: primaryDebt.symbol,
      collateralSymbol: primaryCollateral.symbol,
    };
  }

  async execute(snapshot: PositionSnapshot, rule: ProtectionRule): Promise<UnwindTrace> {
    const { debtToRepay, collateralToWithdraw, debtSymbol, collateralSymbol } =
      this.calculateRepayAmount(snapshot, rule.targetHF);

    const debtPool = this.naviClient.getPoolConfig(debtSymbol);
    const debtCoin = this.naviClient.getCoinInfo(debtSymbol);
    const collateralPool = this.naviClient.getPoolConfig(collateralSymbol);
    const collateralCoin = this.naviClient.getCoinInfo(collateralSymbol);

    if (!debtPool || !debtCoin || !collateralPool || !collateralCoin) {
      throw new Error(`Pool config not found for ${debtSymbol} or ${collateralSymbol}`);
    }

    console.log(`🐕 Executing atomic unwind: repay ${debtToRepay.toFixed(4)} ${debtSymbol}, withdraw ${collateralToWithdraw.toFixed(4)} ${collateralSymbol}`);

    const result = await atomicFlashloanUnwind({
      client: this.naviClient.client,
      keypair: this.naviClient.keypair,
      userAddress: this.naviClient.address,
      debtPool,
      debtCoin,
      collateralPool,
      collateralCoin,
      debtAmountToRepay: debtToRepay,
      collateralToWithdraw,
    });

    // Get restored HF (wait for RPC to reflect the new state)
    let restoredHF = 0;
    if (result.success) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        restoredHF = await this.naviClient.getHealthFactor();
      } catch {
        restoredHF = rule.targetHF; // estimate
      }
    }

    const trace: UnwindTrace = {
      triggerHF: snapshot.healthFactor,
      restoredHF,
      strategy: rule.strategy,
      collateralSold: {
        coinType: collateralCoin.address,
        symbol: collateralSymbol,
        amount: collateralToWithdraw.toFixed(6),
      },
      debtRepaid: {
        coinType: debtCoin.address,
        symbol: debtSymbol,
        amount: debtToRepay.toFixed(6),
      },
      swapRoute: `${collateralSymbol} → ${debtSymbol} (NAVI Aggregator)`,
      txDigest: result.txDigest,
      gasUsed: result.gasUsed,
      timestamp: Date.now(),
    };

    // Store to Walrus
    try {
      trace.walrusBlobId = await this.walrusLogger.storeUnwindTrace(trace);
      console.log(`📜 Audit trail stored: ${trace.walrusBlobId}`);
    } catch (err: any) {
      console.error(`⚠️ Walrus store failed: ${err.message}`);
    }

    if (!result.success) {
      throw new Error(`Unwind transaction failed: ${result.error}`);
    }

    return trace;
  }
}
