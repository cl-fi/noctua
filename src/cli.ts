#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from './config.js';
import { NaviClient } from './navi-client.js';
import { WalrusLogger } from './walrus-logger.js';
import { NoctuaDaemon } from './index.js';
import type { ProtectionRule, Strategy } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const program = new Command();

program
  .name('noctua')
  .description('🦉 Noctua — Your DeFi Guardian That Never Sleeps')
  .version('1.0.0');

program
  .command('start')
  .description('Start Noctua monitoring daemon')
  .option('-t, --trigger <hf>', 'Health Factor trigger threshold', parseFloat)
  .option('-g, --target <hf>', 'Health Factor target to restore', parseFloat)
  .option('-s, --strategy <strategy>', 'Protection strategy (collateral_swap, wallet_repay, full_exit)')
  .option('-d, --detach', 'Run in background')
  .action(async (opts) => {
    const config = loadConfig();

    if (opts.detach) {
      // Fork as background process
      const args = ['--daemon'];
      if (opts.trigger) args.push('--trigger', String(opts.trigger));
      if (opts.target) args.push('--target', String(opts.target));

      const child = spawn(process.execPath, [process.argv[1], ...args], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      const pidFile = path.join(process.cwd(), 'noctua.pid');
      fs.writeFileSync(pidFile, String(child.pid));

      console.log(chalk.green(`🦉 Noctua daemon started (PID: ${child.pid})`));
      return;
    }

    const rule: ProtectionRule = {
      triggerHF: opts.trigger || config.defaultTriggerHF,
      targetHF: opts.target || config.defaultTargetHF,
      strategy: (opts.strategy as Strategy) || 'collateral_swap',
      paused: false,
    };

    const daemon = new NoctuaDaemon(config, rule);
    await daemon.start();

    process.on('SIGINT', () => { daemon.stop(); process.exit(0); });
    process.on('SIGTERM', () => { daemon.stop(); process.exit(0); });
  });

program
  .command('stop')
  .description('Stop Noctua daemon')
  .action(() => {
    const pidFile = path.join(process.cwd(), 'noctua.pid');
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);
      process.kill(pid, 'SIGTERM');
      fs.unlinkSync(pidFile);
      console.log(chalk.green(`🦉 Noctua daemon stopped (PID: ${pid})`));
    } catch {
      console.log(chalk.yellow('No running Noctua daemon found.'));
    }
  });

