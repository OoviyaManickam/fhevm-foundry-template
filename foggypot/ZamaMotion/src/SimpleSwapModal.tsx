import { useState } from 'react'
import { X, ArrowUpDown } from 'lucide-react'

const EASE = 'cubic-bezier(0.4,0,0.2,1)'
const ACCENT = '#E882B4'

type Direction = 'mToC' | 'cToM'
type Step = 'input' | 'swapping' | 'done' | 'error'

export function SimpleSwapModal({
  wallet,
  onClose,
}: {
  wallet: string | null
  onClose: () => void
}) {
  const [direction, setDirection] = useState<Direction>('mToC')
  const [amount, setAmount]       = useState('')
  const [step, setStep]           = useState<Step>('input')
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)

  const onBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  const fromToken = direction === 'mToC' ? 'mUSDC' : 'cUSDC'
  const toToken   = direction === 'mToC' ? 'cUSDC' : 'mUSDC'
  const outAmount = amount && Number(amount) > 0 ? Number(amount).toFixed(2) : '0.00'

  const handleSwap = async () => {
    if (!amount || Number(amount) <= 0 || !wallet) return
    setStep('swapping')
    setErrorMsg(null)
    try {
      await new Promise(r => setTimeout(r, 1000))
      throw new Error('Swap contract not yet deployed — coming soon!')
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Swap failed')
      setStep('error')
    }
  }

  const toggleDirection = () => {
    setDirection(d => d === 'mToC' ? 'cToM' : 'mToC')
    setAmount('')
    setStep('input')
    setErrorMsg(null)
  }

  return (
    <div
      onClick={onBackdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 420, borderRadius: 20,
          background: '#13131A', border: `1.5px solid ${ACCENT}44`,
          padding: '1.75rem', position: 'relative',
          boxShadow: '0 24px 60px -10px rgba(0,0,0,0.7)',
        }}
      >
        {/* Close */}
        <button onClick={onClose} style={{
          position: 'absolute', top: 16, right: 16,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 50, width: 32, height: 32, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)',
        }}>
          <X size={15} />
        </button>

        {/* Header */}
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{ fontFamily: "'Anton', sans-serif", fontSize: '1.2rem', color: 'white', letterSpacing: '0.06em', marginBottom: 4 }}>
            SWAP TOKENS
          </div>
          <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            1 {fromToken} = 1 {toToken} · no fees · Zama FHE
          </div>
        </div>

        {step === 'done' ? (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🎉</div>
            <div style={{ fontFamily: "'Anton', sans-serif", fontSize: '1.2rem', color: '#6BBF7A', letterSpacing: '0.05em', marginBottom: 6 }}>SWAP SUCCESSFUL</div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginBottom: '1.5rem' }}>
              Your {toToken} is ready.
            </div>
            <button onClick={onClose} style={{
              width: '100%', padding: '0.85rem',
              background: '#6BBF7A', border: 'none', borderRadius: 50,
              color: '#0A0A0F', fontSize: '0.78rem', fontWeight: 700,
              letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
            }}>DONE</button>
          </div>
        ) : step === 'error' ? (
          <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚠️</div>
            <div style={{
              fontSize: '0.7rem', color: '#F4845F',
              background: 'rgba(244,132,95,0.08)', border: '1px solid rgba(244,132,95,0.25)',
              borderRadius: 8, padding: '0.75rem', marginBottom: '1.25rem',
              wordBreak: 'break-word', textAlign: 'left', lineHeight: 1.5,
            }}>{errorMsg}</div>
            <button onClick={() => { setStep('input'); setErrorMsg(null) }} style={{
              width: '100%', padding: '0.85rem',
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 50, color: 'white', fontSize: '0.78rem', fontWeight: 700,
              letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
            }}>TRY AGAIN</button>
          </div>
        ) : (
          <>
            {/* Direction toggle */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center', gap: 10, marginBottom: '1.25rem',
            }}>
              {/* From */}
              <div style={{
                background: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.1)',
                borderRadius: 14, padding: '0.85rem 1rem',
              }}>
                <div style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>FROM</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: ACCENT }}>{fromToken}</div>
              </div>

              {/* Flip button */}
              <button onClick={toggleDirection} style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: `${ACCENT}22`, border: `1.5px solid ${ACCENT}55`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: `transform 300ms ${EASE}`,
              }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'rotate(180deg)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'rotate(0deg)')}
              >
                <ArrowUpDown size={15} color={ACCENT} />
              </button>

              {/* To */}
              <div style={{
                background: `${ACCENT}0D`, border: `1.5px solid ${ACCENT}33`,
                borderRadius: 14, padding: '0.85rem 1rem',
              }}>
                <div style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>TO</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: ACCENT }}>{toToken}</div>
              </div>
            </div>

            {/* Amount input */}
            <div style={{ marginBottom: '0.85rem' }}>
              <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                Amount ({fromToken})
              </div>
              <div style={{
                display: 'flex', alignItems: 'center',
                background: 'rgba(255,255,255,0.05)', border: '1.5px solid rgba(255,255,255,0.12)',
                borderRadius: 12, overflow: 'hidden',
              }}>
                <input
                  type="number" placeholder="0.00" value={amount}
                  onChange={e => setAmount(e.target.value)}
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    color: 'white', fontSize: '1.2rem', fontWeight: 600, padding: '0.9rem 1rem',
                  }}
                />
                <span style={{ padding: '0 1rem', fontSize: '0.75rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em' }}>
                  {fromToken}
                </span>
              </div>
            </div>

            {/* You receive */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                You receive ({toToken})
              </div>
              <div style={{
                display: 'flex', alignItems: 'center',
                background: 'rgba(255,255,255,0.03)', border: `1.5px solid ${ACCENT}33`,
                borderRadius: 12, overflow: 'hidden',
              }}>
                <div style={{
                  flex: 1, padding: '0.9rem 1rem',
                  fontSize: '1.2rem', fontWeight: 600,
                  color: outAmount === '0.00' ? 'rgba(255,255,255,0.2)' : ACCENT,
                }}>
                  {outAmount}
                </div>
                <span style={{ padding: '0 1rem', fontSize: '0.75rem', fontWeight: 700, color: ACCENT, letterSpacing: '0.08em' }}>
                  {toToken}
                </span>
              </div>
            </div>

            {/* Wallet row */}
            {wallet && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'rgba(255,255,255,0.03)', borderRadius: 10,
                padding: '0.65rem 0.85rem', marginBottom: '1.25rem',
              }}>
                <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Connected</span>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#6BBF7A', fontFamily: 'monospace' }}>
                  {wallet.slice(0, 6)}...{wallet.slice(-4)}
                </span>
              </div>
            )}

            {/* Swap button */}
            {step === 'swapping' ? (
              <div style={{ textAlign: 'center', padding: '0.75rem 0' }}>
                <div style={{ fontSize: '0.78rem', color: ACCENT, fontWeight: 600, letterSpacing: '0.06em' }}>
                  ⏳ Swapping tokens...
                </div>
                <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                  Confirm in MetaMask if prompted
                </div>
              </div>
            ) : !wallet ? (
              <div style={{ textAlign: 'center', fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', padding: '0.5rem 0' }}>
                Connect your wallet to swap
              </div>
            ) : (
              <button
                onClick={handleSwap}
                disabled={!amount || Number(amount) <= 0}
                style={{
                  width: '100%', padding: '0.9rem',
                  background: !amount || Number(amount) <= 0
                    ? 'rgba(255,255,255,0.06)'
                    : `linear-gradient(135deg, ${ACCENT}, #B85A9A)`,
                  border: 'none', borderRadius: 50,
                  color: !amount || Number(amount) <= 0 ? 'rgba(255,255,255,0.3)' : 'white',
                  fontSize: '0.8rem', fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  cursor: !amount || Number(amount) <= 0 ? 'not-allowed' : 'pointer',
                  transition: `background 200ms ${EASE}`,
                }}
              >
                SWAP {fromToken} → {toToken}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
