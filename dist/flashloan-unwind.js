/**
 * Flash Loan Atomic Unwind Engine
 *
 * Executes a single-PTB atomic unwind:
 * Flash loan → repay debt → withdraw collateral → swap → repay flash loan
 *
 * Uses navi-sdk exclusively to avoid ESM/CJS dual-package issues with @mysten/sui.
 */
import { createRequire } from 'module';
import { flashloan, repayFlashLoan, repayDebt, withdrawCoin, SignAndSubmitTXB, registerStructs, swapPTB, } from 'navi-sdk';
const require = createRequire(import.meta.url);
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
export async function atomicFlashloanUnwind(params) {
    const { client, keypair, userAddress, debtPool, debtCoin, collateralPool, collateralCoin, debtAmountToRepay, collateralToWithdraw, } = params;
    try {
        registerStructs();
        // Dynamically require Transaction from navi-sdk's transitive dependency
        // to stay in the same CJS context and avoid dual-package hazard
        const { Transaction } = require('@mysten/sui/transactions');
        const tx = new Transaction();
        tx.setSender(userAddress);
        // Step 0: Update oracle prices — bypass broken Pyth check, call updateSinglePrice directly
        try {
            const { PriceFeedConfig, OracleProConfig } = require('navi-sdk/dist/address');
            const updateSinglePrice = (txb, input) => {
                txb.moveCall({
                    target: `${OracleProConfig.PackageId}::oracle_pro::update_single_price_v2`,
                    arguments: [
                        txb.object('0x6'),
                        txb.object(OracleProConfig.OracleConfig),
                        txb.object(OracleProConfig.PriceOracle),
                        txb.object(OracleProConfig.SupraOracleHolder),
                        txb.object(input.pythPriceInfoObject),
                        txb.object('0x1fa7566f40f93cdbafd5a029a231e06664219444debb59beec2fe3f19ca08b7e'),
                        txb.pure.address(input.feedId),
                    ],
                });
            };
            // Update prices for all known tokens
            for (const key of Object.keys(PriceFeedConfig)) {
                if (PriceFeedConfig[key]?.pythPriceInfoObject) {
                    updateSinglePrice(tx, PriceFeedConfig[key]);
                }
            }
            console.log(`✅ Oracle prices updated for ${Object.keys(PriceFeedConfig).length} tokens`);
        }
        catch (err) {
            console.warn(`⚠️ Oracle update failed: ${err.message}`);
        }
        // Step 1: Flash loan the debt token amount from NAVI
        const flashloanAmount = Math.ceil(debtAmountToRepay * (10 ** debtCoin.decimal));
        const [flashBalance, flashReceipt] = await flashloan(tx, debtPool, flashloanAmount);
        // Step 2: Convert flash loan Balance → Coin for repayDebt
        const [flashCoin] = tx.moveCall({
            target: '0x2::coin::from_balance',
            arguments: [flashBalance],
            typeArguments: [debtPool.type],
        });
        // Step 3: Repay the user's debt with flash-loaned tokens
        await repayDebt(tx, debtPool, flashCoin, flashloanAmount);
        // Step 4: Withdraw freed collateral
        const withdrawAmount = Math.ceil(collateralToWithdraw * (10 ** collateralCoin.decimal));
        const [withdrawnCoin] = await withdrawCoin(tx, collateralPool, withdrawAmount);
        // Step 5: Swap collateral → debt token via NAVI aggregator
        // Add 0.5% buffer for flash loan fee (0.06% current + slippage)
        const flashloanRepayAmount = Math.ceil(flashloanAmount * 1.005);
        const swappedCoin = await swapPTB(userAddress, tx, collateralCoin.address, debtCoin.address, withdrawnCoin, withdrawAmount, flashloanRepayAmount);
        // Step 6: Convert swapped Coin → Balance for flash loan repayment
        const [repayBalance] = tx.moveCall({
            target: '0x2::coin::into_balance',
            arguments: [swappedCoin],
            typeArguments: [debtPool.type],
        });
        // Step 7: Repay the flash loan — returns leftover balance that must be consumed
        const [leftoverBalance] = await repayFlashLoan(tx, debtPool, flashReceipt, repayBalance);
        // Step 8: Convert any leftover balance to coin and transfer to user (Move requires all values consumed)
        const [leftoverCoin] = tx.moveCall({
            target: '0x2::coin::from_balance',
            arguments: [leftoverBalance],
            typeArguments: [debtPool.type],
        });
        tx.transferObjects([leftoverCoin], userAddress);
        // Execute the atomic transaction (with retry for transient network failures)
        let result;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                result = await SignAndSubmitTXB(tx, client, keypair);
                break;
            }
            catch (submitErr) {
                if (attempt === 2)
                    throw submitErr;
                console.log(`⚠️ TX submit attempt ${attempt + 1} failed: ${submitErr.message}, retrying in 3s...`);
                await new Promise(r => setTimeout(r, 3000));
            }
        }
        const gasUsed = result.effects?.gasUsed
            ? (BigInt(result.effects.gasUsed.computationCost) +
                BigInt(result.effects.gasUsed.storageCost) -
                BigInt(result.effects.gasUsed.storageRebate)).toString()
            : '0';
        return {
            txDigest: result.digest,
            gasUsed,
            success: result.effects?.status?.status === 'success',
            error: result.effects?.status?.error,
        };
    }
    catch (error) {
        return {
            txDigest: '',
            gasUsed: '0',
            success: false,
            error: error.message || String(error),
        };
    }
}
//# sourceMappingURL=flashloan-unwind.js.map