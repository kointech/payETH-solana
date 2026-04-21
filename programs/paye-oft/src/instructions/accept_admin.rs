use crate::*;

/// Complete a two-step admin transfer by having the pending admin accept the role.
///
/// Workflow:
///   1. Current admin calls `set_oft_config(Admin(new_pubkey))` — sets `pending_admin`.
///   2. New admin calls `accept_admin` — promotes themselves and clears `pending_admin`.
///
/// If the current admin passed a wrong pubkey in step 1, the transfer can be
/// cancelled by nominating a different address (or `Pubkey::default()` to clear it)
/// before the nominee ever signs step 2.
#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    /// The nominated pending admin — must sign to accept the role.
    pub pending_admin: Signer<'info>,
    #[account(
        mut,
        seeds = [OFT_SEED, oft_store.token_escrow.as_ref()],
        bump = oft_store.bump,
        constraint = oft_store.pending_admin == Some(pending_admin.key()) @ OFTError::Unauthorized
    )]
    pub oft_store: Account<'info, OFTStore>,
}

impl AcceptAdmin<'_> {
    pub fn apply(ctx: &mut Context<AcceptAdmin>) -> Result<()> {
        let previous = ctx.accounts.oft_store.admin;
        let new_admin = ctx.accounts.pending_admin.key();

        ctx.accounts.oft_store.admin = new_admin;
        ctx.accounts.oft_store.pending_admin = None;

        emit!(crate::events::AdminAccepted {
            previous_admin: previous,
            new_admin,
        });

        Ok(())
    }
}
