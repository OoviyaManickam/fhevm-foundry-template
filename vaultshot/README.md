# VaultShot

Confidential no-loss prize savings on ETH Sepolia, built on the Zama Protocol (fhEVM) — the
confidential-native successor to [FoggyPot](../foggypot). Instead of wrapping a plaintext ERC-20
at the vault boundary, VaultShot deposits, holds, and pays out an already-confidential ERC-7984
token (`cUSD`) the whole way through: deposit amounts, balances, and withdrawal amounts are real
ciphertexts on-chain from the moment they enter the pool, not just "encrypted internally after a
plaintext transferFrom." Draws are still provably fair and deposit-weighted using native FHE
randomness over encrypted balances; only the draw's aggregate total is ever revealed in plaintext,
never an individual balance; principal (plus any winnings) is withdrawable at any time, in a
single transaction.

## Deployed contracts (Sepolia)

| Contract | Address |
|---|---|
| MockUSDC (plaintext test token) | `0x0A284F0eEe6df90f0e24890ba8D5518656705547` |
| VaultShotToken — cUSD (confidential ERC-7984 wrapper) | `0xec33A67568e0529A88d180569E7116cFa37941B5` |
| VaultShotBalanceLedger | `0xf0a4F8FCBb57655f36b82b89eBc8932880efA53B` |
| VaultShotVault | `0x2d2641d32cbA8653EF5b096bcE1f1a1eDe19D0dc` |
| VaultShotReserve | `0xffe467520B520293222FF636Cc4D87Ab8e9d486A` |
| VaultShotPrizePool | `0x3B7008788dcF67184330C91585187840774e19C3` |
| VaultShotDrawKeeper | `0x43bB43D3aBc408A63888cFE228e976F41955fE28` |

One demo pool, 5-minute draw period, 100 cUSD prize budget per draw.

## Getting the test token

`MockUSDC` has a public faucet, 1,000 mUSDC per call, 1-hour cooldown per address:

```solidity
MockUSDC(0x0A284F0eEe6df90f0e24890ba8D5518656705547).faucet()
```

## Full cycle: wrap → deposit → draw → withdraw → unwrap

