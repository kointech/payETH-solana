use crate::*;
use anchor_lang::solana_program;
use anchor_spl::{
    associated_token::{get_associated_token_address_with_program_id, ID as ASSOCIATED_TOKEN_ID},
    token_2022::spl_token_2022::solana_program::program_option::COption,
    token_interface::Mint,
};
use oapp::endpoint_cpi::LzAccount;

/// Returns the ordered list of accounts required for `lz_receive`.
///
/// The LayerZero Executor calls this view instruction off-chain to build the
/// transaction before submitting it on-chain.
#[derive(Accounts)]
pub struct LzReceiveTypes<'info> {
    #[account(
        seeds = [OFT_SEED, oft_store.token_escrow.as_ref()],
        bump = oft_store.bump
    )]
    pub oft_store: Account<'info, OFTStore>,
    #[account(address = oft_store.token_mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,
}

// Account ordering for lz_receive:
//   0:  payer (executor)               — writable signer
//   1:  peer PDA                       — writable
//   2:  oft_store PDA                  — writable
//   3:  token_escrow                   — writable
//   4:  to_address (wallet)            — read-only
//   5:  token_dest (ATA)               — writable
//   6:  token_mint                     — writable
//   7:  mint_authority                 — read-only (spl multisig or oft_store)
//   8:  token_program                  — read-only
//   9:  associated_token_program       — read-only
//  10:  system_program                 — read-only
//  11:  event_authority PDA            — read-only
//  12:  this program                   — read-only
// remaining[0..9]:   accounts for endpoint CPI `clear`
// remaining[9..16]:  accounts for endpoint CPI `send_compose` (if compose msg present)

impl LzReceiveTypes<'_> {
    pub fn apply(
        ctx: &Context<LzReceiveTypes>,
        params: &LzReceiveParams,
    ) -> Result<Vec<LzAccount>> {
        // Guard against truncated messages before deriving the recipient address.
        require!(
            params.message.len() >= msg_codec::COMPOSE_MSG_OFFSET,
            OFTError::InvalidMessage
        );

        let (peer, _) = Pubkey::find_program_address(
            &[PEER_SEED, ctx.accounts.oft_store.key().as_ref(), &params.src_eid.to_be_bytes()],
            ctx.program_id,
        );

        let mut accounts = vec![
            LzAccount { pubkey: Pubkey::default(), is_signer: true, is_writable: true }, // 0
            LzAccount { pubkey: peer, is_signer: false, is_writable: true },             // 1
            LzAccount {
                pubkey: ctx.accounts.oft_store.key(),
                is_signer: false,
                is_writable: true,
            }, // 2
            LzAccount {
                pubkey: ctx.accounts.oft_store.token_escrow,
                is_signer: false,
                is_writable: true,
            }, // 3
        ];

        let to_address = Pubkey::from(msg_codec::send_to(&params.message));
        let token_program = ctx.accounts.token_mint.to_account_info().owner;
        let token_dest = get_associated_token_address_with_program_id(
            &to_address,
            &ctx.accounts.oft_store.token_mint,
            token_program,
        );
        let mint_authority = if let COption::Some(ma) = ctx.accounts.token_mint.mint_authority {
            ma
        } else {
            *ctx.program_id
        };

        accounts.extend_from_slice(&[
            LzAccount { pubkey: to_address, is_signer: false, is_writable: false }, // 4
            LzAccount { pubkey: token_dest, is_signer: false, is_writable: true },  // 5
            LzAccount {
                pubkey: ctx.accounts.token_mint.key(),
                is_signer: false,
                is_writable: true,
            }, // 6
            LzAccount { pubkey: mint_authority, is_signer: false, is_writable: false }, // 7
            LzAccount { pubkey: *token_program, is_signer: false, is_writable: false }, // 8
            LzAccount { pubkey: ASSOCIATED_TOKEN_ID, is_signer: false, is_writable: false }, // 9
        ]);

        let (event_authority, _) = Pubkey::find_program_address(
            &[oapp::endpoint_cpi::EVENT_SEED],
            ctx.program_id,
        );
        accounts.extend_from_slice(&[
            LzAccount {
                pubkey: solana_program::system_program::ID,
                is_signer: false,
                is_writable: false,
            }, // 10
            LzAccount { pubkey: event_authority, is_signer: false, is_writable: false }, // 11
            LzAccount { pubkey: *ctx.program_id, is_signer: false, is_writable: false }, // 12
        ]);

        let endpoint_program = ctx.accounts.oft_store.endpoint_program;
        let accounts_for_clear = oapp::endpoint_cpi::get_accounts_for_clear(
            endpoint_program,
            &ctx.accounts.oft_store.key(),
            params.src_eid,
            &params.sender,
            params.nonce,
        );
        accounts.extend(accounts_for_clear);

        if let Some(message) = msg_codec::compose_msg(&params.message) {
            let amount_sd = msg_codec::amount_sd(&params.message);
            let amount_ld = ctx.accounts.oft_store.sd2ld(amount_sd)?;
            let accounts_for_compose = oapp::endpoint_cpi::get_accounts_for_send_compose(
                endpoint_program,
                &ctx.accounts.oft_store.key(),
                &to_address,
                &params.guid,
                0,
                &compose_msg_codec::encode(params.nonce, params.src_eid, amount_ld, &message),
            );
            accounts.extend(accounts_for_compose);
        }

        Ok(accounts)
    }
}
