# PAYE OFT — cargo audit Report

**Date:** 2026-04-20  
**Tool:** `cargo-audit v0.22.1`  
**Advisory DB:** RustSec (1049 advisories, fetched 2026-04-20)  
**Scanned:** `Cargo.lock` (264 crate dependencies)  
**Command:**
```
cargo audit
```

---

## Result: 0 Vulnerabilities · 4 Warnings

No security vulnerabilities were found in any dependency.  
All 4 findings are **warnings** (unmaintained / unsound) in transitive Solana SDK dependencies — not in PAYE code.

---

## Warnings

### RUSTSEC-2025-0141 — `bincode 1.3.3` (Unmaintained)

| Field | Detail |
|---|---|
| Advisory | https://rustsec.org/advisories/RUSTSEC-2025-0141 |
| Date | 2025-12-16 |
| Type | Unmaintained |
| Impact | No known exploitable vulnerability; project abandoned |

**Dependency path:**  
`paye-oft` → `anchor-spl 0.31.1` → `spl-token-2022 6.0.0` → `solana-zk-sdk 2.3.13` → `bincode 1.3.3`

**Action:** None required. Will be resolved when Anchor upgrades its Solana SDK.

---

### RUSTSEC-2025-0161 — `libsecp256k1 0.6.0` (Unmaintained)

| Field | Detail |
|---|---|
| Advisory | https://rustsec.org/advisories/RUSTSEC-2025-0161 |
| Date | 2025-01-14 |
| Type | Unmaintained |
| Impact | No known exploitable vulnerability; project abandoned |

**Dependency path:**  
`paye-oft` → `anchor-spl 0.31.1` → `solana-program 2.3.0` → `solana-secp256k1-recover 2.2.1` → `libsecp256k1 0.6.0`

**Action:** None required. Will be resolved when Anchor upgrades its Solana SDK.

---

### RUSTSEC-2026-0097 — `rand 0.7.3` (Unsound)

| Field | Detail |
|---|---|
| Advisory | https://rustsec.org/advisories/RUSTSEC-2026-0097 |
| Date | 2026-04-09 |
| Type | Unsound — `rand::rng()` with a custom logger can invoke undefined behaviour |
| Impact | Only triggered if a custom Rust logger is installed; not possible in a Solana BPF program |

**Dependency path:**  
`paye-oft` → `anchor-spl` → `solana-program` → `solana-secp256k1-recover` → `libsecp256k1 0.6.0` → `rand 0.7.3`

**Action:** Not exploitable in BPF program context. Will be resolved with Anchor/Solana SDK upgrade.

---

### RUSTSEC-2026-0097 — `rand 0.8.5` (Unsound)

| Field | Detail |
|---|---|
| Advisory | https://rustsec.org/advisories/RUSTSEC-2026-0097 |
| Date | 2026-04-09 |
| Type | Same as above |
| Impact | Same — not exploitable in Solana BPF context |

**Dependency path:**  
`paye-oft` → `anchor-spl` → `spl-token-2022` → `solana-zk-sdk 2.3.13` → `rand 0.8.5`

**Action:** Not exploitable in BPF program context. Will be resolved with Anchor/Solana SDK upgrade.

---

## Conclusion

The PAYE OFT program's own dependency tree introduces **no known CVEs**.  
All warnings originate from `solana-program` and `solana-zk-sdk` within the `anchor-spl` dependency — tracked upstream at https://github.com/coral-xyz/anchor.
