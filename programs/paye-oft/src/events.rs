use crate::*;

/// Emitted when PAYE tokens are bridged out (Solana → destination chain).
#[event]
pub struct OFTSent {
    pub guid: [u8; 32],
    pub dst_eid: u32,
    pub from: Pubkey,
    pub amount_sent_ld: u64,
    pub amount_received_ld: u64,
}

/// Emitted when PAYE tokens arrive from another chain (via lz_receive).
#[event]
pub struct OFTReceived {
    pub guid: [u8; 32],
    pub src_eid: u32,
    pub to: Pubkey,
    pub amount_received_ld: u64,
}

/// Emitted when the developer address is changed.
#[event]
pub struct DeveloperChanged {
    pub previous_developer: Pubkey,
    pub new_developer: Pubkey,
}

/// Emitted when the developer role is enabled or disabled.
#[event]
pub struct DeveloperToggled {
    pub enabled: bool,
}
