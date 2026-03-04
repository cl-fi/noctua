import { Bot, Context } from 'grammy';
import type { NoctuaConfig, DaemonState, PositionSnapshot, UnwindTrace } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

const STATE_FILE = path.join(process.cwd(), 'noctua-state.json');
const WALRUS_AGGREGATOR_BASE = 'https://aggregator.walrus-testnet.walrus.space/v1/blobs';

export class NoctuaTelegramBot {
  private bot: Bot;
  private chatIds: Set<number> = new Set();
  private onMessage?: (chatId: number, text: string) => Promise<string>;

  constructor(config: NoctuaConfig) {
    this.bot = new Bot(config.telegramBotToken);
    this.loadChatIds();
    this.setupHandlers();
  }

  /** Register handler for free-text messages (routed to Gemini) */
  setMessageHandler(handler: (chatId: number, text: string) => Promise<string>) {
    this.onMessage = handler;
  }

  /** Provide a function to get current position (injected by daemon) */
  private getPositionFn?: () => Promise<PositionSnapshot>;
  private getStateFn?: () => DaemonState;

  setPositionProvider(fn: () => Promise<PositionSnapshot>) {
    this.getPositionFn = fn;
  }

  setStateProvider(fn: () => DaemonState) {
    this.getStateFn = fn;
  }

