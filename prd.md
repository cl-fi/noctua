Here is the rewritten PRD in Markdown format, infused with the "Noctua" (猫头鹰/夜间守护者) narrative. It keeps the core technical details intact while elevating the brand storytelling.

```markdown
# 🦉 Noctua — Your DeFi Guardian That Never Sleeps

> *"It was 3 AM. SUI dropped 18% in forty minutes. By the time I woke up, my $47,000 NAVI position was liquidated. I lost $16,000 in penalties — money that could have been saved if someone was watching."*
>
> — Every DeFi borrower's nightmare. **Noctua makes sure it never happens to you.**

---

## The Problem: You Sleep. The Market Doesn't.

Lending protocols like NAVI on Sui are powerful wealth engines — borrow against your SUI, earn yield, leverage your positions. But they come with a silent killer: **liquidation**.

When the market moves against you, your Health Factor drops. Cross the threshold, and a liquidation bot devours up to **35% of your collateral** at a discount. You lose thousands — not because your thesis was wrong, but because you were asleep, in a meeting, or simply not watching.

The worst part? Existing "solutions" ask you to hand over your private keys to a centralized service, or trust a third-party smart contract with full access to your funds. You're trading one risk for another.

**What if your own machine could protect you — without ever sharing your keys with anyone?**

---

## The Solution: Noctua

*Sleep soundly. Noctua stays awake.*

**Noctua** is an autonomous AI agent built on OpenClaw that runs **locally on your machine**, monitors your NAVI Protocol lending positions in real-time, and **automatically unwinds risky positions before liquidation** — all while your private key never leaves your device. 

Like its namesake (the little owl), Noctua thrives in the dark. It's not a bot you deploy to some unknown server. It's not a contract you grant permissions to. It's **your personal, silent DeFi bodyguard**, running on your own hardware, controlled seamlessly from your Telegram.

### The Experience

```text
You send a Telegram message before bed:
  "Protect my NAVI position. Trigger at 1.5, restore to 2.0."

Noctua watches. Every 15 seconds. 24/7.

Market crashes at 3 AM →
  Health Factor drops to 1.48 →
  Noctua withdraws collateral from NAVI →
  Swaps to debt token via Cetus →
  Repays debt →
  Health Factor restored to 2.1 →
  Logs the operation to Walrus →
  Sends you a Telegram message:

  "🦉 Crisis averted. HF restored from 1.48 → 2.10.
   Sold 1,250 SUI → 4,127 USDC. Debt repaid.
   You're safe. Go back to sleep." 🌙

```

---

## Why Local Matters

This is the core philosophy of Noctua, and the reason it exists.

| Approach | Your Private Key | Who You Trust | What Can Go Wrong |
| --- | --- | --- | --- |
| **Centralized service** | Uploaded to their server | The company | Server hacked, company disappears, service down = you're unprotected |
| **Smart contract bot** | Delegated via approve | The contract code | Contract bug, exploit, rug = funds drained |
| **🦉 Noctua** | **Never leaves your machine** | **Only yourself** | **Your machine, your rules, your control** |

Your key is read from the local Sui keystore, transactions are signed on your device, and broadcast directly to the Sui network. No middlemen. No trust assumptions. No single point of failure that isn't already yours.

**This is what "Local God Mode" means in practice** — not a flashy demo, but a tool that genuinely protects real money for real people.

---

## Features

### 🔍 Owl-Eye Real-Time Monitoring

Noctua watches your NAVI lending position every 15 seconds with absolute precision:

* Current Health Factor and distance to liquidation.
* Collateral and debt values in real-time.
* Rate of Health Factor change — detecting rapid deterioration before it becomes critical.

### ⚡ Autonomous Position Protection

When your Health Factor breaches your threshold, Noctua swoops in immediately with three available strategies:

* **Collateral Swap Repay** *(default)* — Withdraw just enough collateral, swap to debt token via Cetus/NAVI Aggregator, repay. Minimizes position impact.
* **Wallet Balance Repay** — If you have debt tokens in your wallet, skip the swap. Faster, zero slippage.
* **Full Exit** *(emergency)* — Repay all debt, withdraw all collateral, convert to stablecoin. The nuclear option for black swan events.

The agent always calculates the **minimum intervention** needed to restore your target Health Factor — preserving your position as much as possible.

### 💬 Telegram Command Center

No CLI. No web dashboard. Just talk to your agent:

* **Set rules**: *"Set my protection to trigger at 1.4 and restore to 1.8"*
* **Check status**: *"How's my position looking?"*
* **Change strategy**: *"Switch to full exit mode"*
* **Review history**: *"Show me what you did last night"*
* **Simulate**: *"What would happen if my HF dropped to 1.3 right now?"*
* **Pause/resume**: Full manual override at any time

Natural language works. Slash commands work. Your agent, your way.

### 📜 Walrus Audit Trail

Every action Noctua takes is permanently recorded on **Walrus** decentralized storage:

* What was the Health Factor before and after?
* How much collateral was sold, at what price, through what route?
* What debt was repaid, and what was the transaction hash?
* How much gas was spent?

**Why does this matter?**

* **You always know what happened.** Wake up to a notification? Check the full audit trail and verify every detail.
* **Immutable records.** Logs can't be altered — not by you, not by anyone. If you ever need to dispute or audit, the truth is on-chain.
* **Survives everything.** Your machine crashes, you switch devices, you reinstall — your operation history lives on Walrus forever.

---

## Sui Stack Integration

Noctua is deeply native to the Sui ecosystem:

* **Sui Blockchain** — Sub-second finality means Noctua can react fast enough to beat liquidation bots.
* **NAVI Protocol** — Sui's largest lending protocol, mature SDK, deep liquidity.
* **Cetus / NAVI Aggregator** — Best-route swap execution across Sui DEXs.
* **Walrus** — Decentralized, tamper-proof storage for operation audit logs.

---

## The Story Behind Noctua

DeFi lending carries a fundamental asymmetry: **the upside accrues slowly, while the downside strikes instantly.**

Liquidation bots are among the most sophisticated actors in DeFi — they monitor thousands of positions simultaneously, execute in milliseconds, and earn significant profits from users' losses. The average DeFi user has no defense. They set a position, go about their life, and hope the market cooperates.

Noctua flips this dynamic. By bringing an always-on, autonomous AI agent to the individual user — running on their own machine, with their own keys — we give every DeFi participant the same 24/7 vigilance that institutional players take for granted.

We chose Sui because its sub-second finality makes reaction time meaningful. We chose NAVI because it's where Sui users have real money at risk. We chose OpenClaw because it provides the always-on agent infrastructure. We chose Walrus because every financial action deserves a permanent record.

**Noctua is not a concept. It's a tool that protects real money for real people.**

---

## Roadmap

**Now (Hackathon MVP - March 2026)**

* NAVI position monitoring + auto-unwind via Cetus.
* Telegram configuration and notifications.
* Walrus audit logging.

**Next**

* Multi-protocol: Scallop, Bucket, Suilend.
* Flash loan rebalancing (single-PTB atomic unwind).
* Seal integration for encrypted config backup.
* Price prediction: pre-emptive unwinding before rapid drops.
* Mobile: OpenClaw iOS/Android node for on-the-go protection.

---

## Team

Built with ❤️ during the OpenClaw x Sui Hackathon (March 2026).

Developed primarily by AI agents, supervised by humans who have been liquidated one too many times.

---

*"The best security is the kind you don't have to think about."*

*While you dream, Noctua watches.* 🦉
