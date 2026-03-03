import type { UnwindTrace, PositionSnapshot } from './types.js';
export declare function notifyUnwind(trace: UnwindTrace): void;
export declare function notifyWarning(snapshot: PositionSnapshot, triggerHF: number): void;
export declare function notifyError(error: string): void;
export declare function notifyStatus(hf: number, rule: {
    triggerHF: number;
    targetHF: number;
    paused: boolean;
}): void;
