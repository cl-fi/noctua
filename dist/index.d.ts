import type { NoctuaConfig } from './config.js';
import type { ProtectionRule, DaemonState } from './types.js';
export declare class NoctuaDaemon {
    private config;
    private naviClient;
    private walrusLogger;
    private unwindEngine;
    private telegramBot;
    private geminiBrain;
    private interval;
    private calibrationInterval;
    private autoCalibrate;
    private state;
    private isProcessing;
    private consecutiveErrors;
    constructor(config: NoctuaConfig, rule: ProtectionRule);
    private loadTraces;
    private loadChatIds;
    private saveState;
    start(): Promise<void>;
    stop(): void;
    /**
     * Recalibrate trigger/target HF based on current market volatility + LLM reasoning.
     * Called at startup (if auto) and every 24h.
     */
    private recalibrate;
    private check;
    getState(): DaemonState;
    updateRule(rule: Partial<ProtectionRule>): void;
}
