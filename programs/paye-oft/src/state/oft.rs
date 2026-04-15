use crate::*;

/// Central configuration account for the PAYE OFT on Solana.
///
/// PDA seeds: ["OFT", token_escrow.key()]
#[account]
#[derive(InitSpace)]
pub struct OFTStore {
    // ── Immutable ─────────────────────────────────────────────────────────
    /// Native = burn/mint; Adapter = lock/unlock.
    /// PAYE on Solana is always Native (remote chain).
    pub oft_type: OFTType,
    /// local-decimals / shared-decimals conversion rate.
    /// Because PAYE uses 4 local decimals and 4 shared decimals, this is 1.
    pub ld2sd_rate: u64,
    /// The SPL mint for PAYE on Solana.
    pub token_mint: Pubkey,
    /// Token escrow account owned by this store (holds TVL and protocol fees).
    pub token_escrow: Pubkey,
    /// The LayerZero EndpointV2 program on this cluster.
    pub endpoint_program: Pubkey,
    /// Bump seed for this PDA.
    pub bump: u8,

    // ── Mutable (operational) ─────────────────────────────────────────────
    /// Net tokens currently held by the bridge on Solana (always 0 for Native OFT
    /// because tokens are minted/burned; tracked here for consistency).
    pub tvl_ld: u64,

    // ── Configurable ──────────────────────────────────────────────────────
    /// Primary authority — the Koinon treasury wallet.
    pub admin: Pubkey,
    /// Default protocol fee in basis points (0 = fee-free, up to 10_000).
    pub default_fee_bps: u16,
    /// Whether all sends and receives are suspended.
    pub paused: bool,
    /// Optional address that may pause the contract.
    pub pauser: Option<Pubkey>,
    /// Optional address that may unpause the contract.
    pub unpauser: Option<Pubkey>,

    // ── Developer role (mirrors EVM contract) ────────────────────────────
    /// Address authorised to call set_peer_config on behalf of the admin.
    pub developer: Pubkey,
    /// Whether the developer role is currently active.
    pub developer_enabled: bool,
}

#[derive(InitSpace, Clone, AnchorSerialize, AnchorDeserialize, PartialEq, Eq)]
pub enum OFTType {
    /// Burns on send, mints on receive.  Used for remote chains (inc. Solana).
    Native,
    /// Locks on send, unlocks on receive.  Used for adapter deployments.
    Adapter,
}

impl OFTStore {
    /// Convert a local-decimal amount to shared-decimal amount.
    pub fn ld2sd(&self, amount_ld: u64) -> u64 {
        amount_ld / self.ld2sd_rate
    }

    /// Convert a shared-decimal amount to local-decimal amount.
    pub fn sd2ld(&self, amount_sd: u64) -> u64 {
        amount_sd * self.ld2sd_rate
    }

    /// Remove sub-shared-decimal dust from a local amount.
    pub fn remove_dust(&self, amount_ld: u64) -> u64 {
        amount_ld - amount_ld % self.ld2sd_rate
    }
}

/// Auxiliary account used by `lz_receive_types` to avoid re-deriving PDAs.
///
/// PDA seeds: [LZ_RECEIVE_TYPES_SEED, oft_store.key()]
#[account]
#[derive(InitSpace)]
pub struct LzReceiveTypesAccounts {
    pub oft_store: Pubkey,
    pub token_mint: Pubkey,
}
