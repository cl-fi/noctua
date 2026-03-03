# 🦉 Noctua — Your DeFi Guardian That Never Sleeps

> *While you dream, Noctua watches.*

Noctua is an autonomous AI agent built on **OpenClaw** that monitors your **NAVI Protocol** lending positions on **Sui** and automatically unwinds risky positions before liquidation — all running locally with your private key never leaving your device.

## The Problem

DeFi lending positions can be liquidated during market crashes, causing up to 35% collateral loss. Users lose money not because their thesis was wrong, but because they were asleep.

## The Solution

Noctua monitors your Health Factor every 15 seconds and executes **atomic flash loan unwinds** via a single Programmable Transaction Block (PTB) when danger is detected:

```
Flash Loan debt tokens → Repay debt → Withdraw collateral → Swap → Repay flash loan
```

All in one atomic transaction. If any step fails, everything reverts. No partial state risk.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                  │
│         (Telegram / Discord / WhatsApp)              │
├──────────┬──────────┬───────────────────────────────┤
│ SOUL.md  │HEARTBEAT │     OpenClaw Skills           │
│ (Persona)│ (5 min)  │ monitor / protect / history   │
├──────────┴──────────┴───────────────────────────────┤
│                  Noctua Daemon                       │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  Monitor    │  │ Unwind Engine│  │ Walrus      │ │
│  │  (15s poll) │→ │ (HF calc +   │→ │ Logger      │ │
│  │             │  │  strategy)   │  │ (audit)     │ │
│  └────────────┘  └──────┬───────┘  └─────────────┘ │
│                         │                           │
│              ┌──────────▼───────────┐               │
│              │  Flash Loan Unwind   │               │
│              │  (Single PTB Atomic) │               │
│              └──────────┬───────────┘               │
│                         │                           │
├─────────────────────────▼───────────────────────────┤
│                    Sui Blockchain                    │
│         NAVI Protocol  │  NAVI Aggregator            │
│         (Lending)      │  (DEX Swap)                 │
└─────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-repo/noctua.git
cd noctua
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your SUI_PRIVATE_KEY

# 3. Build
npm run build

# 4. Start monitoring
node dist/cli.js start --trigger 1.5 --target 2.0

# 5. Check status
node dist/cli.js status

# 6. View history
node dist/cli.js history
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `noctua start --trigger 1.5 --target 2.0` | Start monitoring daemon |
| `noctua stop` | Stop daemon |
| `noctua status` | Current HF, position breakdown, monitoring state |
| `noctua history` | Recent unwind operations with Walrus audit trails |
| `noctua trace <blobId>` | Read full audit trace from Walrus |
| `noctua set-rule --trigger 1.4 --target 1.8` | Update protection rules |

## OpenClaw Integration

Noctua runs as an OpenClaw agent with 3 skills:

- **noctua-monitor** 🦉 — Start/stop monitoring, check status
- **noctua-protect** ⚡ — Configure protection rules, manual unwind
- **noctua-history** 📜 — View past operations, Walrus audit trails

Talk to Noctua naturally via Telegram:
- *"Protect my NAVI position. Trigger at 1.5, target 2.0"*
- *"How's my position looking?"*
- *"Show me what you did last night"*

## Sui Stack Integration

| Component | Usage |
|-----------|-------|
| **Sui Blockchain** | Sub-second finality for fast reactions |
| **NAVI Protocol** | Lending position monitoring + flash loans |
| **NAVI Aggregator** | Best-route DEX swap execution |
| **Walrus** | Immutable, decentralized audit trail storage |

## Why Flash Loan Unwind?

Traditional multi-step unwind (withdraw → swap → repay) has a critical flaw: if the swap fails after withdrawal, your position is **worse** than before. Flash loan atomic unwind solves this:

1. **Atomic**: All-or-nothing. Either the entire unwind succeeds or nothing happens.
2. **Capital efficient**: No need to hold debt tokens in wallet.
3. **Faster**: Single transaction vs. multiple sequential transactions.
4. **Safer**: Zero partial state risk.

## Security

- Private keys **never leave your machine**
- All transactions signed locally
- Every action logged to Walrus (immutable audit trail)
- OpenClaw skill safety rules prevent unauthorized operations

## Tech Stack

- TypeScript / Node.js
- navi-sdk (NAVI Protocol SDK + Aggregator)
- @mysten/sui (Sui TypeScript SDK)
- OpenClaw (Agent framework)
- Walrus (Decentralized storage)
- Commander (CLI)

## License

MIT

---

*Built with ❤️ during the OpenClaw x Sui Hackathon (March 2026)*
*Developed primarily by AI agents, supervised by humans who have been liquidated one too many times.*
