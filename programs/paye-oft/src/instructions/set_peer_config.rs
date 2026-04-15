use crate::*;

/// Register or update the peer OFT address on a remote chain.
///
/// Callable by:
///  - `admin` (always)
///  - `developer` when `developer_enabled == true`
///
/// This mirrors the EVM `setPeer` / `onlyOwnerOrDeveloper` pattern.
#[derive(Accounts)]
#[instruction(params: SetPeerConfigParams)]
pub struct SetPeerConfig<'info> {
    /// Must be either the admin or the enabled developer.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + PeerConfig::INIT_SPACE,
        seeds = [PEER_SEED, oft_store.key().as_ref(), &params.remote_eid.to_be_bytes()],
        bump
    )]
    pub peer: Account<'info, PeerConfig>,

    #[account(
        seeds = [OFT_SEED, oft_store.token_escrow.as_ref()],
        bump = oft_store.bump,
        constraint = is_authorized(&authority.key(), &oft_store) @OFTError::Unauthorized
    )]
    pub oft_store: Account<'info, OFTStore>,

    pub system_program: Program<'info, System>,
}

/// Returns true if the caller is the admin OR the (enabled) developer.
fn is_authorized(caller: &Pubkey, store: &OFTStore) -> bool {
    if *caller == store.admin {
        return true;
    }
    store.developer_enabled && *caller == store.developer
}

impl SetPeerConfig<'_> {
    pub fn apply(ctx: &mut Context<SetPeerConfig>, params: &SetPeerConfigParams) -> Result<()> {
        match params.config.clone() {
            PeerConfigParam::PeerAddress(peer_address) => {
                ctx.accounts.peer.peer_address = peer_address;
            },
            PeerConfigParam::FeeBps(fee_bps) => {
                if let Some(bps) = fee_bps {
                    require!(bps < MAX_FEE_BASIS_POINTS, OFTError::InvalidFee);
                }
                ctx.accounts.peer.fee_bps = fee_bps;
            },
            PeerConfigParam::EnforcedOptions { send, send_and_call } => {
                oapp::options::assert_type_3(&send)?;
                ctx.accounts.peer.enforced_options.send = send;
                oapp::options::assert_type_3(&send_and_call)?;
                ctx.accounts.peer.enforced_options.send_and_call = send_and_call;
            },
            PeerConfigParam::OutboundRateLimit(rate_limit_params) => {
                Self::update_rate_limiter(
                    &mut ctx.accounts.peer.outbound_rate_limiter,
                    &rate_limit_params,
                )?;
            },
            PeerConfigParam::InboundRateLimit(rate_limit_params) => {
                Self::update_rate_limiter(
                    &mut ctx.accounts.peer.inbound_rate_limiter,
                    &rate_limit_params,
                )?;
            },
        }
        ctx.accounts.peer.bump = ctx.bumps.peer;
        Ok(())
    }

    fn update_rate_limiter(
        rate_limiter: &mut Option<RateLimiter>,
        params: &Option<RateLimitParams>,
    ) -> Result<()> {
        if let Some(param) = params {
            let mut limiter = rate_limiter.clone().unwrap_or_default();
            if let Some(capacity) = param.capacity {
                limiter.set_capacity(capacity)?;
            }
            if let Some(refill_rate) = param.refill_per_second {
                limiter.set_rate(refill_rate)?;
            }
            *rate_limiter = Some(limiter);
        } else {
            *rate_limiter = None;
        }
        Ok(())
    }
}

// ─── Param types ─────────────────────────────────────────────────────────────

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SetPeerConfigParams {
    pub remote_eid: u32,
    pub config: PeerConfigParam,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub enum PeerConfigParam {
    /// Set the remote OFT address (bytes32 — EVM address left-padded, or Solana
    /// OFT Store PDA encoded as bytes32).
    PeerAddress([u8; 32]),
    /// Per-peer fee override (basis points).  None = use store default.
    FeeBps(Option<u16>),
    /// Minimum message options for sends to this peer.
    EnforcedOptions { send: Vec<u8>, send_and_call: Vec<u8> },
    /// Outbound rate limit configuration.
    OutboundRateLimit(Option<RateLimitParams>),
    /// Inbound rate limit configuration.
    InboundRateLimit(Option<RateLimitParams>),
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RateLimitParams {
    pub refill_per_second: Option<u64>,
    pub capacity: Option<u64>,
}
