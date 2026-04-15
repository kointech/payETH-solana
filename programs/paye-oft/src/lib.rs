// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Krypto Capital LLC (Koinon). All rights reserved.
//
// PAYE (PayETH) — LayerZero OFT v2, Solana remote-chain deployment.
//
// IP NOTICE:
//   This program and all derivative works are the exclusive intellectual property
//   of Krypto Capital LLC (operating as Koinon).  No licence to reproduce, distribute,
//   or create derivative works is granted without prior written consent.
//
// ARCHITECTURE:
//   Solana is a *remote* chain in the PAYE mesh.  Total supply starts at 0.
//   Tokens arrive from Ethereum/Linea via LayerZero bridge (EVM burn → Solana mint)
//   and leave via the reverse path (Solana burn → EVM mint), keeping aggregate
//   supply constant at 125,000,000 PAYE across all connected chains.
//
//   Token settings that MUST match the EVM deployment:
//     decimals       = 4
//     sharedDecimals = 4   → ld2sd_rate = 1 (no dust loss)

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
    "9UovNrJD8pQyBLheeHNayuG1wJSEAoxkmM14vw5gcsTT"
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
