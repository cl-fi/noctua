# 🦉 Noctua — Your DeFi Guardian That Never Sleeps

> *While you dream, Noctua watches.*

Noctua is an autonomous AI agent built on **OpenClaw** that monitors your **NAVI Protocol** lending positions on **Sui**, uses **Gemini AI** for intelligent risk analysis, and communicates with you via **Telegram** — all running locally with your private key never leaving your device.

## The Problem

DeFi lending positions can be liquidated during market crashes, causing up to 35% collateral loss. Users lose money not because their thesis was wrong, but because they were asleep.

## The Solution

Noctua monitors your Health Factor every 15 seconds, uses **Gemini 3 Flash** to analyze trends and make intelligent decisions, and executes **atomic flash loan unwinds** via a single PTB when danger is detected:

```
Flash Loan debt tokens → Repay debt → Withdraw collateral → Swap → Repay flash loan
```

All in one atomic transaction. If any step fails, everything reverts. No partial state risk.

## Architecture

```
  Telegram (remote control & alerts)
       │
       ▼
┌──────────────────────────────────┐
│       NoctuaTelegramBot          │
│  /status /history /rule          │
│  Natural language → Gemini       │
│  Push alerts ← Monitor          │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│    Gemini Flash Brain (LLM)      │
│  Chat: function-calling tools    │
│  Monitor: structured analysis    │
│  Trend: HF history analysis      │
└──────────┬───────────────────────┘
           │ tools
           ▼
┌──────────────────────────────────┐
│        Noctua Core               │
│  NaviClient (position query)     │
│  UnwindEngine (strategy calc)    │
│  FlashloanUnwind (atomic PTB)    │
│  WalrusLogger (audit trail)      │
└──────────┬───────────────────────┘
           │
           ▼
     Sui Blockchain
  NAVI + Aggregator + Walrus
```

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-repo/noctua.git
cd noctua
npm install

# 2. Configure
cp .env.example .env
# Edit .env:
#   SUI_PRIVATE_KEY     - your Sui private key
#   TELEGRAM_BOT_TOKEN  - from @BotFather
#   GEMINI_API_KEY      - from Google AI Studio

# 3. Build
npm run build

# 4. Start (with Telegram bot + monitoring)
node dist/cli.js start --trigger 1.5 --target 2.0
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Register for alerts |
| `/status` | Current HF & position breakdown |
| `/history` | Recent unwind operations + Walrus links |
| `/rule` | View protection rule |
| Any text | Natural language chat with Gemini AI |

**Example conversations:**
- *"Is my position safe?"*
- *"What happened last night?"*
- *"Set trigger to 1.4"*
- *"Show me the audit trail for the last unwind"*

## CLI Commands

| Command | Description |
|---------|-------------|
| `noctua start --trigger 1.5 --target 2.0` | Start daemon + Telegram bot |
| `noctua stop` | Stop daemon |
| `noctua status` | Current HF, position, monitoring state |
| `noctua history` | Recent unwinds with Walrus audit trails |
| `noctua trace <blobId>` | Read full Walrus audit trace |
| `noctua set-rule --trigger 1.4` | Update protection rules |

## Gemini AI Brain

Unlike simple threshold-based bots, Noctua uses **Gemini 3 Flash** for intelligent decision-making:

- **Trend Analysis**: Tracks HF history (last 20 checks / ~5 min) to detect rapid declines
- **Smart Warnings**: Warns when HF is dropping fast, even if still above trigger
- **Natural Language**: Chat with your guardian in plain language via Telegram
- **Tool Calling**: Gemini can query positions, view history, update rules, and execute unwinds

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
- Gemini AI cannot access keys — only calls predefined tools
- Telegram bot requires `/start` registration

## Tech Stack

- TypeScript / Node.js
- navi-sdk (NAVI Protocol SDK + Aggregator)
- @mysten/sui (Sui TypeScript SDK)
- grammY (Telegram Bot)
- @google/genai (Gemini AI with function calling)
- OpenClaw (Agent framework)
- Walrus (Decentralized storage)

## License

MIT

---

*Built with ❤️ during the OpenClaw x Sui Hackathon (March 2026)*
*Developed primarily by AI agents, supervised by humans who have been liquidated one too many times.*
