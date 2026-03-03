import { AccountManager } from 'navi-sdk';
import type { CoinInfo, PoolConfig } from 'navi-sdk';
import type { NoctuaConfig, PositionSnapshot } from './types.js';
export declare class NaviClient {
    private sdk;
    private account;
    address: string;
    constructor(config: NoctuaConfig);
    get client(): any;
    get keypair(): any;
    getHealthFactor(address?: string): Promise<number>;
    getPosition(address?: string): Promise<PositionSnapshot>;
    getPoolConfig(symbol: string): PoolConfig | undefined;
    getCoinInfo(symbol: string): CoinInfo | undefined;
    getAccountManager(): AccountManager;
}
