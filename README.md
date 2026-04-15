# payETH-solana — PAYE Solana OFT

> Issued and owned by **Krypto Capital LLC (Koinon)**  
> IP © 2026 Krypto Capital LLC. All rights reserved.

## Overview

This repository contains the Solana-side deployment of **PAYE (PayETH)** — the omnichain token issued by Koinon. PAYE is built on [LayerZero v2 OFT](https://docs.layerzero.network/v2/developers/solana/oft/quickstart) and exists across multiple chains with a single, fixed total supply.

The **EVM side** of the project (Linea home chain + future EVM remotes) lives here:  
**[kointech/payETH](https://github.com/kointech/payETH)**

| Property | Value |
|---|---|
| Token name | PayETH |
| Symbol | PAYE |
| Total supply | 125,000,000 PAYE (fixed — minted once on Linea) |
| Decimal places | 4 |
| Standard | LayerZero OFT v2 (Solana program) |
| Role | Remote chain — starts at 0 supply, receives bridged tokens |

## Architecture

```
Linea  ──── PAYEToken (OFT)    ← home chain, holds 125M initial supply
                │
        LayerZero bridge  (burn ↔ mint, total supply preserved)
                │
Solana ──── PAYE (SPL / OFT)  ← this repo; starts at 0, receives bridged tokens
                │
         (more chains to follow)
```

Bridging burns tokens on the source chain and mints on the destination, so the combined supply across all chains is always exactly **125,000,000 PAYE**.

## Repository structure

```
programs/
  paye-oft/
    src/
      lib.rs          ← Anchor program entry point
    Cargo.toml
app/
  scripts/
    deploy.ts         ← deploy SPL mint + OFT store
    wire.ts           ← set_peer (cross-chain wiring)
  tests/
    paye-oft.ts       ← integration tests
Anchor.toml
package.json
.env.example
Makefile
README.md
```

## Prerequisites

- [Rust](https://rustup.rs/) + `solana-cli` + `anchor-cli`
- Node.js ≥ 18 + pnpm (or npm)
- A funded Solana wallet (deployer keypair)

```bash
# install Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# install Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# install JS deps
pnpm install
```

Copy and fill in the environment file:

```bash
cp .env.example .env
```

Key variables in `.env`:

| Variable | Description |
|---|---|
| `SOLANA_RPC_URL` | RPC endpoint (devnet or mainnet) |
| `DEPLOYER_KEYPAIR_PATH` | Path to deployer keypair JSON |
| `TREASURY_WALLET` | Koinon treasury wallet (becomes OFT authority) |
| `LINEA_PAYE_ADDRESS` | Deployed PAYE address on Linea |
| `LINEA_EID` | Linea LayerZero endpoint ID |

## Deployment

### 1 — Deploy to devnet

```bash
make deploy-devnet
```

Creates the SPL mint (4 decimals), initialises the OFT store PDA, and transfers mint authority to the OFT store — no further external minting is possible after this point.

### 2 — Deploy to mainnet

```bash
make deploy-mainnet
```

Same flow targeting mainnet endpoints. Use a [Squads](https://squads.so/) multisig as the treasury authority wallet on mainnet.

### Dry run (simulate without broadcasting)

```bash
make dry-deploy-devnet
make dry-deploy-mainnet
```

## Cross-chain wiring

After both this deployment and the EVM deployment ([kointech/payETH](https://github.com/kointech/payETH)) are live, register peers on **both** sides:

```bash
make wire-devnet    # registers Linea Sepolia peer on Solana devnet
make wire-mainnet   # registers Linea mainnet peer on Solana mainnet
```

Then run the corresponding `make wire-remote` on the EVM side, pointing at the **OFT Store PDA** (not the program ID) as the Solana peer address.

### Endpoint ID reference

| Chain | Mainnet EID | Testnet EID |
|---|---|---|
| Linea | 30183 | 40287 (Linea Sepolia) |
| Solana | 30168 | 40168 (Devnet) |

## Tests

```bash
make test
```

Test coverage includes:

- SPL decimals = 4
- `sharedDecimals` = 4 (must match EVM side)
- Mint authority is locked to OFT store PDA after init
- Total supply starts at 0 (remote chain)
- Bridging simulation: burn on source → credit on destination
- Only authorised wallets can call `set_peer`

## Security

- **No mint backdoor** — after initialisation the program exposes no instruction that mints tokens outside the LayerZero bridge flow.
- **Fixed supply** — combined supply across Linea + Solana (and future chains) always equals 125,000,000 PAYE.
- **Authority protection** — use a [Squads](https://squads.so/) multisig as the authority wallet on mainnet.
- **No raw keypairs in source** — all sensitive keys are loaded from environment variables or Anchor wallet config.

## References

- [LayerZero Solana OFT quickstart](https://docs.layerzero.network/v2/developers/solana/oft/quickstart)
- [LayerZero v2 Solana SDK](https://github.com/LayerZero-Labs/LayerZero-v2/tree/main/packages/layerzero-v2/solana)
- [Anchor framework](https://www.anchor-lang.com/)
- [Squads multisig](https://squads.so/)
- [LayerZero deployed contracts](https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts)
- **EVM repo**: [kointech/payETH](https://github.com/kointech/payETH)
