import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, ZeroHash, type Signer } from "ethers";
import { createInstance, SepoliaConfig, type FhevmInstance } from "@zama-fhe/relayer-sdk/node";

const ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function contractURI() view returns (string)",
  "function owner() view returns (address)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function confidentialMint(address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
  "function confidentialBurn(address from, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
  "function confidentialTransfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
] as const;

const OWNER_PRIVATE_KEY = requireEnv("OWNER_PRIVATE_KEY");
const RECIPIENT_PRIVATE_KEY = requireEnv("RECIPIENT_PRIVATE_KEY");
const SEPOLIA_RPC_URL = requireEnv("SEPOLIA_RPC_URL");
const TOKEN_ADDRESS = requireEnv("TOKEN_ADDRESS");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function section(title: string): void {
  console.log(`\n${"=".repeat(60)}\n  ${title}\n${"=".repeat(60)}`);
}

/** Encrypts `amount` as a euint64 input bound to `userAddress` + the token contract. */
async function encryptAmount(instance: FhevmInstance, userAddress: string, amount: bigint) {
  const buffer = instance.createEncryptedInput(TOKEN_ADDRESS, userAddress);
  buffer.add64(amount);
  const ciphertext = await buffer.encrypt();
  return { handle: ciphertext.handles[0], proof: ciphertext.inputProof };
}

/** Decrypts the caller's own confidentialBalanceOf via a signed userDecrypt request. */
async function decryptBalance(
  instance: FhevmInstance,
  token: Contract,
  signer: Signer,
  label: string,
): Promise<bigint> {
  const address = await signer.getAddress();
  const handle = (await token.confidentialBalanceOf(address)) as string;

  if (handle === ZeroHash) {
    console.log(`  ${label} (${address}) balance: 0 (uninitialized)`);
    return 0n;
  }

  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const contractAddresses = [TOKEN_ADDRESS];
  const extraData = await instance.getExtraData();

  const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays, extraData);
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message,
  );

  const result = await instance.userDecrypt(
    [{ handle, contractAddress: TOKEN_ADDRESS }],
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
  console.log(`  ${label} (${address}) balance: ${balance}`);
  return balance;
}

async function main() {
  section("SETUP");

  const provider = new JsonRpcProvider(SEPOLIA_RPC_URL);
  const owner = new Wallet(OWNER_PRIVATE_KEY, provider);
  const recipient = new Wallet(RECIPIENT_PRIVATE_KEY, provider);

  console.log("Owner:    ", owner.address);
  console.log("Recipient:", recipient.address);
  console.log("Token:    ", TOKEN_ADDRESS);

  const instance = await createInstance({
    ...SepoliaConfig,
    network: SEPOLIA_RPC_URL,
  });

  const token = new Contract(TOKEN_ADDRESS, ABI, provider);

  section("METADATA");
  console.log("name:       ", await token.name());
  console.log("symbol:     ", await token.symbol());
  console.log("contractURI:", await token.contractURI());
  console.log("owner:      ", await token.owner());

  section("BALANCES — before");
  await decryptBalance(instance, token, owner, "Owner");
  await decryptBalance(instance, token, recipient, "Recipient");

  section("CONFIDENTIAL MINT — 500 to recipient");
  {
    const { handle, proof } = await encryptAmount(instance, owner.address, 500n);
    const tx = await token.connect(owner).getFunction("confidentialMint")(recipient.address, handle, proof);
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  confirmed.");
  }

  section("BALANCES — after mint");
  await decryptBalance(instance, token, owner, "Owner");
  await decryptBalance(instance, token, recipient, "Recipient");

  section("CONFIDENTIAL TRANSFER — 150 from owner to recipient");
  {
    const { handle, proof } = await encryptAmount(instance, owner.address, 150n);
    const tx = await token.connect(owner).getFunction("confidentialTransfer")(recipient.address, handle, proof);
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  confirmed.");
  }

  section("BALANCES — after transfer");
  await decryptBalance(instance, token, owner, "Owner");
  await decryptBalance(instance, token, recipient, "Recipient");

  section("CONFIDENTIAL BURN — 200 from owner");
  {
    const { handle, proof } = await encryptAmount(instance, owner.address, 200n);
    const tx = await token.connect(owner).getFunction("confidentialBurn")(owner.address, handle, proof);
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  confirmed.");
  }

  section("BALANCES — after burn");
  await decryptBalance(instance, token, owner, "Owner");
  await decryptBalance(instance, token, recipient, "Recipient");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
