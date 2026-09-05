import { useState } from 'react'
import { JsonRpcProvider, Contract, formatUnits, Interface } from 'ethers'
import { initSDK, createInstance, SepoliaConfig } from '@zama-fhe/relayer-sdk/web'
import { X, Lock } from 'lucide-react'
import { ADDRESSES, VAULT_ABI, TOKEN_ABI } from './contracts'

const EASE = 'cubic-bezier(0.4,0,0.2,1)'

type Step =
  | 'idle'
  | 'requesting'    // calling requestWithdraw()
  | 'decrypting'    // calling publicDecrypt via Zama Relayer
  | 'finalizing'    // calling finalizeWithdraw()
  | 'done'
  | 'error'

async function sendTx(eth: any, params: Record<string, string>): Promise<string | null> {
  try {
    return await eth.request({ method: 'eth_sendTransaction', params: [params] })
  } catch (e: any) {
    if (e?.code === 4100) {
      const nonceBefore = parseInt(
        await eth.request({ method: 'eth_getTransactionCount', params: [params.from, 'latest'] }), 16
      )
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const nonceNow = parseInt(
          await eth.request({ method: 'eth_getTransactionCount', params: [params.from, 'latest'] }), 16
        )
        if (nonceNow > nonceBefore) return null
      }
      throw new Error('timed out waiting for nonce increment after 4100')
    }
    throw e
  }
}

async function waitForReceipt(eth: any, txHash: string): Promise<void> {
  for (;;) {
    const receipt = await eth.request({ method: 'eth_getTransactionReceipt', params: [txHash] })
    if (receipt) {
      if (receipt.status === '0x0') throw new Error('transaction reverted')
      return
    }
    await new Promise(r => setTimeout(r, 2000))
  }
}

