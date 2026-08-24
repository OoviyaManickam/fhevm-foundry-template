import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, ZeroHash, type Signer } from "ethers";
import { createInstance, SepoliaConfig, type FhevmInstance } from "@zama-fhe/relayer-sdk/node";

const ABI = [
  "function getCount() view returns (bytes32)",
  "function increment(bytes32 inputEuint32, bytes inputProof)",
  "function decrement(bytes32 inputEuint32, bytes inputProof)",
] as const;

const OWNER_PRIVATE_KEY = requireEnv("OWNER_PRIVATE_KEY");
const RECIPIENT_PRIVATE_KEY = requireEnv("RECIPIENT_PRIVATE_KEY");
const SEPOLIA_RPC_URL = requireEnv("SEPOLIA_RPC_URL");
const COUNTER_ADDRESS = requireEnv("COUNTER_ADDRESS");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function section(title: string): void {
  console.log(`\n${"=".repeat(60)}\n  ${title}\n${"=".repeat(60)}`);
}

/** Encrypts `amount` as a euint32 input bound to `userAddress` + the counter contract. */
async function encryptAmount(instance: FhevmInstance, userAddress: string, amount: number) {
  const buffer = instance.createEncryptedInput(COUNTER_ADDRESS, userAddress);
  buffer.add32(amount);
  const ciphertext = await buffer.encrypt();
  return { handle: ciphertext.handles[0], proof: ciphertext.inputProof };
}

/**
 * Decrypts the current getCount() handle as `signer`. Only the address that made
 * the most recent increment/decrement call holds decrypt permission on that handle
 * (FHE.allow is granted per-handle, not per-contract) — every other address's
 * attempt will revert on the relayer side. That's expected FHEVM access control,
 * not a bug.
 */
async function decryptCount(instance: FhevmInstance, counter: Contract, signer: Signer, label: string) {
  const address = await signer.getAddress();
  const handle = (await counter.getCount()) as string;

  if (handle === ZeroHash) {
    console.log(`  ${label} (${address}) sees count: 0 (uninitialized)`);
    return 0n;
  }

  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const contractAddresses = [COUNTER_ADDRESS];
  const extraData = await instance.getExtraData();

  const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays, extraData);
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message,
  );

  const result = await instance.userDecrypt(
    [{ handle, contractAddress: COUNTER_ADDRESS }],
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    address,
    startTimestamp,
    durationDays,
    extraData,
  );

  const value = BigInt(result[handle as `0x${string}`] as string | bigint);
  console.log(`  ${label} (${address}) sees count: ${value}`);
  return value;
}

async function main() {
  section("SETUP");

  const provider = new JsonRpcProvider(SEPOLIA_RPC_URL);
  const owner = new Wallet(OWNER_PRIVATE_KEY, provider);
  const recipient = new Wallet(RECIPIENT_PRIVATE_KEY, provider);

  console.log("Owner:     ", owner.address);
  console.log("Recipient: ", recipient.address);
  console.log("Counter:   ", COUNTER_ADDRESS);

  const instance = await createInstance({
    ...SepoliaConfig,
    network: SEPOLIA_RPC_URL,
  });

  const counter = new Contract(COUNTER_ADDRESS, ABI, provider);

  section("COUNT — before");
  await decryptCount(instance, counter, owner, "Owner");

  section("INCREMENT by 7 (caller: owner)");
  {
    const { handle, proof } = await encryptAmount(instance, owner.address, 7);
    const tx = await counter.connect(owner).getFunction("increment")(handle, proof);
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  confirmed.");
  }
  await decryptCount(instance, counter, owner, "Owner");

  section("DECREMENT by 2 (caller: owner)");
  {
    const { handle, proof } = await encryptAmount(instance, owner.address, 2);
    const tx = await counter.connect(owner).getFunction("decrement")(handle, proof);
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  confirmed.");
  }
  await decryptCount(instance, counter, owner, "Owner");

  section("INCREMENT by 5 (caller: recipient)");
  {
    const { handle, proof } = await encryptAmount(instance, recipient.address, 5);
    const tx = await counter.connect(recipient).getFunction("increment")(handle, proof);
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  confirmed.");
  }
  await decryptCount(instance, counter, recipient, "Recipient");

  section("Owner tries to decrypt the same handle — should fail");
  try {
    await decryptCount(instance, counter, owner, "Owner");
  } catch (err) {
    console.log("  (expected) owner is no longer authorized for this handle:", (err as Error).message);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
