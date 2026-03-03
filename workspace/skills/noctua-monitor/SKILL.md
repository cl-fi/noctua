---
name: noctua-monitor
description: Start/stop Noctua position monitoring, check health factor status
emoji: "🦉"
user-invocable: true
requires:
  bins: ["node"]
---

# Noctua Monitor

Control the Noctua DeFi guardian daemon.

## Commands

### Start monitoring
```bash
cd /path/to/noctua && node dist/cli.js start --trigger 1.5 --target 2.0
```
Starts the position monitor. Checks Health Factor every 15 seconds and auto-unwinds if HF drops below trigger.

Options:
- `--trigger <hf>` — Health Factor threshold to trigger protection (default: 1.5)
- `--target <hf>` — Health Factor to restore after unwind (default: 2.0)
- `--strategy <s>` — Protection strategy: collateral_swap, wallet_repay, full_exit (default: collateral_swap)
- `--detach` — Run in background

### Stop monitoring
```bash
cd /path/to/noctua && node dist/cli.js stop
```
Gracefully stops the Noctua daemon.

### Check status
```bash
cd /path/to/noctua && node dist/cli.js status
```
Shows: current Health Factor, collateral/debt breakdown, monitoring state, distance to trigger.

## Safety Rules
- NEVER start monitoring without confirming the trigger and target HF with the user
- ALWAYS check current HF before starting to ensure the position isn't already in danger
- Report the wallet address and current position summary when starting
