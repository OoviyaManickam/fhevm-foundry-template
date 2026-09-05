// Contract addresses — pulled from .env (VITE_ prefix required by Vite for browser access)
export const ADDRESSES = {
  token:     import.meta.env.VITE_TOKEN_ADDRESS     as string,
  ledger:    import.meta.env.VITE_LEDGER_ADDRESS    as string,
  vault:     import.meta.env.VITE_VAULT_ADDRESS     as string,
  prizePool: import.meta.env.VITE_PRIZEPOOL_ADDRESS as string,
}

// We only list the functions the frontend actually calls — no need for the full ABI.
// Each string is a human-readable ABI fragment that ethers parses automatically.

export const TOKEN_ABI = [
  'function faucet()',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const

export const LEDGER_ABI = [
  'function confidentialBalanceOf(address account) view returns (bytes32)',
] as const

export const VAULT_ABI = [
  'function deposit(uint64 amount)',
  'function requestWithdraw()',
  'function finalizeWithdraw(bytes abiEncodedCleartexts, bytes decryptionProof)',
  'function pendingWithdrawHandle(address) view returns (bytes32)',
  'function totalDeposits() view returns (uint64)',
] as const