program
  .command('status')
  .description('Check current position and monitoring status')
  .action(async () => {
    try {
      const config = loadConfig();
      const naviClient = new NaviClient(config);

      console.log(chalk.bold('\n🦉 Noctua Status\n'));
      console.log(`Address: ${chalk.cyan(naviClient.address)}`);

      // Check daemon state
      const stateFile = path.join(process.cwd(), 'noctua-state.json');
      let daemonState: any = null;
      try {
        daemonState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      } catch { /* no state file */ }

      if (daemonState) {
        console.log(`Monitoring: ${daemonState.running ? chalk.green('ACTIVE') : chalk.red('STOPPED')}`);
        console.log(`Trigger HF: ${chalk.yellow(daemonState.rule?.triggerHF)}`);
        console.log(`Target HF: ${chalk.yellow(daemonState.rule?.targetHF)}`);
        console.log(`Strategy: ${daemonState.rule?.strategy}`);
        console.log(`Last check: ${daemonState.lastCheck ? new Date(daemonState.lastCheck).toLocaleString() : 'never'}`);
        console.log(`Last HF: ${daemonState.lastHF ? chalk.bold(daemonState.lastHF.toFixed(4)) : 'unknown'}`);
      }

      // Live HF check
      console.log(chalk.dim('\nFetching live data...'));
      const snapshot = await naviClient.getPosition();

      console.log(`\n${chalk.bold('Health Factor:')} ${colorHF(snapshot.healthFactor)}`);
      console.log(`Total Collateral: ${chalk.green('$' + snapshot.totalCollateralUsd.toFixed(2))}`);
      console.log(`Total Debt: ${chalk.red('$' + snapshot.totalDebtUsd.toFixed(2))}`);

      if (snapshot.collaterals.length > 0) {
        console.log(chalk.bold('\nCollaterals:'));
        for (const c of snapshot.collaterals) {
          console.log(`  ${c.symbol}: ${c.amount.toFixed(4)} ($${c.valueUsd.toFixed(2)})`);
        }
      }

      if (snapshot.debts.length > 0) {
        console.log(chalk.bold('\nDebts:'));
        for (const d of snapshot.debts) {
          console.log(`  ${d.symbol}: ${d.amount.toFixed(4)} ($${d.valueUsd.toFixed(2)})`);
        }
      }

      if (daemonState?.rule) {
        const distance = ((snapshot.healthFactor - daemonState.rule.triggerHF) / daemonState.rule.triggerHF * 100).toFixed(1);
        console.log(`\nDistance to trigger: ${chalk.yellow(distance + '%')}`);
      }

      console.log();
    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('history')
  .description('View recent unwind operations')
  .option('-n, --count <n>', 'Number of entries to show', '10')
  .action(async (opts) => {
    const stateFile = path.join(process.cwd(), 'noctua-state.json');
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      const traces = (state.recentTraces || []).slice(-parseInt(opts.count));

      if (traces.length === 0) {
        console.log(chalk.yellow('No unwind operations recorded yet.'));
        return;
      }

      console.log(chalk.bold(`\n🦉 Recent Unwind Operations (${traces.length})\n`));

      for (const t of traces) {
        console.log(chalk.dim('─'.repeat(60)));
        console.log(`  Time: ${new Date(t.timestamp).toLocaleString()}`);
        console.log(`  HF: ${chalk.red(t.triggerHF.toFixed(4))} → ${chalk.green(t.restoredHF.toFixed(4))}`);
        console.log(`  Strategy: ${t.strategy}`);
        console.log(`  Sold: ${t.collateralSold.amount} ${t.collateralSold.symbol}`);
        console.log(`  Repaid: ${t.debtRepaid.amount} ${t.debtRepaid.symbol}`);
        console.log(`  TX: ${chalk.cyan(t.txDigest)}`);
        if (t.walrusBlobId) {
          console.log(`  Walrus: ${chalk.blue(t.walrusBlobId)}`);
        }
      }
      console.log(chalk.dim('─'.repeat(60)));
      console.log();
    } catch {
      console.log(chalk.yellow('No state file found. Start Noctua first.'));
    }
  });

program
  .command('trace <blobId>')
  .description('Read a Walrus audit trace')
  .action(async (blobId: string) => {
    try {
      const config = loadConfig();
      const logger = new WalrusLogger(config);
      const trace = await logger.readUnwindTrace(blobId);
      console.log(chalk.bold('\n📜 Walrus Audit Trace\n'));
      console.log(JSON.stringify(trace, null, 2));
    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

program
  .command('set-rule')
  .description('Update protection rule')
  .option('-t, --trigger <hf>', 'Health Factor trigger threshold', parseFloat)
  .option('-g, --target <hf>', 'Health Factor target to restore', parseFloat)
  .option('-s, --strategy <strategy>', 'Protection strategy')
  .option('-p, --pause', 'Pause monitoring')
  .option('-r, --resume', 'Resume monitoring')
  .action((opts) => {
    const stateFile = path.join(process.cwd(), 'noctua-state.json');
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      if (opts.trigger) state.rule.triggerHF = opts.trigger;
      if (opts.target) state.rule.targetHF = opts.target;
      if (opts.strategy) state.rule.strategy = opts.strategy;
      if (opts.pause) state.rule.paused = true;
      if (opts.resume) state.rule.paused = false;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      console.log(chalk.green('🦉 Rule updated:'));
      console.log(`  Trigger: ${state.rule.triggerHF}`);
      console.log(`  Target: ${state.rule.targetHF}`);
      console.log(`  Strategy: ${state.rule.strategy}`);
      console.log(`  Paused: ${state.rule.paused}`);
    } catch {
      console.log(chalk.yellow('No state file found. Start Noctua first.'));
    }
  });

function colorHF(hf: number): string {
  if (hf <= 1.1) return chalk.bgRed.white(` ${hf.toFixed(4)} `);
  if (hf <= 1.3) return chalk.red(hf.toFixed(4));
  if (hf <= 1.5) return chalk.yellow(hf.toFixed(4));
  if (hf <= 2.0) return chalk.green(hf.toFixed(4));
  return chalk.greenBright(hf.toFixed(4));
}

program.parse();