| Stage | Caller | Function(s) | What happens |
|---|---|---|---|
| Wrap | User | `MockUSDC.approve(cUSD, amount)` then `VaultShotToken.wrap(to, amount)` | Plaintext USDC in, confidential cUSD out. Anyone can wrap for any reason — this boundary is shared/generic, not VaultShot-specific, so wrapping doesn't itself signal an intent to deposit |
| Approve Vault as operator | User | `VaultShotToken.setOperator(vaultAddress, until)` | Time-bound delegation (ERC-7984's equivalent of ERC-20 `approve`) — required once before `Vault.deposit()` can pull your cUSD |
| Deposit | User | `Vault.deposit(externalEuint64 encryptedAmount, bytes inputProof)` | **Encrypt the amount client-side first** (see §2 below) — a genuine confidential transfer into the Vault, no plaintext amount anywhere in this call |
| Check balance | Anyone (read), decrypt: owner only | `Ledger.confidentialBalanceOf` / `seeConfidentialBalance` / `getEncryptedBalance` / `balanceOfEncrypted` (all aliases) | Returns a ciphertext handle for any address — decrypt your own via `userDecrypt` (§3) |
| Draw phase 1 | Admin or keeper | `PrizePool.requestDraw()` | Flags the encrypted running total as publicly decryptable, advances the schedule |
| Draw phase 2 (off-chain) | Anyone's client | `instance.publicDecrypt([totalHandle])` | Reveals the **aggregate total only** — never any individual balance — plus a KMS proof |
| Draw phase 2 (on-chain) | Admin or keeper | `PrizePool.finalizeDraw(abiEncodedTotal, decryptionProof)` | Verifies the proof, pulls the prize budget from Reserve, runs the weighted lottery, credits winners — all in ciphertext |
| Withdraw | User | `Vault.withdraw()` | **Single transaction**, no waiting, no request/finalize split — sends your full balance (principal + any winnings) back as cUSD |
| Unwrap (optional, separate) | User | `VaultShotToken.unwrap(from, to, amount)` then `finalizeUnwrap(...)` | Converts cUSD back to plaintext MockUSDC — a two-step public-decrypt round trip, entirely independent of VaultShot's own contracts |

A full working reference implementation of every step is in
[`client/src/vaultshot.ts`](client/src/vaultshot.ts):

```bash
cd client
npm install
cp .env.example .env   # fill in your keys + the addresses above
npm start
```

---

## Architecture

| Contract | Responsibility |
|---|---|
| `VaultShotToken` (cUSD) | Confidential ERC-7984 wrapper around MockUSDC, built entirely on OpenZeppelin's audited `ERC7984ERC20Wrapper`. `wrap()`/`unwrap()`/`finalizeUnwrap()` are inherited, unmodified. Shared and generic — not specific to VaultShot |
| `VaultShotVault` | Deposit/withdraw entry point. Both directions are genuine confidential transfers of cUSD — no plaintext amount ever passes through this contract. Owns the encrypted running `totalDeposits` and the single-transaction `withdraw()` |
| `VaultShotBalanceLedger` | Encrypted per-user pool share (`mapping(address => euint64)`), with four differently-named but identical balance-reader aliases plus a batch reader — see §3 |
| `VaultShotReserve` | Holds this pool's admin-funded mock yield, entirely in confidential cUSD (no separate encrypted mirror needed — the token itself is the real holding). Tracks a plaintext `availableBudget` counter fed only by the admin's own funding/payout actions, used to gate the draw's underfunded check |
| `VaultShotPrizePool` | Owns the two-phase draw lifecycle (`requestDraw()` / `finalizeDraw()`). Runs the same weighted running-sum selection loop as FoggyPot, bounded by the just-revealed aggregate total |
| `VaultShotDrawKeeper` | Chainlink Automation entry point. `checkUpkeep`/`performUpkeep` can only ever trigger phase 1 (`requestDraw`) — there's no way for that interface to wait on the off-chain `publicDecrypt` round trip needed before phase 2, so `finalizeDraw` is driven directly by client code instead |
| `MockUSDC` | Plaintext test ERC-20 with a public faucet — the one asset that ever crosses the wrap boundary |

---

## Frontend integration guide

Everything below is exactly what [`client/src/vaultshot.ts`](client/src/vaultshot.ts) does — this
section documents it standalone so you can wire up your own frontend without reading the reference
client first.

### 1. Setup

```bash
npm install @zama-fhe/relayer-sdk ethers
```

```ts
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node"; // or /web in a browser
import { JsonRpcProvider, Wallet, Contract } from "ethers";

const provider = new JsonRpcProvider(SEPOLIA_RPC_URL);
const instance = await createInstance({ ...SepoliaConfig, network: SEPOLIA_RPC_URL });
```

**Network-mismatch guard** — check this before anything else; VaultShot only exists on Sepolia:

```ts
const network = await provider.getNetwork();
if (network.chainId !== 11155111n) throw new Error("Wrong network — connect to Sepolia.");
```

### 2. Encrypting an amount (`createEncryptedInput`) — required, unlike FoggyPot

Unlike FoggyPot (where `deposit(uint64 amount)` took a plaintext argument), **every VaultShot
function that moves value takes an `externalEuint64` + input proof you build client-side.** This
is the actual "encrypt with the SDK" step:

```ts
async function encryptAmount(contractAddress: string, userAddress: string, amount: bigint) {
  const buffer = instance.createEncryptedInput(contractAddress, userAddress);
  buffer.add64(amount);
  const ciphertext = await buffer.encrypt();
  return { handle: ciphertext.handles[0], proof: ciphertext.inputProof };
}

// Depositing 100 cUSD:
const { handle, proof } = await encryptAmount(VAULT_ADDRESS, userAddress, 100n * 10n ** 6n);
await vault.connect(userSigner).deposit(handle, proof);
```

**The `contractAddress` you pass to `createEncryptedInput` must be the exact contract whose
function will call `FHE.fromExternal` on it** — `VAULT_ADDRESS` for `Vault.deposit()`,
`RESERVE_ADDRESS` for `Reserve.fund()`. Binding the ciphertext to the wrong contract address makes
the proof fail verification on-chain.

### 3. Decrypting a balance (EIP-712 `userDecrypt`) — and the helper aliases

The Ledger exposes the **same encrypted balance handle** through four differently-named functions
plus a batch reader — pick whichever reads best in your UI code, they're interchangeable:

| Function | Signature | Notes |
|---|---|---|
| `confidentialBalanceOf` | `(address account) view returns (bytes32)` | The "canonical" ERC-7984-style name |
| `seeConfidentialBalance` | `(address account) view returns (bytes32)` | Alias — identical handle |
| `getEncryptedBalance` | `(address account) view returns (bytes32)` | Alias — identical handle |
| `balanceOfEncrypted` | `(address account) view returns (bytes32)` | Alias — identical handle |
| `getEncryptedBalances` | `(address[] accounts) view returns (bytes32[])` | Batch reader — fetch several accounts in one call |

Pass a wallet address to any of these, get back a ciphertext handle, then decrypt it:

```ts
async function decryptEuint64(handle: string, contractAddress: string, signer: Signer) {
  if (handle === ethers.ZeroHash) return 0n; // never touched — decrypting would fail

  const address = await signer.getAddress();
  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const extraData = await instance.getExtraData();

  const eip712 = instance.createEIP712(keypair.publicKey, [contractAddress], startTimestamp, durationDays, extraData);
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
    eip712.message,
  );

  const result = await instance.userDecrypt(
    [{ handle, contractAddress }],
    keypair.privateKey, keypair.publicKey,
    signature.replace("0x", ""),
    [contractAddress], address, startTimestamp, durationDays, extraData,
  );
  return BigInt(result[handle as `0x${string}`]);
}

// A user checking their own pool share — pass their address, get a ciphertext, decrypt it:
const ledger = new Contract(LEDGER_ADDRESS, ["function seeConfidentialBalance(address) view returns (bytes32)"], provider);
const handle = await ledger.seeConfidentialBalance(userAddress);
const balance = await decryptEuint64(handle, LEDGER_ADDRESS, userSigner);
```

**This only works for the account that's actually allowed to see that handle.** ACL permission is
per-account — Bob signing a request for Alice's handle reverts with `UserNotAuthorizedForDecrypt`,
even with a perfectly valid signature. The same `decryptEuint64` helper also decrypts a user's
`cUSD` balance directly off the token (`CUSD_ADDRESS` as `contractAddress` instead of
`LEDGER_ADDRESS`) — useful for showing wallet balance alongside pool balance.

### 4. Functions to call, end to end

| # | Function | Who calls it | Args | Notes |
|---|---|---|---|---|
| 1 | `MockUSDC.faucet()` | Any user | — | 1,000 mUSDC, 1hr cooldown per address |
| 2 | `MockUSDC.approve(cUSD, amount)` | User | `spender, amount` | Standard ERC-20 approval before wrapping |
| 3 | `VaultShotToken.wrap(to, amount)` | User | `address to, uint256 amount` | Plaintext amount — no encryption needed for wrap |
| 4 | `VaultShotToken.setOperator(vault, until)` | User | `address operator, uint48 until` | Required once before depositing — `until = type(uint48).max` for effectively-permanent |
| 5 | `Vault.deposit(encryptedAmount, inputProof)` | User | `externalEuint64, bytes` | **Requires client-side encryption — see §2** |
| 6 | `Ledger.seeConfidentialBalance(address)` (or any alias) | Anyone (read) | `address` | Returns a ciphertext handle — decrypt with §3 |
| 7 | `PrizePool.isDrawDue()` | Anyone (read) | — | `true` once the draw window has elapsed |
| 8 | `PrizePool.requestDraw()` | **Admin or registered keeper only** | — | Phase 1: reverts `"PrizePool: not admin or keeper"` otherwise, or `"PrizePool: too early"` before the window elapses |
| 9 | *(off-chain)* `instance.publicDecrypt([totalHandle])` | Anyone's client | — | Phase 2 setup — see §5 |
| 10 | `PrizePool.finalizeDraw(abiEncodedTotal, decryptionProof)` | Admin or registered keeper | *pass through verbatim from step 9* | Phase 2: reverts `"PrizePool: no draw pending"` if phase 1 hasn't run |
| 11 | `Vault.withdraw()` | User | — | Single transaction — no request/finalize split. Reverts on a never-deposited account (uninitialized ciphertext, nothing to transfer) |
| 12 | `VaultShotToken.unwrap(from, to, encryptedAmount, inputProof)` then `finalizeUnwrap(requestId, cleartext, proof)` | User | — | Optional, separate from VaultShot's own contracts — converts cUSD back to plaintext MockUSDC |

### 5. The two-phase draw (`publicDecrypt`, then `finalizeDraw`)

Bounding the draw's random number needs a **plaintext** divisor (fhEVM has no encrypted-divisor
modulus), so the encrypted running total is revealed once per draw — in aggregate only, never any
individual balance:

