import { NAVISDKClient, AccountManager, pool, Sui, USDT, WETH, CETUS, vSui, haSui, NAVX, WBTC, AUSD, wUSDC, nUSDC, ETH, USDY, NS, DEEP, FDUSD, BLUE, BUCK, suiUSDT, stSUI } from 'navi-sdk';
import { getPoolsInfo, fetchCoinPrices } from 'navi-sdk';
import type { CoinInfo, PoolConfig, PoolData } from 'navi-sdk';
import type { NoctuaConfig, PositionSnapshot, AssetPosition } from './types.js';

// Map of known coins for portfolio resolution
const KNOWN_COINS: Record<string, CoinInfo> = {
  Sui, USDT, WETH, CETUS, vSui, haSui, NAVX, WBTC, AUSD, wUSDC, nUSDC, ETH, USDY, NS, DEEP, FDUSD, BLUE, BUCK, suiUSDT, stSUI,
};

// Map pool assetId to coin info for lookup
const ASSET_ID_TO_POOL: Record<number, { pool: PoolConfig; coin: CoinInfo }> = {};
for (const [key, poolConfig] of Object.entries(pool)) {
  const coin = KNOWN_COINS[key];
  if (coin) {
    ASSET_ID_TO_POOL[poolConfig.assetId] = { pool: poolConfig, coin };
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = 4, delayMs = 5000, label = 'request'): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const wait = delayMs * (i + 1); // progressive back-off: 5s, 10s, 15s, 20s
      console.log(`[Retry] ${label} failed (${err?.message ?? 'unknown error'}), retrying in ${wait / 1000}s... (attempt ${i + 2}/${retries + 1})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error(`${label} failed after ${retries + 1} attempts`);
}

// Price + LTV cache — pool data rarely changes
let priceCache: { data: Record<number, { price: number; decimal: number; liquidationThreshold: number }>; ts: number } | null = null;
const PRICE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes — oracle prices don't change that fast

// Short-term position cache — avoids duplicate fetches (e.g. /status right after poll)
let positionCache: { data: PositionSnapshot; ts: number } | null = null;
const POSITION_CACHE_TTL = 30 * 1000; // 30 seconds

export class NaviClient {
  private sdk: NAVISDKClient;
  private account: AccountManager;
  public address: string;

  constructor(config: NoctuaConfig) {
    this.sdk = new NAVISDKClient({
      privateKeyList: [config.privateKey],
      networkType: config.suiRpcUrl.includes('testnet') ? 'testnet' : 'mainnet',
      numberOfAccounts: 1,
    });
    this.account = this.sdk.accounts[0];
    this.address = this.account.address;
  }

  get client(): any {
    return this.account.client;
  }

  get keypair(): any {
    return this.account.keypair;
  }

  async getHealthFactor(address?: string): Promise<number> {
    return this.account.getHealthFactor(address || this.address);
  }

  async getPosition(address?: string): Promise<PositionSnapshot> {
    const addr = address || this.address;

    // Return short-term cache if fresh (avoids duplicate fetches within same poll cycle)
    if (!address && positionCache && (Date.now() - positionCache.ts < POSITION_CACHE_TTL)) {
      return positionCache.data;
    }

    // Fetch portfolio (single call — HF computed locally from LTV data)
    const portfolio = await withRetry(
      () => this.account.getNAVIPortfolio(addr, false),
      4, 5000, 'NAVI portfolio fetch'
    );

    // Use cached pool data or fetch fresh (prices + liquidationThreshold for HF calc)
    const needPriceRefresh = !priceCache || (Date.now() - priceCache.ts > PRICE_CACHE_TTL);
    let priceMap: Record<number, { price: number; decimal: number; liquidationThreshold: number }> = {};
    if (priceCache && !needPriceRefresh) {
      priceMap = priceCache.data;
    } else {
      try {
        const poolsData = await getPoolsInfo();
        if (poolsData) {
          for (const p of poolsData) {
            const price = p.oracle ? parseFloat(p.oracle.price) : 0;
            // ltv is stored as basis points (e.g. 8000 = 80%)
            const ltv = p.ltv ? parseInt(p.ltv) / 10000 : 0.8;
            priceMap[p.id] = {
              price,
              decimal: p.oracle ? p.oracle.decimal : 9,
              liquidationThreshold: ltv,
            };
          }
        }
        priceCache = { data: priceMap, ts: Date.now() };
        console.log(`[Price] loaded ${Object.keys(priceMap).length} pools (fresh)`);
      } catch (err: any) {
        console.error(`getPoolsInfo failed: ${err.message}, trying fetchCoinPrices...`);
        try {
          const coinTypes = Object.values(KNOWN_COINS).map(c => c.address);
          const prices = await fetchCoinPrices(coinTypes);
          if (prices) {
            for (const [sym, poolConfig] of Object.entries(pool)) {
              const coin = KNOWN_COINS[sym];
              if (!coin) continue;
              const priceEntry = prices.find((p: any) => p.coinType === coin.address);
              if (priceEntry) {
                priceMap[poolConfig.assetId] = { price: priceEntry.value, decimal: coin.decimal, liquidationThreshold: 0.8 }; // fallback ltv
              }
            }
          }
          priceCache = { data: priceMap, ts: Date.now() };
        } catch (err2: any) {
          console.error(`fetchCoinPrices also failed: ${err2.message}`);
          if (priceCache) {
            priceMap = priceCache.data;
            console.log(`[Price] using stale cache`);
          }
        }
      }
    }

    const collaterals: AssetPosition[] = [];
    const debts: AssetPosition[] = [];
    const NAVI_INTERNAL_DECIMALS = 1e9;

    // Track weighted collateral (for HF computation) and total debt
    let weightedCollateralUsd = 0;
    let totalDebtUsd = 0;

    for (const [key, balances] of portfolio) {
      const poolEntry = Object.entries(pool).find(([sym]) => sym === key);
      if (!poolEntry) continue;

      const [symbol, poolConfig] = poolEntry;
      const coin = KNOWN_COINS[symbol];
      if (!coin) continue;

      const poolData = priceMap[poolConfig.assetId];
      const price = poolData?.price || 0;
      const liquidationThreshold = poolData?.liquidationThreshold ?? 0.8;

      if (balances.supplyBalance > 0 || balances.borrowBalance > 0) {
        console.log(`[Position] ${symbol}: supply=${(balances.supplyBalance / NAVI_INTERNAL_DECIMALS).toFixed(6)}, borrow=${(balances.borrowBalance / NAVI_INTERNAL_DECIMALS).toFixed(6)}, price=$${price}`);
      }

      if (balances.supplyBalance > 0) {
        const amount = balances.supplyBalance / NAVI_INTERNAL_DECIMALS;
        const valueUsd = amount * price;
        collaterals.push({ coinType: coin.address, symbol, amount, valueUsd, decimal: coin.decimal });
        weightedCollateralUsd += valueUsd * liquidationThreshold;
      }

      if (balances.borrowBalance > 0) {
        const amount = balances.borrowBalance / NAVI_INTERNAL_DECIMALS;
        const valueUsd = amount * price;
        debts.push({ coinType: coin.address, symbol, amount, valueUsd, decimal: coin.decimal });
        totalDebtUsd += valueUsd;
      }
    }

    // Compute HF locally — no extra API call needed
    // HF = sum(collateral_usd * liquidationThreshold) / total_debt_usd
    const totalCollateralUsd = collaterals.reduce((sum, c) => sum + c.valueUsd, 0);
    const hf = totalDebtUsd > 0 ? weightedCollateralUsd / totalDebtUsd : Infinity;

    const snapshot: PositionSnapshot = {
      healthFactor: hf,
      collaterals,
      debts,
      totalCollateralUsd,
      totalDebtUsd,
      timestamp: Date.now(),
    };

    // Cache for short-term reuse (Telegram /status, consecutive poll cycles)
    if (!address) positionCache = { data: snapshot, ts: Date.now() };

    return snapshot;
  }

  getPoolConfig(symbol: string): PoolConfig | undefined {
    return pool[symbol as keyof typeof pool];
  }

  getCoinInfo(symbol: string): CoinInfo | undefined {
    return KNOWN_COINS[symbol];
  }

  getAccountManager(): AccountManager {
    return this.account;
  }
}
