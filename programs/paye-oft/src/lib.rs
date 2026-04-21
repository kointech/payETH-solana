// SPDX-License-Identifier: UNLICENSED
//
// PAYE (PayETH) — LayerZero OFT v2, Solana remote-chain deployment.
// Issued by a United States Entity (US Virgin Islands)
// ─────────────────────────────────────────────────────────────────────────────
// Beneficially owned 100% by Matthew Mecke and/or assigns.
// Held and issued through Krypto Capital LLC, a US Virgin Islands registered
// company (interim holding entity), pending establishment of a successor USVI
// holding company.  All rights, title, and interest in this code, the PAYE
// token, and all related intellectual property vest solely in Matthew Mecke
// and/or his designated assigns or successor entities.
//
// IP © 2025–2026 Matthew Mecke / Krypto Capital LLC (Koinon). All rights reserved.
//
// This code was developed under instruction from Matthew Mecke commencing
// December 1, 2025.  At that time the beneficial owner advised that the final
// corporate ownership structure was yet to be established; Krypto Capital LLC
// is therefore named as the interim issuing entity.  Any successor USVI entity
// established by Matthew Mecke shall automatically succeed to all rights herein
// by corporate IP assignment without affecting the validity of this notice.
//
// No licence to reproduce, distribute, or create derivative works is granted
// without prior written consent of the beneficial owner.
// ─────────────────────────────────────────────────────────────────────────────
//
// ARCHITECTURE:
//   Solana is a *remote* chain in the PAYE mesh.  Total supply starts at 0.
//   Tokens arrive from Ethereum/Linea via LayerZero bridge (EVM burn → Solana mint)
//   and leave via the reverse path (Solana burn → EVM mint), keeping aggregate
//   supply constant at 125,000,000 PAYE across all connected chains.
//
//   Token settings that MUST match the EVM deployment:
//     decimals       = 18
//     sharedDecimals = 6   → ld2sd_rate = 10^12 (dust ≤ 10^-6 PAYE per bridge tx)

use anchor_lang::prelude::*;

pub mod compose_msg_codec;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod msg_codec;
pub mod state;

use errors::*;
use events::*;
use instructions::*;
use oapp::{
    endpoint::{MessagingFee, MessagingReceipt},
    LzReceiveParams,
};
use solana_helper::program_id_from_env;
use state::*;

// Program ID is injected at build time via the OFT_ID env variable.
// After running `anchor keys sync -p paye-oft`, replace the fallback below
// with the generated program ID and commit it to the repo.
declare_id!(Pubkey::new_from_array(program_id_from_env!(
    "OFT_ID",
    "ARdhYxxfEpCbz83j5Y4ubA2bWXMaxWmY2pjehXuFLM5x"
)));

// ─── PDA seeds ────────────────────────────────────────────────────────────────
pub const OFT_SEED: &[u8] = b"OFT";
pub const PEER_SEED: &[u8] = b"Peer";
pub const LZ_RECEIVE_TYPES_SEED: &[u8] = oapp::LZ_RECEIVE_TYPES_SEED;

#[program]
pub mod paye_oft {
    use super::*;

    /// Returns the OFT interface and message format versions.
    pub fn oft_version(_ctx: Context<OFTVersion>) -> Result<Version> {
        Ok(Version { interface: 2, message: 1 })
    }

    // ── Initialization ─────────────────────────────────────────────────────