  private setupHandlers() {
    this.bot.command('start', async (ctx) => {
      const chatId = ctx.chat.id;
      this.chatIds.add(chatId);
      this.saveChatIds();
      await ctx.reply(
        '🐕 *Watchdog activated\\!*\n\n' +
        'I will monitor your NAVI position and alert you here\\.\n\n' +
        'Commands:\n' +
        '/status \\- Current position & HF\n' +
        '/history \\- Recent unwind operations\n' +
        '/rule \\- View protection rule\n' +
        '/help \\- Show all commands\n\n' +
        'Or just ask me anything in natural language\\!',
        { parse_mode: 'MarkdownV2' }
      );
    });

    this.bot.command('status', async (ctx) => {
      try {
        if (!this.getPositionFn || !this.getStateFn) {
          await ctx.reply('Daemon not initialized yet.');
          return;
        }
        const state = this.getStateFn();
        const snapshot = await this.getPositionFn();

        const lines = [
          `🐕 Watchdog Status`,
          ``,
          `Health Factor: *${snapshot.healthFactor.toFixed(4)}*`,
          `Total Collateral: $${snapshot.totalCollateralUsd.toFixed(2)}`,
          `Total Debt: $${snapshot.totalDebtUsd.toFixed(2)}`,
        ];

        if (snapshot.collaterals.length > 0) {
          lines.push('', '*Collaterals:*');
          for (const c of snapshot.collaterals) {
            lines.push(`  ${c.symbol}: ${c.amount.toFixed(4)} ($${c.valueUsd.toFixed(2)})`);
          }
        }
        if (snapshot.debts.length > 0) {
          lines.push('', '*Debts:*');
          for (const d of snapshot.debts) {
            lines.push(`  ${d.symbol}: ${d.amount.toFixed(4)} ($${d.valueUsd.toFixed(2)})`);
          }
        }

        lines.push(
          '',
          `Monitoring: ${state.running ? '✅ Active' : '❌ Stopped'}`,
          `Trigger: ${state.rule.triggerHF} | Target: ${state.rule.targetHF}`,
          `Strategy: ${state.rule.strategy}`,
        );

        await ctx.reply(lines.join('\n'));
      } catch (err: any) {
        await ctx.reply(`Error: ${err.message}`);
      }
    });

    this.bot.command('history', async (ctx) => {
      const state = this.getStateFn?.();
      if (!state || state.recentTraces.length === 0) {
        await ctx.reply('No unwind operations recorded yet.');
        return;
      }

      const traces = state.recentTraces.slice(-5);
      const lines = [`🐕 Recent Unwinds (${traces.length})\n`];

      for (const t of traces) {
        lines.push(
          `─────────────`,
          `HF: ${t.triggerHF.toFixed(2)} → ${t.restoredHF.toFixed(2)}`,
          `Sold: ${t.collateralSold.amount} ${t.collateralSold.symbol}`,
          `Repaid: ${t.debtRepaid.amount} ${t.debtRepaid.symbol}`,
          `TX: ${t.txDigest.slice(0, 16)}...`,
        );
        if (t.walrusBlobId) {
          lines.push(`📜 Walrus: ${WALRUS_AGGREGATOR_BASE}/${t.walrusBlobId}`);
        }
        lines.push(`Time: ${new Date(t.timestamp).toLocaleString()}`);
      }

      await ctx.reply(lines.join('\n'));
    });

    this.bot.command('rule', async (ctx) => {
      const state = this.getStateFn?.();
      if (!state) {
        await ctx.reply('Daemon not running.');
        return;
      }
      await ctx.reply(
        `🐕 Protection Rule\n\n` +
        `Trigger HF: ${state.rule.triggerHF}\n` +
        `Target HF: ${state.rule.targetHF}\n` +
        `Strategy: ${state.rule.strategy}\n` +
        `Status: ${state.rule.paused ? '⏸ Paused' : '▶️ Active'}`
      );
    });

    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        '🐕 Watchdog Commands\n\n' +
        '/status - Current position & Health Factor\n' +
        '/history - Recent unwind operations\n' +
        '/rule - View protection rule\n' +
        '/help - Show this help\n\n' +
        'You can also ask me anything in natural language, like:\n' +
        '"Is my position safe?"\n' +
        '"What happened last night?"\n' +
        '"Set trigger to 1.4"'
      );
    });

    // Free-text messages → Gemini Brain
    this.bot.on('message:text', async (ctx) => {
      if (!this.onMessage) {
        await ctx.reply('LLM brain not initialized yet.');
        return;
      }
      const chatId = ctx.chat.id;
      // Ensure this chat is registered
      if (!this.chatIds.has(chatId)) {
        this.chatIds.add(chatId);
        this.saveChatIds();
      }

      try {
        await ctx.replyWithChatAction('typing');
        const reply = await this.onMessage(chatId, ctx.message.text);
        // Try Markdown first, fallback to plain text if Telegram can't parse it
        try {
          await ctx.reply(reply, { parse_mode: 'Markdown' });
        } catch {
          await ctx.reply(reply);
        }
      } catch (err: any) {
        await ctx.reply(`Error: ${err.message}`);
      }
    });
  }

  /** Broadcast a message to all registered chats */
  async broadcast(message: string, parseMode: 'Markdown' | 'MarkdownV2' | undefined = 'Markdown') {
    for (const chatId of this.chatIds) {
      try {
        await this.bot.api.sendMessage(chatId, message, { parse_mode: parseMode });
      } catch {
        try {
          await this.bot.api.sendMessage(chatId, message);
        } catch (err: any) {
          console.error(`Failed to send to chat ${chatId}: ${err.message}`);
        }
      }
    }
    // Always also log to console as fallback
    console.log(`[TG] ${message.replace(/[*_`]/g, '')}`);
  }

  async start() {
    this.bot.start({
      onStart: () => console.log('🐕 Telegram bot ready'),
    });
  }

  stop() {
    this.bot.stop();
  }

  private loadChatIds() {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      if (data.telegramChatIds) {
        for (const id of data.telegramChatIds) {
          this.chatIds.add(id);
        }
      }
    } catch { /* no state file yet */ }
  }

  private saveChatIds() {
    try {
      let data: any = {};
      try {
        data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      } catch { /* empty */ }
      data.telegramChatIds = [...this.chatIds];
      fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Failed to save chat IDs: ${err.message}`);
    }
  }

  getChatIds(): number[] {
    return [...this.chatIds];
  }
}
