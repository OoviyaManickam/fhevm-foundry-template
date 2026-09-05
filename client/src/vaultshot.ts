import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, ZeroHash, type Signer } from "ethers";
import { createInstance, SepoliaConfig, type FhevmInstance } from "@zama-fhe/relayer-sdk/node";

const USDC_ABI = [
  "function faucet()",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const CUSD_ABI = [
  "function wrap(address to, uint256 amount) returns (bytes32)",
  "function setOperator(address operator, uint48 until)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
] as const;

const LEDGER_ABI = [
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function seeConfidentialBalance(address account) view returns (bytes32)",
  "function getEncryptedBalance(address account) view returns (bytes32)",
  "function balanceOfEncrypted(address account) view returns (bytes32)",
  "function getEncryptedBalances(address[] accounts) view returns (bytes32[])",
  "function depositorsCount() view returns (uint256)",
] as const;

const VAULT_ABI = [
  "function deposit(bytes32 encryptedAmount, bytes inputProof)",
  "function withdraw()",
  "function totalDeposits() view returns (bytes32)",
] as const;

const RESERVE_ABI = [
  "function fund(bytes32 encryptedAmount, bytes inputProof, uint64 plaintextAmount)",
  "function getEncryptedBalance() view returns (bytes32)",
  "function availableBudget() view returns (uint64)",
] as const;

const PRIZEPOOL_ABI = [
  "function requestDraw() returns (bytes32)",
  "function finalizeDraw(bytes abiEncodedTotal, bytes decryptionProof)",
  "function isDrawDue() view returns (bool)",
  "function nextDrawTime() view returns (uint256)",
  "function drawCount() view returns (uint256)",
  "function stage() view returns (uint8)",
  "function grandPrizeAmount() view returns (uint64)",
  "function minorPrizeAmount() view returns (uint64)",
  "event DrawRequested(uint256 indexed drawId, bytes32 totalHandle)",
] as const;

const SEPOLIA_CHAIN_ID = 11155111n;
const RESERVE_FUNDING = 1_000n * 10n ** 6n;

const ADMIN_PRIVATE_KEY = requireEnv("ADMIN_PRIVATE_KEY");
const ALICE_PRIVATE_KEY = requireEnv("ALICE_PRIVATE_KEY");
const BOB_PRIVATE_KEY = requireEnv("BOB_PRIVATE_KEY");
const SEPOLIA_RPC_URL = requireEnv("SEPOLIA_RPC_URL");
const USDC_ADDRESS = requireEnv("USDC_ADDRESS");
const CUSD_ADDRESS = requireEnv("CUSD_ADDRESS");
const LEDGER_ADDRESS = requireEnv("LEDGER_ADDRESS");
const VAULT_ADDRESS = requireEnv("VAULT_ADDRESS");
const RESERVE_ADDRESS = requireEnv("RESERVE_ADDRESS");
const PRIZEPOOL_ADDRESS = requireEnv("PRIZEPOOL_ADDRESS");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function section(title: string): void {
  console.log(`\n${"=".repeat(60)}\n  ${title}\n${"=".repeat(60)}`);
}

function fmt(amount: bigint): string {
  return `${(Number(amount) / 1e6).toFixed(2)} cUSD`;
}

/** Encrypts `amount` as a euint64 input bound to `contractAddress` + the sending user. */
async function encryptAmount(instance: FhevmInstance, contractAddress: string, userAddress: string, amount: bigint) {
  const buffer = instance.createEncryptedInput(contractAddress, userAddress);
  buffer.add64(amount);
  const ciphertext = await buffer.encrypt();
  return { handle: ciphertext.handles[0], proof: ciphertext.inputProof };
}

/** Best-effort faucet claim — no-ops (logs) if the 1-hour cooldown hasn't elapsed yet. */
async function tryFaucet(usdc: Contract, signer: Signer, label: string) {
  try {
    const tx = await usdc.connect(signer).getFunction("faucet")();
    await tx.wait();
    console.log(`  ${label} claimed faucet.`);
  } catch {
    console.log(`  ${label} faucet on cooldown or already funded — skipping.`);
  }
}

/** EIP-712 userDecrypt for any single euint64 handle, signed by `signer`. */
async function decryptEuint64(
  instance: FhevmInstance,
  handle: string,
  contractAddress: string,
  signer: Signer,
): Promise<bigint> {
  if (handle === ZeroHash) return 0n;

  const address = await signer.getAddress();
  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const contractAddresses = [contractAddress];
  const extraData = await instance.getExtraData();

  const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays, extraData);
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message,
  );

  const result = await instance.userDecrypt(
    [{ handle, contractAddress }],
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    address,
    startTimestamp,
    durationDays,
    extraData,
  );

  return BigInt(result[handle as `0x${string}`] as string | bigint);
}

/**
 * The user-requested "give me my address, get back a ciphertext, decrypt it with the SDK" helper
 * — pass any of Ledger's balance-reader aliases, get the handle, then decrypt it. This is the
 * exact pattern client code should use to let a user check their own confidential pool share.
 */
async function seeAndDecryptBalance(
  instance: FhevmInstance,
  ledger: Contract,
  signer: Signer,
  label: string,
): Promise<bigint> {
  const address = await signer.getAddress();
  const handle = (await ledger.seeConfidentialBalance(address)) as string;
  const balance = await decryptEuint64(instance, handle, LEDGER_ADDRESS, signer);
  console.log(`  ${label} (${address}) balance: ${handle === ZeroHash ? "0 (uninitialized)" : fmt(balance)}`);
  return balance;
}

async function main() {
  // wired up in the next commit
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
