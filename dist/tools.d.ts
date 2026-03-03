import type { FunctionDeclaration } from '@google/genai';
import type { NaviClient } from './navi-client.js';
import type { UnwindEngine } from './unwind-engine.js';
import type { WalrusLogger } from './walrus-logger.js';
import type { DaemonState, ProtectionRule } from './types.js';
/** Gemini function declarations for Noctua tools */
export declare const NOCTUA_TOOLS: FunctionDeclaration[];
/** Tool call handler — executes the actual function and returns result as string */
export declare class ToolHandler {
    private naviClient;
    private unwindEngine;
    private walrusLogger;
    private getState;
    private updateRule;
    constructor(naviClient: NaviClient, unwindEngine: UnwindEngine, walrusLogger: WalrusLogger, getState: () => DaemonState, updateRule: (rule: Partial<ProtectionRule>) => void);
    handle(name: string, args: Record<string, any>): Promise<string>;
}
