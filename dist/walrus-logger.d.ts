import type { NoctuaConfig } from './config.js';
import type { UnwindTrace } from './types.js';
export declare class WalrusLogger {
    private config;
    constructor(config: NoctuaConfig);
    storeUnwindTrace(trace: UnwindTrace): Promise<string>;
    readUnwindTrace(blobId: string): Promise<UnwindTrace>;
}
