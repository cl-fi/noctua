import { loadConfig } from './config.js';
import type { NoctuaConfig } from './config.js';
import type { ProtectionRule, DaemonState, UnwindTrace } from './types.js';
import { NaviClient } from './navi-client.js';
import { WalrusLogger } from './walrus-logger.js';
import { UnwindEngine } from './unwind-engine.js';
import { notifyUnwind, notifyWarning, notifyError, notifyStatus } from './notification.js';
import * as fs from 'fs';
import * as path from 'path';

const STATE_FILE = path.join(process.cwd(), 'noctua-state.json');
const POLL_INTERVAL_MS = 15_000;

export class NoctuaDaemon {
  private config: NoctuaConfig;
  private naviClient: NaviClient;
  private walrusLogger: WalrusLogger;
  private unwindEngine: UnwindEngine;
  private interval: ReturnType<typeof setInterval> | null = null;
  private state: DaemonState;
  private isProcessing = false;

  constructor(config: NoctuaConfig, rule: ProtectionRule) {
    this.config = config;
    this.naviClient = new NaviClient(config);
    this.walrusLogger = new WalrusLogger(config);
    this.unwindEngine = new UnwindEngine(this.naviClient, this.walrusLogger, config);
    this.state = {
      running: false,
      rule,
      lastCheck: 0,
      lastHF: 0,
      recentTraces: this.loadTraces(),
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

  private saveState() {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      running: this.state.running,
      rule: this.state.rule,
      lastCheck: this.state.lastCheck,
      lastHF: this.state.lastHF,
      recentTraces: this.state.recentTraces.slice(-20), // keep last 20
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

      // Warning zone: within 20% of trigger
      if (hf <= this.state.rule.triggerHF * 1.2 && hf > this.state.rule.triggerHF) {
        notifyWarning(
          { healthFactor: hf, collaterals: [], debts: [], totalCollateralUsd: 0, totalDebtUsd: 0, timestamp: Date.now() },
          this.state.rule.triggerHF
        );
      }

      // Trigger zone: HF below threshold
      if (hf <= this.state.rule.triggerHF && hf > 0) {
        console.log(`🚨 HF ${hf.toFixed(4)} breached trigger ${this.state.rule.triggerHF}! Executing unwind...`);

        const snapshot = await this.naviClient.getPosition();
        const trace = await this.unwindEngine.execute(snapshot, this.state.rule);

        this.state.recentTraces.push(trace);
        notifyUnwind(trace);
      }

      this.saveState();
    } catch (error: any) {
      notifyError(error.message || String(error));
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
