# FoggyPot

Confidential no-loss prize savings on ETH Sepolia, built on the Zama Protocol (fhEVM). Deposits
and balances stay encrypted on-chain; draws are provably fair and deposit-weighted using native
FHE randomness; only a winner learns they won; principal is withdrawable at any time.

Recreates PoolTogether's no-loss prize savings mechanic with confidentiality as the core addition:
nobody but you can see your balance, and nobody but a winner can see who won a draw.

## Deployed contracts (Sepolia)

| Contract | Demo (5 min) | Standard (24 hr) | Long-horizon (30 day) |
|---|---|---|---|
| Ledger | `0x45eDD72d9059b5D922ACF3C59F80d68ba42e9904` | `0x45560C5D2BDc3b74bd908b6605b5b0d740642F48` | `0xD9490C9407Ebc0119e61D818704C9d01e36D2b17` |
| Vault | `0x73269f561ede441EB75b0CFFfB67DFA6037120BB` | `0x974E98E2e3572cC49b9DA6e999b4D96EEf95606a` | `0xBE76D523e78F1C8715778bcA62b6456FA4eb5b39` |
| Reserve | `0x3EcD4566A9319D57ACB74D571476F2a1A35C93F8` | `0x9b3f395fDcFeFD719e9D29a361cbA45E9b169bc2` | `0xBd46CEd1917445C64dc56E9c60c3Ad872B1f64a7` |
| PrizePool | `0x9d195FD0Ce693B6e3F8b90b173CC44d595265552` | `0x2b457CCFb2783761FB6740498752c99D12655eaF` | `0x31f2f597152a78d4cC7785BF65030Bb2ec7ea5aC` |

- **MockUSDC** (shared test token, all 3 pools): `0xf7FfF156C67208fAd613F67e808eC51B90Db6F2f`
- **DrawKeeper** (shared, all 3 pools): `0x754cb7Ed8AAbF220e3beed07989708995F4BFe1b`

### Chainlink Automation — registered, but sunset on testnet

