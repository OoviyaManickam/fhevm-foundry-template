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

const SEPOLIA_CHAIN_ID = 11155111n;

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

async function main() {
  section("SETUP");

  const provider = new JsonRpcProvider(SEPOLIA_RPC_URL);

  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Network mismatch: SEPOLIA_RPC_URL points at chain ${network.chainId}, expected Sepolia (${SEPOLIA_CHAIN_ID}). ` +
        `FoggyPot is only deployed on Sepolia — check your .env.`,
    );
  }

  const admin = new Wallet(ADMIN_PRIVATE_KEY, provider);
  const alice = new Wallet(ALICE_PRIVATE_KEY, provider);
  const bob = new Wallet(BOB_PRIVATE_KEY, provider);

  console.log("Admin:    ", admin.address);
  console.log("Alice:    ", alice.address);
  console.log("Bob:      ", bob.address);
  console.log("Token:    ", TOKEN_ADDRESS);
  console.log("Ledger:   ", LEDGER_ADDRESS);
  console.log("Vault:    ", VAULT_ADDRESS);
  console.log("PrizePool:", PRIZEPOOL_ADDRESS);

  const instance = await createInstance({ ...SepoliaConfig, network: SEPOLIA_RPC_URL });

  const token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, provider);
  const ledger = new Contract(LEDGER_ADDRESS, LEDGER_ABI, provider);
  const vault = new Contract(VAULT_ADDRESS, VAULT_ABI, provider);
  const prizePool = new Contract(PRIZEPOOL_ADDRESS, PRIZEPOOL_ABI, provider);

  section("FAUCET");
  await tryFaucet(token, alice, "Alice");
  await tryFaucet(token, bob, "Bob");
  console.log("  Alice mUSDC balance:", fmt(await token.balanceOf(alice.address)));
  console.log("  Bob   mUSDC balance:", fmt(await token.balanceOf(bob.address)));

  section("DEPOSIT — plaintext amount, no encryption needed here");
  {
    const aliceAmount = 100n * 10n ** 6n;
    const bobAmount = 50n * 10n ** 6n;

    let tx = await token.connect(alice).getFunction("approve")(VAULT_ADDRESS, aliceAmount);
    await tx.wait();
    tx = await vault.connect(alice).getFunction("deposit")(aliceAmount);
    console.log("  Alice deposit tx:", tx.hash);
    await tx.wait();

    tx = await token.connect(bob).getFunction("approve")(VAULT_ADDRESS, bobAmount);
    await tx.wait();
    tx = await vault.connect(bob).getFunction("deposit")(bobAmount);
    console.log("  Bob deposit tx:  ", tx.hash);
    await tx.wait();
  }

  section("BALANCES — after deposit");
  await decryptBalance(instance, ledger, alice, "Alice");
  await decryptBalance(instance, ledger, bob, "Bob  ");

  section("DRAW");
  const isDrawDue = (await prizePool.isDrawDue()) as boolean;
  if (isDrawDue) {
    const tx = await prizePool.connect(admin).getFunction("runDraw")();
    console.log("  runDraw tx:", tx.hash);
    await tx.wait();
    console.log("  Draw #", (await prizePool.drawCount()).toString(), "completed.");
  } else {
    const nextDrawTime = Number(await prizePool.nextDrawTime());
    const secondsLeft = nextDrawTime - Math.floor(Date.now() / 1000);
    console.log(`  Draw window not open yet — ${secondsLeft}s remaining. Re-run this script after that.`);
  }

  section("BALANCES — after draw (winners will show a higher balance)");
  await decryptBalance(instance, ledger, alice, "Alice");
  await decryptBalance(instance, ledger, bob, "Bob  ");

  section("WITHDRAW — Alice withdraws her full balance");
  {
    let tx = await vault.connect(alice).getFunction("requestWithdraw")();
    console.log("  requestWithdraw tx:", tx.hash);
    await tx.wait();

    const handle = (await vault.pendingWithdrawHandle(alice.address)) as string;
    console.log("  Pending handle:", handle);

    const { clearValues, abiEncodedClearValues, decryptionProof } = await instance.publicDecrypt([handle]);
    const cleartextAmount = BigInt(clearValues[handle as `0x${string}`] as string | bigint);
    console.log("  Decrypted withdraw amount:", fmt(cleartextAmount));

    const balanceBefore = (await token.balanceOf(alice.address)) as bigint;
    tx = await vault.connect(alice).getFunction("finalizeWithdraw")(abiEncodedClearValues, decryptionProof);
    console.log("  finalizeWithdraw tx:", tx.hash);
    await tx.wait();
    const balanceAfter = (await token.balanceOf(alice.address)) as bigint;

    console.log("  Alice mUSDC balance:", fmt(balanceBefore), "->", fmt(balanceAfter));
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
