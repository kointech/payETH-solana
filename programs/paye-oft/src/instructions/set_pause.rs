use crate::*;

/// Emergency pause / unpause.
///
/// - To **pause**:   must be signed by the `pauser` (if set), otherwise by `admin`.
/// - To **unpause**: must be signed by the `unpauser` (if set), otherwise by `admin`.
#[derive(Accounts)]
#[instruction(params: SetPauseParams)]
pub struct SetPause<'info> {
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [OFT_SEED, oft_store.token_escrow.as_ref()],
        bump = oft_store.bump,
        constraint = is_valid_signer(signer.key(), &oft_store, params.paused) @OFTError::Unauthorized
    )]
    pub oft_store: Account<'info, OFTStore>,
}

impl SetPause<'_> {
    pub fn apply(ctx: &mut Context<SetPause>, params: &SetPauseParams) -> Result<()> {
        ctx.accounts.oft_store.paused = params.paused;
        Ok(())
    }
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SetPauseParams {
    pub paused: bool,
}

fn is_valid_signer(signer: Pubkey, store: &OFTStore, paused: bool) -> bool {
    if paused {
        // Pause: pauser (if set) or admin
        store.pauser.map_or(signer == store.admin, |p| signer == p)
    } else {
        // Unpause: unpauser (if set) or admin
        store.unpauser.map_or(signer == store.admin, |u| signer == u)
    }
}
