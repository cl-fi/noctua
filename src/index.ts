import { loadConfig } from './config.js';
import type { NoctuaConfig } from './config.js';
import type { ProtectionRule, DaemonState, UnwindTrace } from './types.js';
import { NaviClient } from './navi-client.js';
import { WalrusLogger } from './walrus-logger.js';
import { UnwindEngine } from './unwind-engine.js';
import { NoctuaTelegramBot } from './telegram-bot.js';
import { GeminiBrain } from './gemini-brain.js';
import { ToolHandler } from './tools.js';
import { getSuiVolatility } from './price-volatility.js';
import * as fs from 'fs';
import * as path from 'path';

const STATE_FILE = path.join(process.cwd(), 'noctua-state.json');
const POLL_INTERVAL_MS = 60_000;  // 1 minute between checks
const MAX_CONSECUTIVE_ERRORS = 3; // Only notify after N consecutive failures
const CALIBRATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h recalibration
const WALRUS_AGGREGATOR_BASE = 'https://aggregator.walrus-testnet.walrus.space/v1/blobs';

export class NoctuaDaemon {
  private config: NoctuaConfig;
  private naviClient: NaviClient;
  private walrusLogger: WalrusLogger;
  private unwindEngine: UnwindEngine;
  private telegramBot: NoctuaTelegramBot;
  private geminiBrain: GeminiBrain;
  private interval: ReturnType<typeof setInterval> | null = null;
  private calibrationInterval: ReturnType<typeof setInterval> | null = null;
  private autoCalibrate: boolean;
  private state: DaemonState;
  private isProcessing = false;
  private consecutiveErrors = 0;

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

    // Auto-calibrate if trigger/target are 0 (not manually set)
    this.autoCalibrate = rule.triggerHF === 0 || rule.targetHF === 0;

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

    this.state.running = true;

    // Start Telegram bot
    await this.telegramBot.start();

    // Auto-calibrate HF thresholds if not manually set
    if (this.autoCalibrate) {
      await this.recalibrate();
    }

    console.log(`   Trigger HF: ${this.state.rule.triggerHF}`);
    console.log(`   Target HF: ${this.state.rule.targetHF}`);
    console.log(`   Strategy: ${this.state.rule.strategy}`);
    console.log(`   Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
    console.log(`   Auto-calibrate: ${this.autoCalibrate ? 'every 24h' : 'off (manual)'}`);

    this.saveState();

    // Run first check immediately
    await this.check();

    // Start polling
    this.interval = setInterval(() => this.check(), POLL_INTERVAL_MS);

    // Start 24h recalibration if auto-calibrate is on
    if (this.autoCalibrate) {
      this.calibrationInterval = setInterval(() => this.recalibrate(), CALIBRATION_INTERVAL_MS);
    }

    console.log(`🦉 Monitoring active. Noctua watches while you sleep.`);
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    if (this.calibrationInterval) { clearInterval(this.calibrationInterval); this.calibrationInterval = null; }
    this.telegramBot.stop();
    this.state.running = false;
    this.saveState();
    console.log(`🦉 Noctua stopped. Sweet dreams.`);
  }

  /**
   * Recalibrate trigger/target HF based on current market volatility + LLM reasoning.
   * Called at startup (if auto) and every 24h.
   */
  private async recalibrate() {
    console.log(`🔄 Auto-calibrating HF thresholds...`);
    try {
      const [volatility, position] = await Promise.all([
        getSuiVolatility(),
        this.naviClient.getPosition(),
      ]);

      if (!volatility) {
        console.warn(`[Calibrate] No volatility data, using defaults`);
        if (this.state.rule.triggerHF === 0) {
          this.state.rule.triggerHF = 1.5;
          this.state.rule.targetHF = 2.0;
        }
        return;
      }

      const result = await this.geminiBrain.calibrateHF(volatility, position);
      const oldTrigger = this.state.rule.triggerHF;
      const oldTarget = this.state.rule.targetHF;
      this.state.rule.triggerHF = result.triggerHF;
      this.state.rule.targetHF = result.targetHF;
      this.saveState();

      const msg = [
        `🔄 *HF Thresholds Auto-Calibrated*`,
        ``,
        oldTrigger > 0 ? `Trigger: ${oldTrigger} → ${result.triggerHF}` : `Trigger: ${result.triggerHF}`,
        oldTarget > 0 ? `Target: ${oldTarget} → ${result.targetHF}` : `Target: ${result.targetHF}`,
        ``,
        `💭 _${result.reasoning}_`,
      ].join('\n');

      console.log(`✅ Calibrated: trigger=${result.triggerHF}, target=${result.targetHF}`);
      console.log(`   Reason: ${result.reasoning}`);
      await this.telegramBot.broadcast(msg).catch(() => {});
    } catch (err: any) {
      console.error(`[Calibrate] Failed: ${err.message}`);
      // Ensure we have valid values
      if (this.state.rule.triggerHF === 0) {
        this.state.rule.triggerHF = 1.5;
        this.state.rule.targetHF = 2.0;
        console.log(`[Calibrate] Fallback to defaults: trigger=1.5, target=2.0`);
      }
    }
  }

  private async check() {
    if (this.isProcessing || this.state.rule.paused) return;
    this.isProcessing = true;

    try {
      // Single call to get both HF and position data — avoid duplicate NAVI API calls
      const snapshot = await this.naviClient.getPosition();
      const hf = snapshot.healthFactor;
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

      this.consecutiveErrors = 0; // Reset on successful check

      if (decision.shouldAct && hf > 0) {
        console.log(`🚨 Gemini says ACT: ${decision.reasoning}`);

        try {
          const trace = await this.unwindEngine.execute(snapshot, this.state.rule);
          this.state.recentTraces.push(trace);

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
        } catch (unwindErr: any) {
          console.error(`Unwind failed: ${unwindErr.message}`);
          // Only notify about unwind failures (these are critical)
          await this.telegramBot.broadcast(`⚠️ Unwind attempt failed: ${unwindErr.message}\n\nHF: ${hf.toFixed(4)}`).catch(() => {});
        }
      } else if (decision.shouldWarn) {
        await this.telegramBot.broadcast(`⚠️ ${decision.reasoning}\n\nHF: ${hf.toFixed(4)} | Trigger: ${this.state.rule.triggerHF}`);
      }

      this.saveState();
    } catch (error: any) {
      this.consecutiveErrors++;
      console.error(`Check error (${this.consecutiveErrors}): ${error.message}`);
      // Only notify after multiple consecutive failures to avoid spam
      if (this.consecutiveErrors === MAX_CONSECUTIVE_ERRORS) {
        await this.telegramBot.broadcast(`⚠️ Noctua experiencing connectivity issues (${this.consecutiveErrors} failures). Will keep retrying silently.`).catch(() => {});
      }
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
