use crate::*;
use anchor_lang::system_program;

/// Recover excess SOL (lamports) that have accumulated in the OFT store PDA.
///
/// # Why this is safe
/// This instruction **only touches SOL lamports** — it has no access to SPL
/// token balances whatsoever.  PAYE tokens live in a completely separate
/// `token_escrow` account and are fully protected by `withdraw_fee`'s
/// `tvl_ld` accounting.  There is no way for this instruction to move any
/// PAYE tokens.
///
/// # When lamports accumulate
/// Any wallet can transfer SOL directly to a PDA address (e.g. by accident or
/// to cover rent).  Without this instruction those lamports would be
/// permanently locked because PDAs cannot sign standard system transfers on
/// their own.
///
/// # What is recovered
/// Only the lamports **above the rent-exempt minimum** are transferable, so
/// this instruction can never reduce the account below the minimum required by
/// the runtime to keep it alive.
///
/// Only the `admin` may call this.
#[derive(Accounts)]
pub struct RecoverLamports<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [OFT_SEED, oft_store.token_escrow.as_ref()],
        bump = oft_store.bump,
        has_one = admin @OFTError::Unauthorized
    )]
    pub oft_store: Account<'info, OFTStore>,

    /// Destination for the recovered lamports (any writable account).
    /// CHECK: arbitrary destination chosen by the admin; no constraint needed.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl RecoverLamports<'_> {
    pub fn apply(ctx: &mut Context<RecoverLamports>) -> Result<()> {
        let rent = Rent::get()?;
        let rent_exempt_min =
            rent.minimum_balance(ctx.accounts.oft_store.to_account_info().data_len());

        let current_lamports = ctx.accounts.oft_store.to_account_info().lamports();

        // Nothing to recover if the account holds no excess lamports.
        let recoverable = current_lamports.saturating_sub(rent_exempt_min);
        if recoverable == 0 {
            return Ok(());
        }

        // Transfer via the system program, signed by the OFT store PDA.
        let escrow_key = ctx.accounts.oft_store.token_escrow.key();
        let seeds: &[&[u8]] = &[OFT_SEED, escrow_key.as_ref(), &[ctx.accounts.oft_store.bump]];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.oft_store.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                },
                &[seeds],
            ),
            recoverable,
        )?;

        Ok(())
    }
}
