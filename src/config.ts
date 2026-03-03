import 'dotenv/config';
import type { NoctuaConfig } from './types.js';
export type { NoctuaConfig } from './types.js';

export function loadConfig(): NoctuaConfig {
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  };

  return {
    suiRpcUrl: process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443',
    privateKey: required('SUI_PRIVATE_KEY'),
    walrusPublisherUrl: process.env.WALRUS_PUBLISHER_URL || 'https://publisher.walrus-testnet.walrus.space',
    walrusAggregatorUrl: process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space',
    walrusEpochs: parseInt(process.env.WALRUS_EPOCHS || '5', 10),
    defaultTriggerHF: parseFloat(process.env.DEFAULT_TRIGGER_HF || '1.5'),
    defaultTargetHF: parseFloat(process.env.DEFAULT_TARGET_HF || '2.0'),
  };
}