    /// One-time initialisation: creates the OFT Store PDA and escrow token
    /// account, then registers the OApp with the LayerZero endpoint.
    ///
    /// Must be called by the deployer once the SPL mint has been created.
    /// After this call the deployer is set as `developer` so they can wire peers.
    pub fn init_oft(mut ctx: Context<InitOFT>, params: InitOFTParams) -> Result<()> {
        InitOFT::apply(&mut ctx, &params)
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    /// Update the OFT Store configuration fields (admin, delegate, fee, pause
    /// roles, developer address, developer enable/disable).
    pub fn set_oft_config(
        mut ctx: Context<SetOFTConfig>,
        params: SetOFTConfigParams,
    ) -> Result<()> {
        SetOFTConfig::apply(&mut ctx, &params)
    }
    /// Complete a two-step admin transfer.
    ///
    /// The pending admin (nominated via `set_oft_config(Admin(...))`) must sign
    /// this transaction to become the new admin. Until they do, the current admin
    /// retains full authority and can cancel the nomination by calling
    /// `set_oft_config(Admin(...))` again with a different pubkey.
    pub fn accept_admin(mut ctx: Context<AcceptAdmin>) -> Result<()> {
        AcceptAdmin::apply(&mut ctx)
    }
    /// Register or update a peer OFT address on a remote chain.
    /// Callable by the `admin` OR the `developer` (when developer role is active).
    pub fn set_peer_config(
        mut ctx: Context<SetPeerConfig>,
        params: SetPeerConfigParams,
    ) -> Result<()> {
        SetPeerConfig::apply(&mut ctx, &params)
    }

    /// Emergency pause / unpause.
    /// Callable by `pauser` (to pause) or `unpauser` (to unpause) if set;
    /// otherwise by admin.
    pub fn set_pause(mut ctx: Context<SetPause>, params: SetPauseParams) -> Result<()> {
        SetPause::apply(&mut ctx, &params)
    }

    /// Withdraw accumulated protocol fees from escrow to an admin-controlled
    /// token account.
    pub fn withdraw_fee(mut ctx: Context<WithdrawFee>, params: WithdrawFeeParams) -> Result<()> {
        WithdrawFee::apply(&mut ctx, &params)
    }

    /// Recover excess SOL lamports that have accumulated in the OFT store PDA
    /// (e.g. from accidental direct SOL transfers).
    /// Only lamports above the rent-exempt minimum are moved.
    /// This instruction has no access to PAYE token balances.
    pub fn recover_lamports(mut ctx: Context<RecoverLamports>) -> Result<()> {
        RecoverLamports::apply(&mut ctx)
    }

    // ── Public ─────────────────────────────────────────────────────────────

    /// Quote the fee breakdown for a cross-chain send without sending.
    pub fn quote_oft(ctx: Context<QuoteOFT>, params: QuoteOFTParams) -> Result<QuoteOFTResult> {
        QuoteOFT::apply(&ctx, &params)
    }

    /// Quote the LayerZero messaging fee for a send (native SOL / LZ token).
    pub fn quote_send(ctx: Context<QuoteSend>, params: QuoteSendParams) -> Result<MessagingFee> {
        QuoteSend::apply(&ctx, &params)
    }

    /// Bridge PAYE tokens to a connected chain.
    /// For the native (burn/mint) model: tokens are burned on Solana and minted
    /// on the destination chain.
    pub fn send(
        mut ctx: Context<Send>,
        params: SendParams,
    ) -> Result<(MessagingReceipt, OFTReceipt)> {
        Send::apply(&mut ctx, &params)
    }

    /// Called by the LayerZero Endpoint when PAYE tokens arrive from another chain.
    /// Mints tokens to the recipient's associated token account.
    pub fn lz_receive(mut ctx: Context<LzReceive>, params: LzReceiveParams) -> Result<()> {
        LzReceive::apply(&mut ctx, &params)
    }

    /// Returns the ordered list of accounts required by `lz_receive`.
    /// The LayerZero Executor calls this off-chain to build the transaction.
    pub fn lz_receive_types(
        ctx: Context<LzReceiveTypes>,
        params: LzReceiveParams,
    ) -> Result<Vec<oapp::endpoint_cpi::LzAccount>> {
        LzReceiveTypes::apply(&ctx, &params)
    }
}

#[derive(Accounts)]
pub struct OFTVersion {}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct Version {
    pub interface: u64,
    pub message: u64,
}
