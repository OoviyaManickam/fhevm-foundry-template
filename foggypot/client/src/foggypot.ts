import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, ZeroHash, type Signer } from "ethers";
import { createInstance, SepoliaConfig, type FhevmInstance } from "@zama-fhe/relayer-sdk/node";

const TOKEN_ABI = [
  "function faucet()",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const LEDGER_ABI = ["function confidentialBalanceOf(address account) view returns (bytes32)"] as const;

const VAULT_ABI = [
  "function deposit(uint64 amount)",
  "function requestWithdraw()",
  "function finalizeWithdraw(bytes abiEncodedCleartexts, bytes decryptionProof)",
  "function pendingWithdrawHandle(address) view returns (bytes32)",
  "function totalDeposits() view returns (uint64)",
] as const;

const PRIZEPOOL_ABI = [
  "function runDraw()",
  "function isDrawDue() view returns (bool)",
  "function nextDrawTime() view returns (uint256)",
  "function drawCount() view returns (uint256)",
  "function grandPrizeAmount() view returns (uint64)",
  "function minorPrizeAmount() view returns (uint64)",
] as const;

const ADMIN_PRIVATE_KEY = requireEnv("ADMIN_PRIVATE_KEY");
const ALICE_PRIVATE_KEY = requireEnv("ALICE_PRIVATE_KEY");
const BOB_PRIVATE_KEY = requireEnv("BOB_PRIVATE_KEY");
const SEPOLIA_RPC_URL = requireEnv("SEPOLIA_RPC_URL");
const TOKEN_ADDRESS = requireEnv("TOKEN_ADDRESS");
const LEDGER_ADDRESS = requireEnv("LEDGER_ADDRESS");
const VAULT_ADDRESS = requireEnv("VAULT_ADDRESS");
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
  return `${(Number(amount) / 1e6).toFixed(2)} mUSDC`;
}

/** Best-effort faucet claim — no-ops (logs) if the 1-hour cooldown hasn't elapsed yet. */
async function tryFaucet(token: Contract, signer: Signer, label: string) {
  try {
    const tx = await token.connect(signer).getFunction("faucet")();
    await tx.wait();
    console.log(`  ${label} claimed faucet.`);
  } catch {
    console.log(`  ${label} faucet on cooldown or already funded — skipping.`);
  }
}

/** Decrypts the caller's own confidentialBalanceOf via a signed userDecrypt request. */
async function decryptBalance(instance: FhevmInstance, ledger: Contract, signer: Signer, label: string) {
  const address = await signer.getAddress();
  const handle = (await ledger.confidentialBalanceOf(address)) as string;

  if (handle === ZeroHash) {
    console.log(`  ${label} (${address}) balance: 0 (uninitialized)`);
    return 0n;
  }

  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const contractAddresses = [LEDGER_ADDRESS];
  const extraData = await instance.getExtraData();

  const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays, extraData);
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message,
  );

  const result = await instance.userDecrypt(
    [{ handle, contractAddress: LEDGER_ADDRESS }],
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    address,
    startTimestamp,
    durationDays,
    extraData,
  );

  const balance = BigInt(result[handle as `0x${string}`] as string | bigint);
  console.log(`  ${label} (${address}) balance: ${fmt(balance)}`);
  return balance;
}

