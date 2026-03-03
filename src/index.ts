import { loadConfig } from './config.js';
import type { NoctuaConfig } from './config.js';
import type { ProtectionRule, DaemonState, UnwindTrace } from './types.js';
import { NaviClient } from './navi-client.js';
import { WalrusLogger } from './walrus-logger.js';
import { UnwindEngine } from './unwind-engine.js';
import { NoctuaTelegramBot } from './telegram-bot.js';
import { GeminiBrain } from './gemini-brain.js';
import { ToolHandler } from './tools.js';
import * as fs from 'fs';
import * as path from 'path';

const STATE_FILE = path.join(process.cwd(), 'noctua-state.json');
const POLL_INTERVAL_MS = 15_000;
const WALRUS_AGGREGATOR_BASE = 'https://aggregator.walrus-testnet.walrus.space/v1/blobs';

export class NoctuaDaemon {
  private config: NoctuaConfig;
  private naviClient: NaviClient;
  private walrusLogger: WalrusLogger;
  private unwindEngine: UnwindEngine;
  private telegramBot: NoctuaTelegramBot;
  private geminiBrain: GeminiBrain;
  private interval: ReturnType<typeof setInterval> | null = null;
  private state: DaemonState;
  private isProcessing = false;

  constructor(config: NoctuaConfig, rule: ProtectionRule) {
    this.config = config;
    this.naviClient = new NaviClient(config);
    this.walrusLogger = new WalrusLogger(config);
    this.unwindEngine = new UnwindEngine(this.naviClient, this.walrusLogger, config);

    // Telegram Bot
    this.telegramBot = new NoctuaTelegramBot(config);
    this.telegramBot.setPositionProvider(() => this.naviClient.getPosition());
    this.telegramBot.setStateProvider(() => this.getState());

    // Tool handler for Gemini function calling
    const toolHandler = new ToolHandler(
      this.naviClient,
      this.unwindEngine,
      this.walrusLogger,
      () => this.getState(),
      (rule) => this.updateRule(rule),
    );

    // Gemini Brain
    this.geminiBrain = new GeminiBrain(config, toolHandler);

    // Route free-text Telegram messages to Gemini
    this.telegramBot.setMessageHandler(async (chatId, text) => {
      return this.geminiBrain.chat(chatId, text);
    });

    this.state = {
      running: false,
      rule,
      lastCheck: 0,
      lastHF: 0,
      hfHistory: [],
      recentTraces: this.loadTraces(),
      telegramChatIds: this.loadChatIds(),
    };
  }

  private loadTraces(): UnwindTrace[] {
    try {
      const data = fs.readFileSync(STATE_FILE, 'utf-8');
      const saved = JSON.parse(data);
      return saved.recentTraces || [];
    } catch {
      return [];
    }
  }

  private loadChatIds(): number[] {
    try {
      const data = fs.readFileSync(STATE_FILE, 'utf-8');
      const saved = JSON.parse(data);
      return saved.telegramChatIds || [];
    } catch {
      return [];
    }
  }

  private saveState() {
    const chatIds = this.telegramBot.getChatIds();
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      running: this.state.running,
      rule: this.state.rule,
      lastCheck: this.state.lastCheck,
      lastHF: this.state.lastHF,
      hfHistory: this.state.hfHistory.slice(-20),
      recentTraces: this.state.recentTraces.slice(-20),
      telegramChatIds: chatIds,
    }, null, 2));
  }

  async start() {
    console.log(`🦉 Noctua starting...`);
    console.log(`   Address: ${this.naviClient.address}`);
    console.log(`   Trigger HF: ${this.state.rule.triggerHF}`);
    console.log(`   Target HF: ${this.state.rule.targetHF}`);
    console.log(`   Strategy: ${this.state.rule.strategy}`);
    console.log(`   Poll interval: ${POLL_INTERVAL_MS / 1000}s`);

    this.state.running = true;
    this.saveState();

    // Start Telegram bot
    await this.telegramBot.start();

    // Run first check immediately
    await this.check();

    // Start polling
    this.interval = setInterval(() => this.check(), POLL_INTERVAL_MS);

    console.log(`🦉 Monitoring active. Noctua watches while you sleep.`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.telegramBot.stop();
    this.state.running = false;
    this.saveState();
    console.log(`🦉 Noctua stopped. Sweet dreams.`);
  }

  private async check() {
    if (this.isProcessing || this.state.rule.paused) return;
    this.isProcessing = true;

    try {
      const hf = await this.naviClient.getHealthFactor();
      this.state.lastHF = hf;
      this.state.lastCheck = Date.now();

      // Track HF history for trend analysis
      this.state.hfHistory.push(hf);
      if (this.state.hfHistory.length > 20) this.state.hfHistory.shift();

      // Ask Gemini to analyze the position
      const decision = await this.geminiBrain.analyze({
        hf,
        rule: this.state.rule,
        hfHistory: this.state.hfHistory,
      });

      if (decision.shouldAct && hf > 0) {
        console.log(`🚨 Gemini says ACT: ${decision.reasoning}`);

        const snapshot = await this.naviClient.getPosition();
        const trace = await this.unwindEngine.execute(snapshot, this.state.rule);
        this.state.recentTraces.push(trace);

        // Notify via Telegram
        const msg = [
          `🦉 *Crisis Averted!*`,
          ``,
          `HF: ${trace.triggerHF.toFixed(2)} → ${trace.restoredHF.toFixed(2)}`,
          `Sold: ${trace.collateralSold.amount} ${trace.collateralSold.symbol}`,
          `Repaid: ${trace.debtRepaid.amount} ${trace.debtRepaid.symbol}`,
          `TX: \`${trace.txDigest}\``,
          trace.walrusBlobId ? `📜 [Walrus Audit](${WALRUS_AGGREGATOR_BASE}/${trace.walrusBlobId})` : '',
          ``,
          `💭 _${decision.reasoning}_`,
        ].filter(Boolean).join('\n');

        await this.telegramBot.broadcast(msg);
      } else if (decision.shouldWarn) {
        await this.telegramBot.broadcast(`⚠️ ${decision.reasoning}\n\nHF: ${hf.toFixed(4)} | Trigger: ${this.state.rule.triggerHF}`);
      }

      this.saveState();
    } catch (error: any) {
      console.error(`Check error: ${error.message}`);
      await this.telegramBot.broadcast(`❌ Noctua error: ${error.message}`).catch(() => {});
    } finally {
      this.isProcessing = false;
    }
  }

  getState(): DaemonState {
    return { ...this.state };
  }

  updateRule(rule: Partial<ProtectionRule>) {
    Object.assign(this.state.rule, rule);
    this.saveState();
    console.log(`🦉 Rule updated: trigger=${this.state.rule.triggerHF}, target=${this.state.rule.targetHF}, strategy=${this.state.rule.strategy}`);
  }
}

// When run directly as daemon
const isMainModule = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (isMainModule && process.argv.includes('--daemon')) {
  const config = loadConfig();
  const rule: ProtectionRule = {
    triggerHF: config.defaultTriggerHF,
    targetHF: config.defaultTargetHF,
    strategy: 'collateral_swap',
    paused: false,
  };

  const daemon = new NoctuaDaemon(config, rule);
  daemon.start();

  process.on('SIGINT', () => {
    daemon.stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    daemon.stop();
    process.exit(0);
  });
}
