use crate::*;
use anchor_lang::solana_program;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::spl_token_2022::{self, solana_program::program_option::COption},
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use oapp::endpoint::{
    cpi::accounts::Clear,
    instructions::{ClearParams, SendComposeParams},
    ConstructCPIContext,
};

/// Receive PAYE tokens from another chain.
///
/// Called by the LayerZero Endpoint when a message arrives from an EVM chain.
/// For the Native OFT type (Solana remote chain) this instruction **mints**
/// new PAYE tokens directly to the recipient's associated token account.
///
/// Security: the message is validated against the registered peer before minting.
#[event_cpi]
#[derive(Accounts)]
#[instruction(params: LzReceiveParams)]
pub struct LzReceive<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [PEER_SEED, oft_store.key().as_ref(), &params.src_eid.to_be_bytes()],
        bump = peer.bump,
        constraint = peer.peer_address == params.sender @OFTError::InvalidSender
    )]
    pub peer: Account<'info, PeerConfig>,

    #[account(
        mut,
        seeds = [OFT_SEED, oft_store.token_escrow.as_ref()],
        bump = oft_store.bump
    )]
    pub oft_store: Account<'info, OFTStore>,

    #[account(
        mut,
        address = oft_store.token_escrow,
        token::authority = oft_store,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub token_escrow: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: validated via msg_codec::send_to — must match the message recipient.
    #[account(address = Pubkey::from(msg_codec::send_to(&params.message)) @OFTError::InvalidTokenDest)]
    pub to_address: AccountInfo<'info>,

    /// Recipient's associated token account — created if it does not yet exist.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = to_address,
        associated_token::token_program = token_program
    )]
    pub token_dest: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        address = oft_store.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    // Mint authority — for Native OFT this is:
    //   1. A spl-token multisig with oft_store as a signer (1-of-n, recommended), OR
    //   2. The oft_store PDA itself.
    #[account(constraint = token_mint.mint_authority == COption::Some(mint_authority.key()) @OFTError::InvalidMintAuthority)]
    pub mint_authority: Option<AccountInfo<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl LzReceive<'_> {
    pub fn apply(ctx: &mut Context<LzReceive>, params: &LzReceiveParams) -> Result<()> {
        require!(!ctx.accounts.oft_store.paused, OFTError::Paused);

        let escrow_key = ctx.accounts.token_escrow.key();
        let seeds: &[&[u8]] = &[OFT_SEED, escrow_key.as_ref(), &[ctx.accounts.oft_store.bump]];

        // Validate the LayerZero packet and clear the message queue
        let accounts_for_clear = &ctx.remaining_accounts[0..Clear::MIN_ACCOUNTS_LEN];
        oapp::endpoint_cpi::clear(
            ctx.accounts.oft_store.endpoint_program,
            ctx.accounts.oft_store.key(),
            accounts_for_clear,
            seeds,
            ClearParams {
                receiver: ctx.accounts.oft_store.key(),
                src_eid: params.src_eid,
                sender: params.sender,
                nonce: params.nonce,
                guid: params.guid,
                message: params.message.clone(),
            },
        )?;

        // Decode amount and apply inbound rate limit
        let amount_sd = msg_codec::amount_sd(&params.message);
        let amount_received_ld = ctx.accounts.oft_store.sd2ld(amount_sd);

        if let Some(rl) = ctx.accounts.peer.inbound_rate_limiter.as_mut() {
            rl.try_consume(amount_received_ld)?;
        }
        if let Some(rl) = ctx.accounts.peer.outbound_rate_limiter.as_mut() {
            rl.refill(amount_received_ld)?;
        }

        // Mint tokens to recipient
        // PAYE on Solana is always Native (burn/mint), never Adapter.
        let mint_authority =
            ctx.accounts.mint_authority.as_ref().ok_or(error!(OFTError::InvalidMintAuthority))?;

        let ix = spl_token_2022::instruction::mint_to(
            ctx.accounts.token_program.key,
            &ctx.accounts.token_mint.key(),
            &ctx.accounts.token_dest.key(),
            mint_authority.key,
            &[&ctx.accounts.oft_store.key()],
            amount_received_ld,
        )?;
        solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.token_dest.to_account_info(),
                ctx.accounts.token_mint.to_account_info(),
                mint_authority.to_account_info(),
                ctx.accounts.oft_store.to_account_info(),
            ],
            &[seeds],
        )?;

        // Forward compose message if present
        if let Some(message) = msg_codec::compose_msg(&params.message) {
            oapp::endpoint_cpi::send_compose(
                ctx.accounts.oft_store.endpoint_program,
                ctx.accounts.oft_store.key(),
                &ctx.remaining_accounts[Clear::MIN_ACCOUNTS_LEN..],
                seeds,
                SendComposeParams {
                    to: ctx.accounts.to_address.key(),
                    guid: params.guid,
                    index: 0,
                    message: compose_msg_codec::encode(
                        params.nonce,
                        params.src_eid,
                        amount_received_ld,
                        &message,
                    ),
                },
            )?;
        }

        emit_cpi!(OFTReceived {
            guid: params.guid,
            src_eid: params.src_eid,
            to: ctx.accounts.to_address.key(),
            amount_received_ld,
        });

        Ok(())
    }
}