`DrawKeeper` is registered as upkeep `79875688452929946629526248089109989419065580641520083293849504203449570863125`
against `KeeperRegistry 2.1.0` at `0x86EFBD0b6736Bed994962f9797049422A3A8E8Ad`
([automation.chain.link](https://automation.chain.link/sepolia/79875688452929946629526248089109989419065580641520083293849504203449570863125)) —
funded with LINK, auto-approved. Registration itself works because the registry contract still
accepts new upkeeps. But verified on-chain (no `UpkeepPerformed` events ever, despite the draw
condition sitting `true` for 20+ minutes with plenty of gas headroom), Chainlink's off-chain
network has stopped actually servicing testnet upkeeps — the app confirms this directly
("Chainlink Automation is being deprecated" for [CRE](https://docs.chain.link/cre)). This isn't
something more/better code fixes; it's the underlying network shutting down.

**Fallback: [`client/src/keeper-bot.ts`](client/src/keeper-bot.ts)**, a small self-hosted script
that polls `DrawKeeper.checkUpkeep()` and calls `performUpkeep()` on a timer — reusing the exact
same on-chain logic Chainlink's DON would have called, just triggered by us instead of them.
Verified live: it flipped `drawCount` 1 → 2 and emitted `UpkeepPerformed` for the first time ever.

```bash
cd client
npm run keeper                                      # one check-and-perform, then exits
MAX_TICKS=0 POLL_INTERVAL_MS=60000 npm run keeper    # runs forever, checks every 60s
```

This is exactly the admin/keeper-triggered liveness model the brief explicitly allows ("An
admin-gated function is used... with Chainlink Automation layered on top for production-style
liveness") — Automation is layered on top and correctly wired, the keeper bot is what actually
keeps it live today.

## Getting the test token

`MockUSDC` has a public faucet, 1,000 mUSDC per call, 1-hour cooldown per address:

```solidity
MockUSDC(0xf7FfF156C67208fAd613F67e808eC51B90Db6F2f).faucet()
```

## Full cycle: deposit → draw → claim → withdraw

| Stage | Caller | Function | What happens |
|---|---|---|---|
| Deposit | User | `Vault.deposit(uint64 amount)` | Pulls the plaintext ERC-20 in, encrypts the amount, credits your balance in the Ledger |
| Draw | Admin or Chainlink Automation | `PrizePool.runDraw()` | `FHE.randEuint64` + a running-sum comparison loop over all depositors picks each tier's winner(s), oblivious to everyone but the contract |
| Claim | Winner, off-chain | EIP-712 `userDecrypt` via the Zama Relayer SDK | The prize was already credited during `runDraw()`. "Claiming" is just privately decrypting your own updated balance — nobody else's screen shows anything |
| Withdraw | User | `Vault.requestWithdraw()` then `Vault.finalizeWithdraw(...)` | Two-step: your balance is marked publicly decryptable and zeroed, then (after fetching the KMS decryption proof off-chain) the real ERC-20 is sent back |

A full working reference implementation of every step — encrypt, decrypt, deposit, draw, withdraw
— is in [`client/src/foggypot.ts`](client/src/foggypot.ts). Run it with:

```bash
cd client
npm install
cp .env.example .env   # fill in your keys + the addresses above
npm run start
```

## Architecture

| Contract | Responsibility |
|---|---|
| `FoggyPotVault` | Deposit/withdraw entry point. Pulls in the plaintext ERC-20, encrypts the amount, credits the depositor via the Ledger. Owns the two-step withdraw (request + finalize) flow. |
| `FoggyPotBalanceLedger` | Encrypted per-user deposit weight (`mapping(address => euint64)`). Balance-at-draw-time only — no history, no TWAB. |
| `FoggyPotPrizePool` | Owns the draw lifecycle. `runDraw()` generates `FHE.randEuint64`, runs a per-tier running-sum comparison loop, credits winners via `FHE.select`. |
| `FoggyPotReserve` | Holds this pool's admin-funded mock yield, in the same token the pool accepts. No conversion, no cross-pool sharing. |
| `FoggyPotDrawKeeper` | Chainlink Automation entry point shared by all pools. `checkUpkeep()` finds whichever pool's window has elapsed; `performUpkeep()` calls its `runDraw()`. |
| FHEVM Executor + ACL | Protocol-level (not written here). Executor logs FHE operations as events; ACL tracks who may decrypt which ciphertext handle. |
| Coprocessor / Gateway / KMS | Off-chain Zama infrastructure. Performs the homomorphic computations, orchestrates decryption requests, threshold-decrypts only when the ACL permits it. |

Three deployments of the identical contract stack, parameterized only by `drawPeriod`: 5 minutes
(demo), 24 hours (standard), 30 days (long-horizon). Pools never interact.

### Prize tiers (public config, not encrypted)

| Tier | Share of draw budget | Winners |
|---|---|---|
| Grand | 70% | 1 |
| Minor | 30%, split evenly (10% each) | 3 |

Tier *sizes and winner counts* are plaintext — only the balance comparisons that decide *who* wins
stay encrypted. Total on-chain cost per draw scales as `(tiers × winners per tier) × depositor
count`, kept small (1 + 3) for a workable live demo.

### Winner selection, without encrypted division

fhEVM only supports division/modulus by a **plaintext** divisor, never an encrypted one. Each
pool's `Vault.totalDeposits` is deliberately tracked in plaintext — the deposited/withdrawn amount
is already momentarily public in the ERC-20 `transferFrom`/`transfer` at each entry/exit boundary
(see Leakage below), so an aggregate running total leaks nothing beyond what each transaction
already reveals. That makes `FHE.rem(FHE.randEuint64(), totalDeposits)` — modulus by a *plaintext*
divisor — exactly the primitive needed to bound the draw, with no encrypted division involved.

`runDraw()` then walks every depositor once per selection pass, accumulating a running sum and
comparing it against that one random draw via `FHE.lt`; the first participant whose cumulative
weight exceeds it wins that pass. Grand and Minor tiers each get their **own** snapshot of
balances-at-draw-time, so a Grand winner is still fully eligible for a Minor prize in the same
draw; *within* the Minor tier, each pass zeroes out its winner's weight in that tier's snapshot so
the same person can't be picked twice by the Minor tier alone.

Because a Minor tier's 2nd/3rd pass reuses the *original* `totalDeposits` bound rather than a
shrunk one (computing the true reduced sum would require knowing who was already excluded — the
exact secret being protected), a random draw can occasionally land inside an already-excluded
winner's now-zeroed slice. When that happens the pass simply finds no winner. This is deliberate
and safe, not a bug: `runDraw()` always pulls the *full* prize budget from Reserve up front (and
credits it to `Vault.totalDeposits`, since it's real tokens the Vault just received), so a missed
pass's fixed share isn't lost — it sits as extra real-token backing in the Vault rather than being
attributed to any one user's encrypted balance.

## Confidentiality & Leakage

**Stays encrypted:** individual deposit sizes, running balances, each draw's random number, every
win/lose comparison result, and — until a winner personally decrypts their own balance — who won.

**Leaks by necessity:**
- That a deposit/withdraw transaction happened, and which address sent it (wallet addresses are
  always public).
- The exact deposit amount, momentarily, in the plaintext ERC-20 `transferFrom` at the entry
  boundary.
- The exact withdrawal amount, at the moment of withdrawal, via the public-decryption callback.
- The number of participants in a draw, since on-chain loop length is observable via gas usage.

**Deliberate simplifications, stated openly:**
- Balance-at-draw-time instead of a full time-weighted average (TWAB) — the ring-buffer/binary-
  search machinery PoolTogether uses to resist flash-deposit gaming is largely redundant here,
  since an attacker can't *see* balances to time an attack in the first place.
- Admin-funded Reserve instead of a real yield-generating liquidation auction.
- Admin/Chainlink-triggered draws instead of a permissionless keeper-incentive auction — there's
  no free off-chain `isWinner()` check left to build a bot economy around, since winner selection
  had to move fully on-chain (nobody outside the contract can read encrypted balances to check for
  themselves).

## Yield mock

There's no real yield source wired up. Each pool's `Reserve` is a plain token-holding contract the
admin funds directly (`Reserve.fund(amount)`); `PrizePool.runDraw()` pulls a fixed budget from it
every draw. This is an explicit, documented stand-in for what would otherwise be a real
yield-generating strategy (lending, LP fees, etc.) feeding the Reserve continuously.

## Development

```bash
forge soldeer install
forge build
forge test -vvv                                  # 11 tests against the FHEVM mock

forge script script/DeployFoggyPot.s.sol \
  --rpc-url <RPC> --account <keystore-name> --broadcast --slow

forge script script/RegisterAutomation.s.sol \
  --rpc-url <RPC> --account <keystore-name> --broadcast   # needs DRAWKEEPER_ADDRESS env var + LINK
```

`--slow` is recommended for deployment: the script sends ~30 sequential transactions across 3
pools, and public RPC nodes can otherwise report success before every one actually lands.