```ts
let tx = await prizePool.connect(adminOrKeeperSigner).requestDraw();
const receipt = await tx.wait();

// Parse the DrawRequested event for the handle:
const event = receipt.logs
  .map((log) => { try { return prizePool.interface.parseLog(log); } catch { return null; } })
  .find((parsed) => parsed?.name === "DrawRequested");
const totalHandle = event.args.totalHandle;

const { abiEncodedClearValues, decryptionProof, clearValues } = await instance.publicDecrypt([totalHandle]);
console.log("Total deposits (aggregate only):", clearValues[totalHandle]);

tx = await prizePool.connect(adminOrKeeperSigner).finalizeDraw(abiEncodedClearValues, decryptionProof);
await tx.wait();
```

**Pass `abiEncodedClearValues` and `decryptionProof` through exactly as the SDK returns them.**
The KMS signed a specific byte layout — `finalizeDraw` verifies against those exact bytes via
`FHE.checkSignatures`; a hand-rolled re-encoding will fail signature verification.

### 6. Error handling

| Scenario | What happens | Where |
|---|---|---|
| Depositing without setting Vault as operator | `ERC7984UnauthorizedSpender(from, spender)` | `confidentialTransferFrom`'s own check, inside `deposit()` |
| Requesting a draw before the window elapses | `"PrizePool: too early"` | `requestDraw()`'s own guard |
| Requesting a draw while one is pending | `"PrizePool: draw already in progress"` | `requestDraw()`'s own guard |
| Finalizing a draw with no pending request | `"PrizePool: no draw pending"` | `finalizeDraw()`'s own guard |
| Non-admin/keeper calling `requestDraw()`/`finalizeDraw()` | `"PrizePool: not admin or keeper"` | `onlyAdminOrKeeper` modifier |
| Withdrawing with no prior deposit | Reverts (uninitialized ciphertext handle) | `withdraw()` → `token.confidentialTransfer` |
| Decrypting a handle you don't own | `UserNotAuthorizedForDecrypt(handle, address)` | Relayer/KMS ACL check, not the frontend |
| Wrong network | Thrown client-side before any call | §1 network guard |
| Non-PrizePool calling `Reserve.releaseTo()` | `"Reserve: not prize pool"` | `onlyPrizePool` modifier |
| Reserve underfunded at draw time | Draw silently skips (`DrawSkipped` event), no revert | `finalizeDraw()`'s budget check |

