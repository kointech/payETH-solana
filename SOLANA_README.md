# PAYE / PayETH — Solana OFT Implementation

> IP © 2026 Krypto Capital LLC (Koinon). All rights reserved.

---

## Context — what this repo must implement

This is the Solana side of the **PAYE (PayETH)** omnichain token, issued by **Krypto Capital LLC (Koinon)**.

The EVM side already exists as a Foundry project. The Solana program must be a **LayerZero OFT (Omnichain Fungible Token) v2** that connects to the same cross-chain mesh. Below is everything you need to know to implement it correctly.

---

## Token specification

| Property | Value |
|---|---|
| Token name | PayETH |
| Symbol | PAYE |
| Total supply | 125,000,000 PAYE (fixed — minted once on Ethereum) |
| Decimal places | 4 (SPL token must also use 4 decimals) |
| Standard | LayerZero OFT v2 (Solana program) |
| Role on Solana | Remote chain — starts with 0 supply, receives bridged tokens |

The Solana deployment is a **remote** (not home) chain — it never mints the initial supply. Tokens arrive via the LayerZero bridge from Ethereum (burn on EVM → mint on Solana) and can be bridged back (burn on Solana → mint on EVM), keeping total supply constant across all chains at all times.

---

## EVM contract summary (for reference)

- **Home chain**: Ethereum — `PAYEToken` (OFT) with `initialSupply = 125_000_000 × 10^4`
- **Remote EVM chains**: Linea — `PAYEToken` (OFT) with `initialSupply = 0`
- **Decimals**: 4 on all EVM chains; `sharedDecimals = 4` (conversion rate = 1, no dust)
- **Ownership**: `Ownable2Step` — two-step transfer, treasury wallet is the owner
- **No public mint** — supply is fixed; only the LZ bridge can move tokens
- **LayerZero Endpoint IDs (EIDs)**:
  - Ethereum mainnet: `30101` / Sepolia testnet: `40161`
  - Linea mainnet: `30183` / Linea Sepolia testnet: `40287`
  - Solana mainnet: `30168` / Solana devnet: `40168`

---

## What to build

### 1. Solana OFT program

Use the [LayerZero Solana OFT quickstart](https://docs.layerzero.network/v2/developers/solana/oft/quickstart) as the foundation.

Requirements:
- SPL token with **4 decimal places**
- `sharedDecimals = 4` (must match the EVM side exactly)
- **No mint authority after initial setup** — mint authority must be transferred to the OFT store PDA and no external mint is ever called
- Authority (equivalent of EVM owner) must be a Solana wallet controlled by Koinon treasury
- A developer keypair should be able to call `set_peer` (wire the cross-chain peers) without holding full authority — mirror the EVM `developer` role pattern if the LayerZero SDK supports it; otherwise document the workaround
- Use `@layerzerolabs/lz-solana-sdk-v2` and Anchor framework

### 2. Deployment scripts

Provide scripts for:
- **Deploy to devnet** — create the SPL mint, initialize the OFT store, set the initial authority to the Koinon treasury wallet
- **Wire peers** — call `set_peer` to register:
  - Ethereum Sepolia (`eid = 40161`) ↔ this Solana devnet deployment
  - Linea Sepolia (`eid = 40287`) ↔ this Solana devnet deployment
- **Deploy to mainnet** — same flow targeting mainnet endpoints
- Dry-run / simulation mode before any live transaction

### 3. Tests

Cover at minimum:
- SPL decimals are 4
- sharedDecimals are 4
- Mint authority is locked to the OFT store PDA after init (no external mint possible)
- Total supply starts at 0 on Solana (remote chain)
- Bridging simulation: token lock/burn on one side, credit on the other
- Only authorized wallets can call `set_peer`

### 4. Configuration

- `Anchor.toml` with `[programs.devnet]` and `[programs.mainnet]` sections
- `.env.example` with all required variables (RPC URLs, keypair paths, treasury address, EVM peer addresses)
- Makefile or `package.json` scripts mirroring the EVM project:
  - `deploy-devnet`
  - `deploy-mainnet`
  - `wire-devnet`
  - `wire-mainnet`
  - `test`

---

## Security requirements

- **No mint backdoor** — after initialization the program must not expose any instruction that mints new tokens outside of the LayerZero bridge flow
- **Fixed supply** — total supply across Ethereum + Linea + Solana must always equal 125,000,000 PAYE
- **Authority protection** — use a multisig (e.g. Squads) as the treasury/authority wallet on mainnet; document the setup steps
- **No dummy keypairs in source** — use environment variables or Anchor wallet config for all sensitive keys
- Follow the OWASP guidelines for Solana / Rust smart contract security where applicable

---

## Repository structure (suggested)

```
programs/
  paye-oft/
    src/
      lib.rs        ← Anchor program entry point
    Cargo.toml
app/
  scripts/
    deploy.ts       ← deploy script
    wire.ts         ← set_peer script
  tests/
    paye-oft.ts     ← integration tests
Anchor.toml
package.json
.env.example
Makefile
README.md
```

---

## Cross-chain wiring checklist

After both EVM and Solana deployments are live, the following peers must be set on **each** deployment:

| From | To | EID | Peer address |
|---|---|---|---|
| Solana devnet | Ethereum Sepolia | 40161 | `<EVM_SEPOLIA_PAYE_ADDRESS>` as bytes32 |
| Solana devnet | Linea Sepolia | 40287 | `<EVM_LINEA_SEPOLIA_PAYE_ADDRESS>` as bytes32 |
| Ethereum Sepolia | Solana devnet | 40168 | `<SOLANA_DEVNET_OFT_STORE_PDA>` as bytes32 |
| Linea Sepolia | Solana devnet | 40168 | `<SOLANA_DEVNET_OFT_STORE_PDA>` as bytes32 |

> Note: on Solana the peer address passed to the EVM `setPeer()` call is the **OFT Store PDA**, not the program ID.

---

## References

- [LayerZero Solana OFT quickstart](https://docs.layerzero.network/v2/developers/solana/oft/quickstart)
- [LayerZero Solana SDK](https://github.com/LayerZero-Labs/LayerZero-v2/tree/main/packages/layerzero-v2/solana)
- [Anchor framework](https://www.anchor-lang.com/)
- [Squads multisig (Solana)](https://squads.so/)
- [LayerZero endpoint addresses](https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts)
