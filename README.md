# Aegis

A firewall for AI agents that pay in USDC on Ethereum.

Before an agent sends money, Aegis looks at *who's getting paid* and gives one answer:

- **PAY**: looks safe, let it go
- **BLOCK**: dangerous, stop it
- **ASK_HUMAN**: not sure, ask a person

## How it decides

Aegis runs three quick checks on the recipient:

| Check | Status | What it looks at |
|-------|--------|------------------|
| **Bytecode** | real | reads the recipient's on-chain code and flags traps like `SELFDESTRUCT` |
| **Reputation** | mock | allow / deny address lists |
| **Behavior** | mock | large amount to a first-time recipient |

If a check gets alarmed or isn't sure, Aegis asks an LLM to read the raw
bytecode and give a second opinion. It runs through the Claude CLI locally
(`claude -p`), so no API key is needed. If that ever fails, Aegis just trusts
the first check, so a demo never breaks.

```
denylisted            -> BLOCK
dangerous bytecode    -> LLM checks it -> BLOCK or ASK_HUMAN
big unknown payment   -> ASK_HUMAN
all clear             -> PAY
```

## Try it

```bash
npm install
cp .env.example .env      # fill in PRIVATE_KEY, RPC_URL, GOOD_RECIPIENT
npm run balance           # check the wallet + USDC are set up
```

Use a throwaway Sepolia test wallet. `.env` is gitignored, so keys never get committed.

## The demo

```bash
npm run deploy-bad        # deploy a malicious SELFDESTRUCT contract, paste its address into .env
npm run good              # pay a normal wallet   -> PAY   -> real USDC goes out
npm run bad               # pay the bad contract  -> BLOCK -> money saved
```

It also guards the `approve` path, which is where agents usually get drained:

```bash
npm run approve-good      # approve a plain wallet    -> ASK_HUMAN (spenders are normally contracts)
npm run approve-bad       # approve the bad contract  -> BLOCK
```

The `PAY` case really settles on Sepolia:
[here's the 10 USDC transfer](https://sepolia.etherscan.io/tx/0x962f16fa26f5dc8dea26d86c67ca859dfc86df58b055536cde20458bdde9275a).
The `BLOCK` and `ASK_HUMAN` cases never send anything.

## Known limitations

- The bytecode scan is a linear opcode walk, so it over-approximates: it can
  tell you a dangerous opcode is present, not that it's reachable. The LLM
  second pass exists to sanity-check the alarms it raises.
- Reputation and behavior are mock lanes in V1 (empty lists, one amount
  threshold). The bytecode lane is the real one.
- Sepolia and USDC only.

## Built with

Node.js, [viem](https://viem.sh), Ethereum Sepolia