All covered by tests in [`test/VaultShot.t.sol`](test/VaultShot.t.sol) (22 tests, all passing).

---

## Prize tiers (public config, not encrypted)

| Tier | Share of draw budget | Winners |
|---|---|---|
| Grand | 70% | 1 |
| Minor | 30%, split evenly (10% each) | 3 |

Tier *sizes and winner counts* are plaintext — only the balance comparisons that decide *who* wins
stay encrypted.

## Winner selection

Same mechanism as FoggyPot: `FHE.rem(FHE.randEuint64(), totalDeposits)` draws one random number
bounded by the freshly-revealed plaintext total; a running-sum comparison (`FHE.lt` + `FHE.select`)
over each participant's **encrypted** balance picks whoever's cumulative weight crosses it — bigger
balance, proportionally bigger slice, proportionally higher win chance. Grand and each Minor pass
get their own balance snapshot, so a Grand winner is still eligible for a Minor prize in the same
draw.

## What stays encrypted vs. what's revealed

**Stays encrypted:** every deposit amount, every balance, every withdrawal amount, each draw's
random number, every win/lose comparison, and — until a winner personally decrypts their own
balance — who won.

**Revealed by necessity:**
- That a wrap/deposit/withdraw transaction happened, and which address sent it.
- The plaintext amount at the wrap/unwrap boundary (unavoidable — MockUSDC itself is plaintext).
  Because wrap/unwrap are shared, generic contracts usable by anyone for any reason, this doesn't
  by itself reveal *why* someone wrapped — only that they did.
- The aggregate total deposited, once per draw (never any individual balance).
- The number of participants in a draw, via `Ledger.allDepositors()`/`depositorsCount()`.
- Reserve's plaintext `availableBudget` counter — fed only by the admin's own funding/payout
  actions, so it was never secret to begin with.

## Automating draws

`VaultShotDrawKeeper` implements Chainlink's `checkUpkeep`/`performUpkeep` interface, but can only
ever trigger phase 1 (`requestDraw`) — the interface has no way to wait for the off-chain
`publicDecrypt` round trip needed before phase 2 can run. Drive both phases directly from your own
backend/keeper script, exactly as [`client/src/vaultshot.ts`](client/src/vaultshot.ts) does.

## Development

```bash
forge soldeer install
forge build
forge test -vvv                                  # 22 tests against the FHEVM mock

forge script script/DeployVaultShot.s.sol \
  --rpc-url <RPC> --account <keystore-name> --broadcast
```
