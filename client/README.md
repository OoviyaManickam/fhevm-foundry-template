# Deployed Contracts (Sepolia)

| Contract | Address |
|---|---|
| `ERC7984Example` (confidential token) | `0x266A624a0138C8c55A86e55Ea4E9dB98e39B36BE` |
| `FHECounter` | `0x2B6E31f2727d0c0152219aAb295A9Ce5f21e70eb` |

## Run the demo scripts

```bash
npm install
cp .env.example .env   # fill in OWNER_PRIVATE_KEY, RECIPIENT_PRIVATE_KEY
npm run start          # ERC7984Example: mint / transfer / burn / decrypt
npm run counter        # FHECounter: increment / decrement / decrypt
```

---

# Frontend Integration Guide

Both contracts work the same way from a dApp: **encrypt inputs before sending a tx, decrypt outputs after reading them.** Plain `ethers`/`wagmi` calls handle everything else — no special RPC needed.

## 1. Setup

```bash
npm install @zama-fhe/relayer-sdk ethers
```

```ts
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/web"; // browser build
import { BrowserProvider } from "ethers";

const provider = new BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

const instance = await createInstance(SepoliaConfig); // one instance, reuse everywhere
```

## 2. Encrypting a value before calling a write function

Every "confidential" write function takes `(..., bytes32 encryptedInput, bytes inputProof)` instead of a plain number.

```ts
const input = instance.createEncryptedInput(CONTRACT_ADDRESS, await signer.getAddress());
input.add64(amount);          // add32(...) for FHECounter, add64(...) for ERC7984Example
const { handles, inputProof } = await input.encrypt();

await contract.someFunction(handles[0], inputProof, ...otherArgs);
```

## 3. Decrypting a value read from the contract

Every "confidential" read function returns a `bytes32` handle, not the real number. Decrypt it like this:

```ts
async function decrypt(handle: string, contractAddress: string) {
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
    [contractAddress], await signer.getAddress(),
    startTimestamp, durationDays, extraData,
  );

  return result[handle]; // plaintext bigint
}
```

**Important**: only the address that was last granted access (via the contract's `FHE.allow`) can decrypt a given handle — an arbitrary user calling `userDecrypt` on someone else's handle will fail. That's the whole point of FHEVM.

---

## `ERC7984Example` — functions to call

| Function | Type | Args | Notes |
|---|---|---|---|
| `name()`, `symbol()`, `contractURI()` | read | — | plain strings, no decryption needed |
| `owner()` | read | — | plain address |
| `confidentialBalanceOf(address account)` | read | `account` | returns a `bytes32` handle → decrypt as shown above |
| `confidentialMint(address to, bytes32 encryptedAmount, bytes inputProof)` | write | encrypt with `add64` | **owner only** |
| `confidentialBurn(address from, bytes32 encryptedAmount, bytes inputProof)` | write | encrypt with `add64` | **owner only** |
| `confidentialTransfer(address to, bytes32 encryptedAmount, bytes inputProof)` | write | encrypt with `add64` | callable by any holder |

## `FHECounter` — functions to call

| Function | Type | Args | Notes |
|---|---|---|---|
| `getCount()` | read | — | returns a `bytes32` handle → decrypt as shown above |
| `increment(bytes32 inputEuint32, bytes inputProof)` | write | encrypt with `add32` | anyone can call |
| `decrement(bytes32 inputEuint32, bytes inputProof)` | write | encrypt with `add32` | anyone can call |

Full working reference implementations (Node.js, not browser, but same SDK calls): [src/index.ts](src/index.ts) and [src/counter.ts](src/counter.ts).
