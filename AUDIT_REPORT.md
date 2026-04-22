# PAYE OFT — Solana Security Audit Report

**Date:** 2026-04-20  
**Scope:** `programs/paye-oft/src/**`  
**Tools used:** `cargo audit v0.22.1`, manual code review  
**Note:** `cargo clippy` could not run against the program target (pinned nightly `2025-04-15` is incompatible with the `zmij` dependency used by Solana — upstream issue, not PAYE code).

---

## Summary

| Category              | Count | Status   |
|-----------------------|-------|----------|
| Critical (fixed)      | 2     | ✅ Fixed |
| High (fixed)          | 1     | ✅ Fixed |
| Medium (fixed)        | 2     | ✅ Fixed |
| Low (fixed)           | 1     | ✅ Fixed |
| **Overflow (fixed)**  | **1** | **✅ Fixed** |
| cargo audit CVEs      | 0     | ✅ Clean |
| cargo audit warnings  | 4     | ⚠️ Upstream (Solana SDK) |

---

## Bugs Found & Fixed

### [CRITICAL-1] Unchecked slice indexing in `msg_codec.rs` — panic on malformed message

**File:** `programs/paye-oft/src/msg_codec.rs`  
**Functions:** `send_to()`, `amount_sd()`

**Problem:**  
Both functions used direct slice indexing (`&message[offset..end]`) without checking the message length first.  
In `lz_receive.rs`, `send_to()` is called inside an `#[account(...)]` constraint that runs _before_ the LayerZero `clear` CPI validates the message. A too-short message would cause an **unhandled panic** rather than a proper program error.

```rust
// BEFORE (vulnerable):
pub fn send_to(message: &[u8]) -> [u8; 32] {
    let mut send_to = [0u8; 32];
    send_to.copy_from_slice(&message[0..32]); // PANIC if len < 32
    send_to
}
```

**Fix applied:** Use `slice::get()` with a safe fallback:
```rust
// AFTER (fixed):
pub fn send_to(message: &[u8]) -> [u8; 32] {
    let mut send_to = [0u8; 32];
    if let Some(slice) = message.get(SEND_TO_OFFSET..SEND_AMOUNT_SD_OFFSET) {
        send_to.copy_from_slice(slice);
    }
    send_to
}
```
A zero recipient address fails the `address = Pubkey::from(...)` constraint with `OFTError::InvalidTokenDest`, which is correct behaviour.

---

### [CRITICAL-2] Unchecked slice indexing in `compose_msg_codec.rs` — panic on malformed message

**File:** `programs/paye-oft/src/compose_msg_codec.rs`  
**Functions:** `nonce()`, `src_eid()`, `amount_ld()`, `compose_from()`

**Problem:**  
All four decoder functions used direct slice indexing. A compose message that is shorter than 52 bytes (the expected header size) would panic the program.

**Fix applied:** All four functions now use `slice::get()` with zero-default fallback, matching the pattern used in `msg_codec.rs` after its fix.

---

### [HIGH-1] Unchecked `remaining_accounts[1]` access in `send.rs` — panic if caller passes too few accounts

**File:** `programs/paye-oft/src/instructions/send.rs`

**Problem:**  
The OFT-store identity check accessed `ctx.remaining_accounts[1]` without first verifying there are at least 2 remaining accounts. A transaction with ≤ 1 remaining accounts would panic:

```rust
// BEFORE (vulnerable):
require!(
    ctx.accounts.oft_store.key() == ctx.remaining_accounts[1].key(),
    OFTError::InvalidSender
);
```

**Fix applied:** Combine the bounds check into the `require!`:
```rust
// AFTER (fixed):
require!(
    ctx.remaining_accounts.len() > 1
        && ctx.accounts.oft_store.key() == ctx.remaining_accounts[1].key(),
    OFTError::InvalidSender
);
```

---

### [MEDIUM-1] `.unwrap()` on `i64 → u64` timestamp cast in `peer_config.rs`

**File:** `programs/paye-oft/src/state/peer_config.rs`  
**Functions:** `set_capacity()`, `refill()`

**Problem:**  
`Clock::get()?.unix_timestamp` returns `i64`. Both functions called `.try_into().unwrap()` to cast to `u64`. While Solana timestamps are always positive in practice, a panic is worse than a safe fallback.

**Fix applied:** Changed both to `.try_into().unwrap_or(0)`. A timestamp of 0 in the rate limiter causes `elapsed = 0`, which correctly skips refilling rather than panicking.

---

### [MEDIUM-2 / LOW] `&Vec<u8>` parameter anti-pattern in `compose_msg_codec.rs`

**File:** `programs/paye-oft/src/compose_msg_codec.rs`  
**Function:** `encode()`

**Problem:**  
The parameter was declared as `compose_msg: &Vec<u8>`. Clippy flags this as a code smell — `&[u8]` is the idiomatic Rust slice reference and is strictly more general.

**Fix applied:** Changed signature to `compose_msg: &[u8]`.

---

