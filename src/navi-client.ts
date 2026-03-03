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
    const portfolio = await this.account.getNAVIPortfolio(addr, false);
    const hf = await this.account.getHealthFactor(addr);

    // Fetch pool data for price info
    const poolsData = await getPoolsInfo();
    const priceMap: Record<number, { price: number; decimal: number }> = {};
    if (poolsData) {
      for (const p of poolsData) {
        priceMap[p.id] = {
          price: p.oracle ? parseFloat(p.oracle.price) : 0,
          decimal: p.oracle ? p.oracle.decimal : 9,
        };
      }
    }

    const collaterals: AssetPosition[] = [];
    const debts: AssetPosition[] = [];

    for (const [key, balances] of portfolio) {
      // Find matching pool
      const poolEntry = Object.entries(pool).find(([_, pc]) => pc.name === key);
      if (!poolEntry) continue;

      const [symbol, poolConfig] = poolEntry;
      const coin = KNOWN_COINS[symbol];
      if (!coin) continue;

      const price = priceMap[poolConfig.assetId]?.price || 0;

      if (balances.supplyBalance > 0) {
        collaterals.push({
          coinType: coin.address,
          symbol,
          amount: balances.supplyBalance,
          valueUsd: balances.supplyBalance * price,
          decimal: coin.decimal,
        });
      }

      if (balances.borrowBalance > 0) {
        debts.push({
          coinType: coin.address,
          symbol,
          amount: balances.borrowBalance,
          valueUsd: balances.borrowBalance * price,
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