export function WithdrawModal({
  wallet,
  vaultColor,
  onClose,
  onWithdrawn,
}: {
  wallet: string
  vaultColor: string
  onClose: () => void
  onWithdrawn: () => void
}) {
  const [step, setStep] = useState<Step>('idle')
  const [withdrawnAmount, setWithdrawnAmount] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const onBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleWithdraw = async () => {
    const eth = (window as any).ethereum
    setErrorMsg(null)

    try {
      const provider = new JsonRpcProvider(import.meta.env.VITE_SEPOLIA_RPC_URL, 11155111, { staticNetwork: true })
      const vaultContract = new Contract(ADDRESSES.vault, VAULT_ABI, provider)
      const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'

      // ── Step 1: requestWithdraw() — skip if handle already exists ─────────
      setStep('requesting')

      let handle = (await vaultContract.pendingWithdrawHandle(wallet)) as string

      if (handle === ZERO) {
        // No pending handle — call requestWithdraw() to create one
        const requestData = '0xb3423eec' // keccak256("requestWithdraw()")[0:4]
        const requestTxHash = await sendTx(eth, {
          from: wallet,
          to: ADDRESSES.vault,
          data: requestData,
          gas: '0x7a120',
        })
        if (requestTxHash) await waitForReceipt(eth, requestTxHash)
        handle = (await vaultContract.pendingWithdrawHandle(wallet)) as string
      }

      if (!handle || handle === ZERO) {
        throw new Error('No pending withdraw handle found — requestWithdraw may have failed')
      }

      // ── Step 2: publicDecrypt via Zama Relayer ─────────────────────────────
      setStep('decrypting')

      await initSDK()
      const instance = await createInstance({
        ...SepoliaConfig,
        network: import.meta.env.VITE_SEPOLIA_RPC_URL,
      })

      const { abiEncodedClearValues, decryptionProof, clearValues } =
        await instance.publicDecrypt([handle])

      const cleartextAmount = BigInt(
        clearValues[handle as `0x${string}`] as string | bigint
      )

      // ── Step 3: finalizeWithdraw(abiEncodedClearValues, decryptionProof) ───
      setStep('finalizing')

      // Encode finalizeWithdraw(bytes, bytes) call using ethers AbiCoder
      const tokenContract = new Contract(ADDRESSES.token, TOKEN_ABI, provider)
      const balanceBefore = (await tokenContract.balanceOf(wallet)) as bigint

      // Build calldata: selector + abi.encode(bytes, bytes)
      // selector for finalizeWithdraw(bytes,bytes) = keccak256(...)[0:4]
      // We use ethers Interface to encode properly
      const iface = new Interface([
        'function finalizeWithdraw(bytes abiEncodedCleartexts, bytes decryptionProof)',
      ])
      const finalizeData = iface.encodeFunctionData('finalizeWithdraw', [
        abiEncodedClearValues,
        decryptionProof,
      ])

      const finalizeTxHash = await sendTx(eth, {
        from: wallet,
        to: ADDRESSES.vault,
        data: finalizeData,
        gas: '0xF4240', // 1M gas — FHE.checkSignatures is expensive
      })
      if (finalizeTxHash) await waitForReceipt(eth, finalizeTxHash)

      const balanceAfter = (await tokenContract.balanceOf(wallet)) as bigint
      const received = balanceAfter - balanceBefore
      setWithdrawnAmount(
        formatUnits(received > 0n ? received : cleartextAmount, 6)
      )
      setStep('done')
      onWithdrawn()
    } catch (e: any) {
      const msg = e?.message ?? e?.reason ?? e?.info?.error?.message ?? JSON.stringify(e)
      console.error('withdraw error:', msg, e)
      setErrorMsg(msg)
      setStep('error')
    }
  }

  const stepLabel: Record<Step, string> = {
    idle:       '',
    requesting: '⏳ Step 1/3 — Requesting withdraw on-chain...',
    decrypting: '🔓 Step 2/3 — Zama Relayer decrypting your balance...',
    finalizing: '⏳ Step 3/3 — Finalizing withdraw on-chain...',
    done:       '',
    error:      '',
  }

  return (
    <div
      onClick={onBackdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 420, borderRadius: 18,
          background: '#13131A', border: `1.5px solid ${vaultColor}44`,
          padding: '1.75rem', position: 'relative',
          boxShadow: '0 20px 40px -10px rgba(0,0,0,0.7)',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 50, width: 32, height: 32, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.5)',
          }}
        >
          <X size={15} />
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: `linear-gradient(135deg, ${vaultColor}44, ${vaultColor}88)`,
            border: `1.5px solid ${vaultColor}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Lock size={16} color={vaultColor} />
          </div>
          <div>
            <div style={{ fontFamily: "'Anton', sans-serif", fontSize: '1.05rem', color: 'white', letterSpacing: '0.06em' }}>
              WITHDRAW
            </div>
            <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
              mUSDC Vault · Zama FHE
            </div>
          </div>
        </div>

        {/* Info box */}
        <div style={{
          background: `${vaultColor}0f`, border: `1px solid ${vaultColor}33`,
          borderRadius: 10, padding: '0.85rem 1rem', marginBottom: '1.5rem',
          fontSize: '0.7rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.6,
        }}>
          This withdraws your <strong style={{ color: 'white' }}>full encrypted balance</strong> back
          to your wallet. The Zama Relayer decrypts your ciphertext and produces a proof
          the contract verifies on-chain — nobody sees your balance except you.
        </div>

        {step === 'done' ? (
          <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
            <div style={{
              fontFamily: "'Anton', sans-serif", fontSize: '1.15rem',
              color: '#6BBF7A', letterSpacing: '0.05em', marginBottom: 6,
            }}>
              WITHDRAW COMPLETE
            </div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginBottom: '1.5rem' }}>
              {withdrawnAmount ? `${withdrawnAmount} mUSDC returned to your wallet` : 'Funds returned to your wallet'}
            </div>
            <button
              onClick={onClose}
              style={{
                width: '100%', padding: '0.85rem',
                background: '#6BBF7A', border: 'none', borderRadius: 50,
                color: '#0A0A0F', fontSize: '0.78rem', fontWeight: 700,
                letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
              }}
            >
              DONE
            </button>
          </div>
        ) : step === 'error' ? (
          <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚠️</div>
            <div style={{
              fontSize: '0.7rem', color: '#F4845F',
              background: 'rgba(244,132,95,0.08)', border: '1px solid rgba(244,132,95,0.25)',
              borderRadius: 8, padding: '0.75rem', marginBottom: '1.25rem',
              wordBreak: 'break-word', textAlign: 'left', lineHeight: 1.5,
            }}>
              {errorMsg}
            </div>
            <button
              onClick={() => { setStep('idle'); setErrorMsg(null) }}
              style={{
                width: '100%', padding: '0.85rem',
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 50, color: 'white', fontSize: '0.78rem', fontWeight: 700,
                letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
              }}
            >
              TRY AGAIN
            </button>
          </div>
        ) : step !== 'idle' ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{
              fontSize: '0.78rem', color: vaultColor, fontWeight: 600,
              letterSpacing: '0.06em', marginBottom: 8,
            }}>
              {stepLabel[step]}
            </div>
            <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
              {step === 'decrypting'
                ? 'This takes ~10-20s — the Zama Relayer is producing a decryption proof'
                : 'Confirm in MetaMask if prompted'}
            </div>
            {/* Progress dots */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 20 }}>
              {(['requesting', 'decrypting', 'finalizing'] as Step[]).map((s, i) => (
                <div key={i} style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: step === s ? vaultColor : 'rgba(255,255,255,0.15)',
                  transition: `background 300ms ${EASE}`,
                }} />
              ))}
            </div>
          </div>
        ) : (
          <button
            onClick={handleWithdraw}
            style={{
              width: '100%', padding: '0.9rem',
              background: vaultColor, border: 'none', borderRadius: 50,
              color: '#0A0A0F', fontSize: '0.78rem', fontWeight: 700,
              letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
              transition: `opacity 200ms ${EASE}`,
            }}
          >
            WITHDRAW ALL
          </button>
        )}
      </div>
    </div>
  )
}
