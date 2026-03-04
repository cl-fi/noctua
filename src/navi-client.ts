import { NAVISDKClient, AccountManager, pool, Sui, USDT, WETH, CETUS, vSui, haSui, NAVX, WBTC, AUSD, wUSDC, nUSDC, ETH, USDY, NS, DEEP, FDUSD, BLUE, BUCK, suiUSDT, stSUI } from 'navi-sdk';
import { getPoolsInfo, fetchCoinPrices } from 'navi-sdk';
import { getAddressPortfolio } from 'navi-sdk/dist/libs/CallFunctions/index.js';
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
let priceCache: { data: Record<number, { price: number; decimal: number }>; ts: number } | null = null;
const PRICE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes — oracle prices don't change that fast

// Short-term position cache — avoids duplicate fetches (e.g. /status right after poll)
let positionCache: { data: PositionSnapshot; ts: number } | null = null;
const POSITION_CACHE_TTL = 30 * 1000; // 30 seconds

// Active token filter — discovered on first fetch, reduces 102 RPC calls → ~6
// Reset after unwind or every hour so new positions are re-discovered
let activeTokenFilter: string[] | null = null;
let tokenFilterTs = 0;
const TOKEN_FILTER_TTL = 60 * 60 * 1000; // 1 hour

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

    // Expire token filter every hour so new positions are re-discovered
    if (activeTokenFilter && (Date.now() - tokenFilterTs > TOKEN_FILTER_TTL)) {
      activeTokenFilter = null;
    }

    // Fetch portfolio + HF in parallel
    // Portfolio uses token filter if known (reduces 102 RPC calls → ~6)
    const [portfolio, hf] = await Promise.all([
      withRetry(
        () => getAddressPortfolio(addr, false, this.account.client, undefined, activeTokenFilter as any ?? undefined),
        4, 5000, 'NAVI portfolio fetch'
      ),
      withRetry(
        () => this.account.getHealthFactor(addr),
        4, 5000, 'NAVI health factor fetch'
      ),
    ]);

    // Update active token filter from non-zero balances
    const tokensWithBalance = [...portfolio.entries()]
      .filter(([, b]) => b.borrowBalance > 0 || b.supplyBalance > 0)
      .map(([sym]) => sym);
    if (tokensWithBalance.length > 0) {
      activeTokenFilter = tokensWithBalance;
      tokenFilterTs = Date.now();
    }

    // Use cached pool data or fetch fresh (prices + liquidationThreshold for HF calc)
    const needPriceRefresh = !priceCache || (Date.now() - priceCache.ts > PRICE_CACHE_TTL);
    let priceMap: Record<number, { price: number; decimal: number }> = {};
    if (priceCache && !needPriceRefresh) {
      priceMap = priceCache.data;
    } else {
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
                priceMap[poolConfig.assetId] = { price: priceEntry.value, decimal: coin.decimal };
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

    let totalDebtUsd = 0;

    for (const [key, balances] of portfolio) {
      const poolEntry = Object.entries(pool).find(([sym]) => sym === key);
      if (!poolEntry) continue;

      const [symbol, poolConfig] = poolEntry;
      const coin = KNOWN_COINS[symbol];
      if (!coin) continue;

      const poolData = priceMap[poolConfig.assetId];
      const price = poolData?.price || 0;

      if (balances.supplyBalance > 0 || balances.borrowBalance > 0) {
        console.log(`[Position] ${symbol}: supply=${(balances.supplyBalance / NAVI_INTERNAL_DECIMALS).toFixed(6)}, borrow=${(balances.borrowBalance / NAVI_INTERNAL_DECIMALS).toFixed(6)}, price=$${price}`);
      }

      if (balances.supplyBalance > 0) {
        const amount = balances.supplyBalance / NAVI_INTERNAL_DECIMALS;
        const valueUsd = amount * price;
        collaterals.push({ coinType: coin.address, symbol, amount, valueUsd, decimal: coin.decimal });
      }

      if (balances.borrowBalance > 0) {
        const amount = balances.borrowBalance / NAVI_INTERNAL_DECIMALS;
        const valueUsd = amount * price;
        debts.push({ coinType: coin.address, symbol, amount, valueUsd, decimal: coin.decimal });
        totalDebtUsd += valueUsd;
      }
    }

    const totalCollateralUsd = collaterals.reduce((sum, c) => sum + c.valueUsd, 0);

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

  // Call after an unwind so the next fetch re-discovers position state
  resetPositionCache() {
    positionCache = null;
    activeTokenFilter = null;
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
