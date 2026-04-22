use crate::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use oapp::endpoint::{instructions::RegisterOAppParams, ID as ENDPOINT_ID};

/// Initialise the OFT Store PDA and the escrow token account, then register
/// the OApp with the LayerZero Endpoint.
///
/// Must be called once, immediately after deployment.  The supplied `admin`
/// becomes the treasury authority.  The transaction signer (deployer) is set
/// as the initial `developer` and as the initial LayerZero OApp delegate so
/// they can wire peers + endpoint/ULN/DVN config without holding the treasury
/// key — mirroring the EVM constructor behaviour.
///
/// PAYE parameters:
///   - `shared_decimals` must be 6 (must match the EVM sharedDecimals)
///   - `oft_type`        must be `OFTType::Native` (remote chain: burn/mint)
#[derive(Accounts)]
pub struct InitOFT<'info> {
    /// Deployer / payer.  Becomes the initial `developer`.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// OFT Store PDA — central config account.
    #[account(
        init,
        payer = payer,
        space = 8 + OFTStore::INIT_SPACE,
        seeds = [OFT_SEED, token_escrow.key().as_ref()],
        bump
    )]
    pub oft_store: Account<'info, OFTStore>,

    /// Auxiliary account used by `lz_receive_types`.
    #[account(
        init,
        payer = payer,
        space = 8 + LzReceiveTypesAccounts::INIT_SPACE,
        seeds = [LZ_RECEIVE_TYPES_SEED, oft_store.key().as_ref()],
        bump
    )]
    pub lz_receive_types_accounts: Account<'info, LzReceiveTypesAccounts>,

    /// The PAYE SPL mint (18 decimals).  Must already exist before calling this.
    #[account(mint::token_program = token_program)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// Escrow token account — owned by the OFT store, holds TVL and fees.
    #[account(
        init,
        payer = payer,
        token::authority = oft_store,
        token::mint = token_mint,
        token::token_program = token_program,
    )]
    pub token_escrow: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl InitOFT<'_> {
    pub fn apply(ctx: &mut Context<InitOFT>, params: &InitOFTParams) -> Result<()> {
        // Validate that shared_decimals == PAYE_SHARED_DECIMALS (6)
        require!(
            ctx.accounts.token_mint.decimals >= params.shared_decimals,
            OFTError::InvalidDecimals
        );

        // Compute conversion rate: 10^(local_dec - shared_dec).
        // For PAYE: 18 - 6 = 12 → rate = 10^12.
        ctx.accounts.oft_store.ld2sd_rate =
            10u64.pow((ctx.accounts.token_mint.decimals - params.shared_decimals) as u32);

        ctx.accounts.oft_store.oft_type = params.oft_type.clone();
        ctx.accounts.oft_store.token_mint = ctx.accounts.token_mint.key();
        ctx.accounts.oft_store.token_escrow = ctx.accounts.token_escrow.key();
        ctx.accounts.oft_store.endpoint_program =
            params.endpoint_program.unwrap_or(ENDPOINT_ID);
        ctx.accounts.oft_store.bump = ctx.bumps.oft_store;
        ctx.accounts.oft_store.tvl_ld = 0;
        ctx.accounts.oft_store.admin = params.admin;
        ctx.accounts.oft_store.default_fee_bps = 0;
        ctx.accounts.oft_store.paused = false;
        ctx.accounts.oft_store.pauser = None;
        ctx.accounts.oft_store.unpauser = None;
        ctx.accounts.oft_store.pending_admin = None;

        // Deployer (payer) becomes the initial developer so they can wire peers
        // immediately without holding the treasury key.
        ctx.accounts.oft_store.developer = ctx.accounts.payer.key();
        ctx.accounts.oft_store.developer_enabled = true;

        emit!(crate::events::DeveloperChanged {
            previous_developer: Pubkey::default(),
            new_developer: ctx.accounts.payer.key(),
        });
        emit!(crate::events::DeveloperToggled { enabled: true });

        // Initialise lz_receive_types auxiliary account
        ctx.accounts.lz_receive_types_accounts.oft_store = ctx.accounts.oft_store.key();
        ctx.accounts.lz_receive_types_accounts.token_mint = ctx.accounts.token_mint.key();

        // Register this OApp with the LayerZero Endpoint.
        // The deployer (payer) becomes the initial delegate so developer
        // operations can run immediately after deployment.
        oapp::endpoint_cpi::register_oapp(
            ctx.accounts.oft_store.endpoint_program,
            ctx.accounts.oft_store.key(),
            ctx.remaining_accounts,
            &[OFT_SEED, ctx.accounts.token_escrow.key().as_ref(), &[ctx.bumps.oft_store]],
            RegisterOAppParams { delegate: ctx.accounts.payer.key() },
        )
    }
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct InitOFTParams {
    /// Must be `OFTType::Native` for PAYE on Solana.
    pub oft_type: OFTType,
    /// Koinon treasury wallet — becomes the `admin`.
    pub admin: Pubkey,
    /// Must be 4 to match the EVM deployment.
    pub shared_decimals: u8,
    /// Override for the LayerZero endpoint program (None = use the default).
    pub endpoint_program: Option<Pubkey>,
}
