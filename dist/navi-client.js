import { NAVISDKClient, pool, Sui, USDT, WETH, CETUS, vSui, haSui, NAVX, WBTC, AUSD, wUSDC, nUSDC, ETH, USDY, NS, DEEP, FDUSD, BLUE, BUCK, suiUSDT, stSUI } from 'navi-sdk';
import { getPoolsInfo, fetchCoinPrices } from 'navi-sdk';
// Map of known coins for portfolio resolution
const KNOWN_COINS = {
    Sui, USDT, WETH, CETUS, vSui, haSui, NAVX, WBTC, AUSD, wUSDC, nUSDC, ETH, USDY, NS, DEEP, FDUSD, BLUE, BUCK, suiUSDT, stSUI,
};
// Map pool assetId to coin info for lookup
const ASSET_ID_TO_POOL = {};
for (const [key, poolConfig] of Object.entries(pool)) {
    const coin = KNOWN_COINS[key];
    if (coin) {
        ASSET_ID_TO_POOL[poolConfig.assetId] = { pool: poolConfig, coin };
    }
}
async function withRetry(fn, retries = 2, delayMs = 3000) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        }
        catch (err) {
            if (i === retries)
                throw err;
            console.log(`[Retry] attempt ${i + 1} failed, retrying in ${delayMs / 1000}s...`);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    throw new Error('unreachable');
}
// Price cache — getPoolsInfo data rarely changes, avoid hammering the API
let priceCache = null;
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
export class NaviClient {
    sdk;
    account;
    address;
    constructor(config) {
        this.sdk = new NAVISDKClient({
            privateKeyList: [config.privateKey],
            networkType: config.suiRpcUrl.includes('testnet') ? 'testnet' : 'mainnet',
            numberOfAccounts: 1,
        });
        this.account = this.sdk.accounts[0];
        this.address = this.account.address;
    }
    get client() {
        return this.account.client;
    }
    get keypair() {
        return this.account.keypair;
    }
    async getHealthFactor(address) {
        return this.account.getHealthFactor(address || this.address);
    }
    async getPosition(address) {
        const addr = address || this.address;
        // Parallel fetch: portfolio + HF + prices (if cache expired)
        const needPriceRefresh = !priceCache || (Date.now() - priceCache.ts > PRICE_CACHE_TTL);
        const [portfolio, hf] = await Promise.all([
            withRetry(() => this.account.getNAVIPortfolio(addr, false)),
            withRetry(() => this.account.getHealthFactor(addr)),
        ]);
        // Use cached prices or fetch fresh
        let priceMap = {};
        if (priceCache && !needPriceRefresh) {
            priceMap = priceCache.data;
        }
        else {
            try {
                const poolsData = await getPoolsInfo();
                if (poolsData) {
                    for (const p of poolsData) {
                        const price = p.oracle ? parseFloat(p.oracle.price) : 0;
                        priceMap[p.id] = { price, decimal: p.oracle ? p.oracle.decimal : 9 };
                    }
                }
                priceCache = { data: priceMap, ts: Date.now() };
                console.log(`[Price] loaded ${Object.keys(priceMap).length} pools (fresh)`);
            }
            catch (err) {
                console.error(`getPoolsInfo failed: ${err.message}, trying fetchCoinPrices...`);
                try {
                    const coinTypes = Object.values(KNOWN_COINS).map(c => c.address);
                    const prices = await fetchCoinPrices(coinTypes);
                    if (prices) {
                        for (const [sym, poolConfig] of Object.entries(pool)) {
                            const coin = KNOWN_COINS[sym];
                            if (!coin)
                                continue;
                            const priceEntry = prices.find((p) => p.coinType === coin.address);
                            if (priceEntry) {
                                priceMap[poolConfig.assetId] = { price: priceEntry.value, decimal: coin.decimal };
                            }
                        }
                    }
                    priceCache = { data: priceMap, ts: Date.now() };
                }
                catch (err2) {
                    console.error(`fetchCoinPrices also failed: ${err2.message}`);
                    // Use stale cache if available
                    if (priceCache) {
                        priceMap = priceCache.data;
                        console.log(`[Price] using stale cache`);
                    }
                }
            }
        }
        const collaterals = [];
        const debts = [];
        for (const [key, balances] of portfolio) {
            // Portfolio keys are symbols (e.g. "Sui", "nUSDC") — match against pool object keys
            const poolEntry = Object.entries(pool).find(([sym]) => sym === key);
            if (!poolEntry)
                continue;
            const [symbol, poolConfig] = poolEntry;
            const coin = KNOWN_COINS[symbol];
            if (!coin)
                continue;
            const price = priceMap[poolConfig.assetId]?.price || 0;
            // NAVI internally stores all balances with 1e9 precision regardless of coin decimal
            const NAVI_INTERNAL_DECIMALS = 1e9;
            if (balances.supplyBalance > 0 || balances.borrowBalance > 0) {
                console.log(`[Position] ${symbol}: supply=${(balances.supplyBalance / NAVI_INTERNAL_DECIMALS).toFixed(6)}, borrow=${(balances.borrowBalance / NAVI_INTERNAL_DECIMALS).toFixed(6)}, price=$${price}`);
            }
            if (balances.supplyBalance > 0) {
                const amount = balances.supplyBalance / NAVI_INTERNAL_DECIMALS;
                collaterals.push({
                    coinType: coin.address,
                    symbol,
                    amount,
                    valueUsd: amount * price,
                    decimal: coin.decimal,
                });
            }
            if (balances.borrowBalance > 0) {
                const amount = balances.borrowBalance / NAVI_INTERNAL_DECIMALS;
                debts.push({
                    coinType: coin.address,
                    symbol,
                    amount,
                    valueUsd: amount * price,
                    decimal: coin.decimal,
                });
            }
        }
        return {
            healthFactor: hf,
            collaterals,
            debts,
            totalCollateralUsd: collaterals.reduce((sum, c) => sum + c.valueUsd, 0),
            totalDebtUsd: debts.reduce((sum, d) => sum + d.valueUsd, 0),
            timestamp: Date.now(),
        };
    }
    getPoolConfig(symbol) {
        return pool[symbol];
    }
    getCoinInfo(symbol) {
        return KNOWN_COINS[symbol];
    }
    getAccountManager() {
        return this.account;
    }
}
//# sourceMappingURL=navi-client.js.map