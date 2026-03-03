import type { NoctuaConfig, DaemonState, PositionSnapshot } from './types.js';
export declare class NoctuaTelegramBot {
    private bot;
    private chatIds;
    private onMessage?;
    constructor(config: NoctuaConfig);
    /** Register handler for free-text messages (routed to Gemini) */
    setMessageHandler(handler: (chatId: number, text: string) => Promise<string>): void;
    /** Provide a function to get current position (injected by daemon) */
    private getPositionFn?;
    private getStateFn?;
    setPositionProvider(fn: () => Promise<PositionSnapshot>): void;
    setStateProvider(fn: () => DaemonState): void;
    private setupHandlers;
    /** Broadcast a message to all registered chats */
    broadcast(message: string, parseMode?: 'Markdown' | 'MarkdownV2' | undefined): Promise<void>;
    start(): Promise<void>;
    stop(): void;
    private loadChatIds;
    private saveChatIds;
    getChatIds(): number[];
}
