# Aegis

A firewall for AI agents that pay in USDC on Ethereum.

An agent about to move money is one bad address away from a drain. Aegis sits in
front of the payment, looks at *who is getting paid*, and answers one of three
things:

- **PAY** - looks safe, let it go
- **BLOCK** - dangerous, stop it
- **ASK_HUMAN** - not sure, get a person to look

There are two halves to it. An off-chain analyzer does the deep read (it pulls
the recipient's bytecode and, when something looks off, asks an LLM about it),
and an on-chain contract, `AegisGuard`, enforces the same policy at settlement
so a compromised agent can't just route around the checker.

## On Sepolia

Both contracts are verified, so you can read the source right on Etherscan.

| Contract | Address | What it is |
|----------|---------|------------|
| `AegisGuard` | [`0x022a8fdd780c72e5aa142e42c26f5343670bd6b2`](https://sepolia.etherscan.io/address/0x022a8fdd780c72e5aa142e42c26f5343670bd6b2#code) | the firewall contract - agents pay through it |
| `HoneypotVault` | [`0xfe77c1e39923c3760ec8b20e64eb4639d1d8a00e`](https://sepolia.etherscan.io/address/0xfe77c1e39923c3760ec8b20e64eb4639d1d8a00e#code) | the demo villain (see below) |

A live PAY that settled through the guard:
[10 USDC to a clean EOA](https://sepolia.etherscan.io/tx/0x6f55b66de421a3b687eca00a25a97ac9ecee43062975c5b19dad24145df5a9fe).

## How the decision is made

Three checks on the recipient, mapped onto on-chain state in the contract:

| Lane | Where it lives | What it looks at |
|------|----------------|------------------|
| Bytecode | off-chain scan + on-chain code check | reads the recipient's EVM code and flags traps like `SELFDESTRUCT`, `DELEGATECALL`, `CREATE2`, `tx.origin` |
| Reputation | on-chain `denylist` / `allowlist` | address lists (real mappings now, not a stub) |
| Behavior | on-chain daily spend cap | a rolling per-day limit, so splitting a payment doesn't dodge it |

If the bytecode scan gets alarmed or is unsure, the off-chain layer hands the raw
code to an LLM for a second opinion. It runs through the Claude CLI locally
(`claude -p`), so there's no API key to manage, and if that call ever fails the
engine just trusts the deterministic verdict - the demo never hangs on it.

```
denylisted            -> BLOCK
dangerous bytecode    -> LLM reads it -> BLOCK or ASK_HUMAN
unvetted contract     -> ASK_HUMAN / REVIEW
big unknown payment   -> ASK_HUMAN
all clear             -> PAY
```

## The AegisGuard contract

The money lives in a `treasury` address that approves the guard and nothing
else. Agents are whitelisted to *trigger* payments through `guardedPay`, but they
never hold the funds, so a leaked agent key cannot move money outside the policy.
`assess()` is a view that returns the same verdict without spending anything, and
`guardedPay` reuses it internally - so the check and the transfer happen in the
same transaction and there's no window for the recipient to change its code in
between.

A few properties worth calling out:

- deny rules run before allow rules, so the denylist always wins.
- `transferFrom(treasury, ...)` means the guard can only ever move the treasury's
  own funds, never anyone else's allowance.
- code recipients are default-REVIEW: a plain EOA passes, but a contract has to be
  vetted (allowlisted) before it can be auto-paid. Conservative on purpose.

## How the two layers connect

The off-chain analyzer and the on-chain guard are not two separate opinions that
happen to agree. They are wired together - but the two directions are not
symmetric. When the analyzer (the opcode scan plus the LLM) is confident a
recipient is malicious, it writes that verdict into the guard's own state so the
contract enforces it from then on - even for an agent that never runs the
off-chain check.

That is what `recordVerdictOnChain` in `src/guard.js` does. A contract recipient
gets blocked by *codehash* (`setBlockedCodehash`), which kills every address
running that exact bytecode, not just this one deployment. A plain wallet - or an
EIP-7702 delegated EOA, which also carries code but shares it with everyone
delegated to the same target - is denylisted by address instead. So the flow is:

```
off-chain analyzer + LLM decide BLOCK
        -> recordVerdictOnChain() writes it via an owner setter
        -> AegisGuard.assess() now returns BLOCK on its own, no off-chain call needed
```

You can watch this happen: the first `npm run guard-bad` finds the honeypot at
`REVIEW` on-chain (an unvetted contract), records its codehash, and the on-chain
verdict flips to `BLOCK` in the same run. A second run just reports it is already
blocked and sends no transaction.

The *allow* direction is deliberately not automatic in the same way. The guard
only trusts a contract it has been told about, so a first-time contract recipient
reads as `REVIEW` even when the analyzer judged it safe. In that case the CLI
(`vetThenPay`) offers to allowlist it, but never silently: it asks the owner to
confirm, and with no interactive owner present it defaults to no. Only on an
explicit yes does it call `setAllowedContract` and then pay. The reasoning is the
asymmetry of mistakes - a wrong *block* just refuses a payment (the owner undoes
it in one tx, so blocking auto-fires and fails closed), while a wrong *allow*
would let money out, so it needs a human.

Two honest notes. The y/N is human-in-the-loop UX, not the security boundary -
the owner key sits in the same process as the agent, so the real boundary is
`onlyOwner` plus the treasury only ever approving the guard. And allowlisting
trusts the address's controller, not the exact bytecode: a metamorphic redeploy
can't swap code under an allowlisted address (dead since EIP-6780), but an
upgradeable proxy can change behavior after vetting. In production the owner would
be a separate signer or multisig with a timelock; here it runs from one key so
the demo is one command.

## The demo villain

`HoneypotVault.sol` is a deliberately malicious recipient, built to look like a
friendly deposit vault. Its bytecode carries patterns from real losses:

- a swappable-logic `delegatecall` proxy plus an unprotected `selfdestruct` - the
  shape behind the Parity multisig freeze (Nov 2017, ~$280M bricked).
- an owner sweep reachable through `tx.origin`, the classic phishing anti-pattern
  that the wallet-drainer kits (Inferno / Pink Drainer) leaned on.

Aegis reads its code, sees `SELFDESTRUCT` + `DELEGATECALL` + `tx.origin`, scores
it HIGH, and the LLM confirms it as a rug/honeypot. Nothing gets sent.

## Try it

```bash
npm install
cp .env.example .env      # fill in PRIVATE_KEY, RPC_URL, GOOD_RECIPIENT
npm run balance           # check the wallet + USDC are set up
```

Use a throwaway Sepolia test wallet. `.env` is gitignored, so keys never get
committed.

The plain (off-chain-only) demo:

```bash
npm run deploy-bad        # deploy HoneypotVault, paste its address into .env as BAD_RECIPIENT
npm run good              # pay a normal wallet   -> PAY   -> real USDC goes out
npm run bad               # pay the honeypot      -> BLOCK -> money saved
npm run approve-good      # approve a plain wallet -> ASK_HUMAN (spenders are normally contracts)
npm run approve-bad       # approve the honeypot   -> BLOCK
```

The on-chain guard demo:

```bash
npm run deploy-guard      # deploy AegisGuard, paste address into .env as AEGIS_GUARD
npm run guard-setup       # treasury approves the guard + whitelists you as an agent
npm run guard-good        # pays a clean EOA through the guard -> real transfer settles
npm run guard-bad         # tries the honeypot -> BLOCK off-chain, then records its
                          #   codehash on-chain so the guard's own verdict flips
                          #   REVIEW -> BLOCK. run it again -> "already blocked".
```

## Pointing it at a recipient

The agent needs the recipient's address (and optionally an amount). Either pass it
straight in:

```bash
node src/agent.js guard 0xRecipient... 10
```

or set `GOOD_RECIPIENT` / `BAD_RECIPIENT` in `.env` and use `npm run guard-good` /
`guard-bad`. A clean EOA gets paid; a first-time contract is held at REVIEW until
you allowlist it (the CLI asks you first).

## Integrating your own agent

The whole integration is one swap - your agent calls the guard instead of moving
USDC directly:

```js
// before Aegis:
await usdc.write.transfer([recipient, amount])

// with Aegis:
import { guardedPay } from './src/guard.js'
await guardedPay(recipient, amount)   // reverts on-chain unless the policy says PAY
```

Because the enforcement lives in the contract, that single call *is* the
integration. Set it up once, as the owner:

```bash
npm run deploy-guard      # deploy AegisGuard, put its address in .env as AEGIS_GUARD
npm run guard-setup       # treasury approves the guard + whitelists your agent
```

Keep the USDC in the treasury, which approves only the guard, and whitelist your
agent's address. The agent holds a key but never the funds - that's what makes the
policy impossible to route around.

If you want a verdict before paying, `assessOnChain(recipient, amount)` is a free
read and `aegisCheck(recipient, amount)` runs the full off-chain analysis
(bytecode + LLM). Depending on your stack you can import these directly (Node/TS),
put them behind a small HTTP endpoint (other languages), or expose `guardedPay` as
the "pay" tool your LLM agent is given in place of a raw transfer.

## Tests

```bash
npm test
```

Spins up a local `anvil` node, deploys a mock USDC + the guard + the honeypot,
and drives every policy path through viem (allowed pay, non-agent rejected,
denylist, unvetted contract, codehash kill-switch, recording a block verdict
`REVIEW -> BLOCK`, allowlisting a vetted contract `REVIEW -> PAY`, daily-limit,
owner-only setters). No fork, no testnet, no keys.

## Verifying the contract on Etherscan

```bash
npm run verify-guard
```

With `ETHERSCAN_API_KEY` set it submits the Standard-JSON input over the API and
polls until it's verified. Without a key it just writes the JSON + constructor
args so you can upload them on Etherscan's Standard-JSON-Input page by hand (solc
v0.8.28, optimizer on / 200 runs, MIT). Both contracts above were verified this
way.

## Known limitations

- The bytecode scan is a linear opcode walk, so it over-approximates: it tells
  you a dangerous opcode is *present*, not that it's reachable. The LLM second
  pass is there to sanity-check the alarms.
- `code.length > 0` is treated as "must be vetted". Post-Pectra an EIP-7702
  delegated EOA also carries code, so such an EOA gets REVIEW rather than PAY -
  conservative, but worth knowing.
- The `_safeTransferFrom` path assumes a USDC-style token (returns a bool or no
  data). It's a USDC guard by design, not a universal one.
- Blocking by codehash catches exact-bytecode redeploys, but a metamorphic
  redeploy or a clone that bakes different constructor immutables into its
  runtime code will hash differently and slip past that one rule (it still hits
  the default "unvetted contract" REVIEW).
- The off-chain analyzer can write the on-chain blocklist directly, which is fine
  for a demo but is a trust boundary: the owner key lives in the same process as
  the agent, so the interactive allow-confirmation is human-in-the-loop UX, not a
  security boundary. A real deployment should make the owner a separate signer or
  multisig with a timelock. Blocking fails closed (a refused payment); allowing
  needs a human yes.
- Allowlisting trusts the recipient address's controller, not the exact bytecode
  vetted. A metamorphic redeploy can't swap code under an allowlisted address
  (dead since EIP-6780), but an upgradeable proxy keeps its address and can change
  behavior after vetting - re-vet contracts you do not control.
- Sepolia and USDC only.

## Built with

Node.js, [viem](https://viem.sh), solc, Foundry (anvil for tests), Ethereum
Sepolia.
