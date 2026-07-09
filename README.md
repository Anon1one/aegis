# 🛡️ Aegis

**A firewall for autonomous AI agents making on-chain USDC payments on Ethereum.**

An AI agent is about to send USDC. Aegis sits in the middle, inspects *where the money
is going*, and returns one decision before the transaction fires:

- **PAY** — safe, let it through
- **BLOCK** — dangerous, stop it
- **ASK_HUMAN** — uncertain, escalate to a human

## Why it's Ethereum-native

1. **USDC** — an ERC-20 stablecoin; the payment is a real on-chain Ethereum tx.
2. **Bytecode analysis** — Aegis fetches the recipient contract's **EVM bytecode**
   (`eth_getCode`) and scans its opcodes for danger patterns before paying.
3. **Reputation (x402)** — endpoint reputation for USDC-settling payment endpoints.

## The three risk lanes

| Lane | Status | What it does |
|------|--------|--------------|
| **Bytecode** | ✅ real | `eth_getCode` → walk opcodes → flag `SELFDESTRUCT`, `DELEGATECALL`, `CALLCODE` |
| **Reputation** | 🔶 mock | allow/deny address lists (roadmap: live reputation oracle) |
| **Behavior** | 🔶 mock | amount threshold + first-time recipient → `ASK_HUMAN` |

Plus an **LLM reasoning** second pass: when a lane is alarmed or unsure, Aegis
shells out to the Claude Code CLI in headless mode (`claude -p`, no API key) to
reason over the raw bytecode and either confirm a real trap or clear a false
alarm. If the CLI is missing or errors, the engine falls back to the
deterministic verdict — the demo never breaks.

### Decision logic
```
reputation denylist                   -> BLOCK
bytecode HIGH  -> LLM reasons over it -> BLOCK (confirmed)  /  ASK_HUMAN (disputed)
large amount AND unknown recipient    -> ASK_HUMAN
otherwise                             -> PAY
```

## Setup

```bash
npm install
cp .env.example .env      # then fill in PRIVATE_KEY, RPC_URL, addresses
npm run balance           # sanity: confirm wallet + USDC address
```

Uses a **throwaway** Sepolia test wallet. `.env` is gitignored — never commit keys.

## Demo (Alice vs Bob)

```bash
npm run deploy-bad        # deploy Recipient B (a SELFDESTRUCT contract), paste addr into .env

npm run good              # Recipient A (normal EOA) -> PAY  -> real USDC transfer ✅
npm run bad               # Recipient B (malicious)  -> BLOCK -> money saved 🛡️
```

Live run on Sepolia — the `PAY` case actually settled on-chain:
[real 10 USDC transfer](https://sepolia.etherscan.io/tx/0x962f16fa26f5dc8dea26d86c67ca859dfc86df58b055536cde20458bdde9275a).
The `BLOCK` case never leaves the machine — no tx is broadcast.

## Stack
Node.js (ESM) · [viem](https://viem.sh) · Ethereum Sepolia testnet
