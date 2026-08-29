# FoggyPot

Confidential no-loss prize savings on ETH Sepolia, built on the Zama Protocol (fhEVM). Deposits
and balances stay encrypted on-chain; draws are provably fair and deposit-weighted using native
FHE randomness; only a winner learns they won; principal is withdrawable at any time.

Recreates PoolTogether's no-loss prize savings mechanic with confidentiality as the core addition:
nobody but you can see your balance, and nobody but a winner can see who won a draw.

## Deployed contracts (Sepolia)

| Contract | Demo (5 min) | Standard (24 hr) | Long-horizon (30 day) |
|---|---|---|---|
| Ledger | `0x45eDD72d9059b5D922ACF3C59F80d68ba42e9904` | `0x45560C5D2BDc3b74bd908b6605b5b0d740642F48` | `0xD9490C9407Ebc0119e61D818704C9d01e36D2b17` |
| Vault | `0x73269f561ede441EB75b0CFFfB67DFA6037120BB` | `0x974E98E2e3572cC49b9DA6e999b4D96EEf95606a` | `0xBE76D523e78F1C8715778bcA62b6456FA4eb5b39` |
| Reserve | `0x3EcD4566A9319D57ACB74D571476F2a1A35C93F8` | `0x9b3f395fDcFeFD719e9D29a361cbA45E9b169bc2` | `0xBd46CEd1917445C64dc56E9c60c3Ad872B1f64a7` |
| PrizePool | `0x9d195FD0Ce693B6e3F8b90b173CC44d595265552` | `0x2b457CCFb2783761FB6740498752c99D12655eaF` | `0x31f2f597152a78d4cC7785BF65030Bb2ec7ea5aC` |

- **MockUSDC** (shared test token, all 3 pools): `0xf7FfF156C67208fAd613F67e808eC51B90Db6F2f`
- **DrawKeeper** (shared, all 3 pools): `0x754cb7Ed8AAbF220e3beed07989708995F4BFe1b`
- **Chainlink Automation upkeep**: `79875688452929946629526248089109989419065580641520083293849504203449570863125`
  ([automation.chain.link](https://automation.chain.link), registered against `KeeperRegistry 2.1.0`
  at `0x86EFBD0b6736Bed994962f9797049422A3A8E8Ad`) — fires `runDraw()` on whichever pool's window
  has elapsed, no manual trigger needed.

## Getting the test token

`MockUSDC` has a public faucet, 1,000 mUSDC per call, 1-hour cooldown per address:

```solidity
MockUSDC(0xf7FfF156C67208fAd613F67e808eC51B90Db6F2f).faucet()
```