### [OVERFLOW] `sd2ld()` multiplication overflow in `state/oft.rs`

**File:** `programs/paye-oft/src/state/oft.rs`  
**Callers:** `lz_receive.rs`, `lz_receive_types.rs`

**Problem:**  
`sd2ld()` computed `amount_sd * self.ld2sd_rate` as plain `u64` multiplication. With `ld2sd_rate = 10^12` (for 18 local decimals – 6 shared decimals), amounts above **~18.4 million PAYE tokens** (≈ `u64::MAX / 10^12` in shared-decimal units) wrap silently in BPF release mode. The wrapped value is far smaller than intended, causing the `mint_to` CPI in `lz_receive` to mint an incorrect (much smaller) quantity — a loss-of-funds bug for large transfers.

```rust
// BEFORE (vulnerable):
pub fn sd2ld(&self, amount_sd: u64) -> u64 {
    amount_sd * self.ld2sd_rate  // wraps silently if amount_sd > ~18.4e6
}
```

**Fix applied:** Use `checked_mul` and return `Err(OFTError::ArithmeticOverflow)` on overflow. Both call-sites propagate the error with `?`, rejecting oversized messages cleanly.

```rust
// AFTER (fixed):
pub fn sd2ld(&self, amount_sd: u64) -> Result<u64> {
    amount_sd
        .checked_mul(self.ld2sd_rate)
        .ok_or_else(|| error!(OFTError::ArithmeticOverflow))
}
```

---

## `cargo audit` Results

**Command:** `cargo audit` (advisory DB fetched 2026-04-20, 1049 advisories)  
**Result: 0 vulnerabilities | 4 warnings (all allowed, all in Solana SDK transitive deps)**

| Advisory ID | Crate | Version | Type | Used by |
|---|---|---|---|---|
| RUSTSEC-2025-0141 | `bincode` | 1.3.3 | Unmaintained | `solana-zk-sdk` → `spl-token-2022` → `anchor-spl` |
| RUSTSEC-2025-0161 | `libsecp256k1` | 0.6.0 | Unmaintained | `solana-secp256k1-recover` → `solana-program` |
| RUSTSEC-2026-0097 | `rand` | 0.7.3 | Unsound | `libsecp256k1` → `solana-program` |
| RUSTSEC-2026-0097 | `rand` | 0.8.5 | Unsound | `solana-zk-sdk` → `solana-program` |

**Action:** None required now. These are in `solana-program` and `anchor-spl` (not PAYE code). They will be resolved automatically when Anchor upgrades its Solana SDK dependency. Track the issue at https://github.com/coral-xyz/anchor.

---

## Architecture Review Notes

These are not bugs but observations from reviewing the overall contract design:

1. **Single-admin key risk:** The `admin` field in `OFTStore` has full control (fee changes, pause, peer updates, fee withdrawal). Consider storing the admin as a multi-sig or requiring a time-lock for fee changes before mainnet launch.

2. **No TVL tracking on Native OFT receives:** `tvl_ld` is initialised to 0 and never updated. This is correct and intentional (Native OFT = burn/mint, TVL is always 0), but the field could be misleading. The `withdraw_fee` logic correctly uses `escrow.amount - tvl_ld` to compute available fees.

3. **Rate limiter refill logic:** Tokens leaving Solana (`send`) refill the _inbound_ limiter, and tokens arriving (`lz_receive`) refill the _outbound_ limiter. This is a cross-refill pattern that allows rate limit capacity to be partially restored by traffic in the opposite direction — intentional but worth documenting explicitly.

4. **Developer role can set peers:** The `developer` role can call `set_peer_config`, including changing the `peer_address`. An operator error or compromised developer key could reroute bridge funds. Ensure the developer key is held securely or disable the role (`set_oft_config DeveloperEnabled(false)`) before mainnet.

---

## Files Changed by This Audit

| File | Change |
|---|---|
| `programs/paye-oft/src/msg_codec.rs` | `send_to()`, `amount_sd()` — checked slicing |
| `programs/paye-oft/src/compose_msg_codec.rs` | `nonce()`, `src_eid()`, `amount_ld()`, `compose_from()` — checked slicing; `encode()` — `&Vec<u8>` → `&[u8]` |
| `programs/paye-oft/src/instructions/send.rs` | `remaining_accounts[1]` — bounds-checked |
| `programs/paye-oft/src/state/peer_config.rs` | `set_capacity()`, `refill()` — `.unwrap()` → `.unwrap_or(0)` |
| `programs/paye-oft/src/state/oft.rs` | `sd2ld()` — `u64` multiplication → `checked_mul` returning `Result<u64>` |
| `programs/paye-oft/src/errors.rs` | Added `ArithmeticOverflow` variant |
| `programs/paye-oft/src/instructions/lz_receive.rs` | `sd2ld()` call — propagates overflow error with `?` |
| `programs/paye-oft/src/instructions/lz_receive_types.rs` | `sd2ld()` call — propagates overflow error with `?` |
