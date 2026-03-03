---
name: noctua-protect
description: Configure protection rules — set trigger/target HF, change strategy, manual unwind
emoji: "⚡"
user-invocable: true
requires:
  bins: ["node"]
---

# Noctua Protect

Configure protection rules and trigger manual unwinds.

## Commands

### Set protection rule
```bash
cd /path/to/noctua && node dist/cli.js set-rule --trigger 1.5 --target 2.0 --strategy collateral_swap
```
Updates the active protection rule. Changes take effect on the next monitoring cycle.

Options:
- `--trigger <hf>` — New trigger threshold
- `--target <hf>` — New target HF
- `--strategy <s>` — New strategy (collateral_swap, wallet_repay, full_exit)
- `--pause` — Pause monitoring (keep daemon running but don't trigger)
- `--resume` — Resume monitoring

### Strategies explained
- **collateral_swap** (default): Flash loan → repay debt → withdraw collateral → swap → repay flash loan. Atomic, single transaction.
- **wallet_repay**: Use tokens already in wallet to repay debt. No swap needed, zero slippage.
- **full_exit**: Repay all debt, withdraw all collateral. Nuclear option for black swan events.

## Safety Rules
- ALWAYS confirm rule changes with the user before applying
- Warn if trigger HF is set too low (< 1.2) — very risky
- Warn if target HF is set too close to trigger — may not provide enough buffer
