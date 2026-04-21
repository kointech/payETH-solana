use crate::*;
use oapp::endpoint::instructions::SetDelegateParams;

/// Update the OFT Store configuration.
/// Only the `admin` may call this instruction.
#[derive(Accounts)]
pub struct SetOFTConfig<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [OFT_SEED, oft_store.token_escrow.as_ref()],
        bump = oft_store.bump,
        has_one = admin @OFTError::Unauthorized
    )]
    pub oft_store: Account<'info, OFTStore>,
}

impl SetOFTConfig<'_> {
    pub fn apply(ctx: &mut Context<SetOFTConfig>, params: &SetOFTConfigParams) -> Result<()> {
        match params.clone() {
            SetOFTConfigParams::Admin(new_admin) => {
                // Step 1 of two-step ownership transfer: nominate the new admin.
                // The nominee must call `accept_admin` to complete the transfer.
                let current = ctx.accounts.oft_store.admin;
                ctx.accounts.oft_store.pending_admin = Some(new_admin);
                emit!(crate::events::AdminTransferInitiated {
                    current_admin: current,
                    pending_admin: new_admin,
                });
            },
            SetOFTConfigParams::Delegate(delegate) => {
                // Update the OApp delegate on the LayerZero Endpoint.
                let seed = ctx.accounts.oft_store.token_escrow.key();
                let seeds: &[&[u8]] =
                    &[OFT_SEED, seed.as_ref(), &[ctx.accounts.oft_store.bump]];
                oapp::endpoint_cpi::set_delegate(
                    ctx.accounts.oft_store.endpoint_program,
                    ctx.accounts.oft_store.key(),
                    ctx.remaining_accounts,
                    seeds,
                    SetDelegateParams { delegate },
                )?;
            },
            SetOFTConfigParams::DefaultFee(fee_bps) => {
                require!(fee_bps < MAX_FEE_BASIS_POINTS, OFTError::InvalidFee);
                ctx.accounts.oft_store.default_fee_bps = fee_bps;
            },
            SetOFTConfigParams::Paused(paused) => {
                ctx.accounts.oft_store.paused = paused;
            },
            SetOFTConfigParams::Pauser(pauser) => {
                ctx.accounts.oft_store.pauser = pauser;
            },
            SetOFTConfigParams::Unpauser(unpauser) => {
                ctx.accounts.oft_store.unpauser = unpauser;
            },
            // ── Developer role management ────────────────────────────────
            SetOFTConfigParams::Developer(new_developer) => {
                let previous = ctx.accounts.oft_store.developer;
                ctx.accounts.oft_store.developer = new_developer;
                // Mirror EVM behaviour: setting developer to the zero address
                // auto-disables the role to prevent an inconsistent state.
                if new_developer == Pubkey::default() {
                    ctx.accounts.oft_store.developer_enabled = false;
                    emit!(crate::events::DeveloperToggled { enabled: false });
                }
                emit!(crate::events::DeveloperChanged {
                    previous_developer: previous,
                    new_developer,
                });
            },
            SetOFTConfigParams::DeveloperEnabled(enabled) => {
                ctx.accounts.oft_store.developer_enabled = enabled;
                emit!(crate::events::DeveloperToggled { enabled });
            },
        }
        Ok(())
    }
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub enum SetOFTConfigParams {
    /// Transfer admin role to a new address.
    Admin(Pubkey),
    /// Update the LayerZero OApp delegate (the address that can configure DVNs etc.).
    Delegate(Pubkey),
    /// Set the default protocol fee (basis points, 0–9999).
    DefaultFee(u16),
    /// Forcibly set the paused state (admin only shortcut).
    Paused(bool),
    /// Set the optional pauser address.
    Pauser(Option<Pubkey>),
    /// Set the optional unpauser address.
    Unpauser(Option<Pubkey>),
    /// Set the developer address (mirrors EVM `setDeveloper`).
    Developer(Pubkey),
    /// Enable or disable the developer role (mirrors EVM `enableDeveloper` / `disableDeveloper`).
    DeveloperEnabled(bool),
}
