use crate::*;
use anchor_spl::token_interface::Mint;
use oapp::endpoint::{instructions::QuoteParams, MessagingFee};

/// Quote the LayerZero native/LZ-token fee for a send operation.
/// Does not submit a transaction — safe to call as a simulation.
#[derive(Accounts)]
#[instruction(params: QuoteSendParams)]
pub struct QuoteSend<'info> {
    #[account(
        seeds = [OFT_SEED, oft_store.token_escrow.as_ref()],
        bump = oft_store.bump
    )]
    pub oft_store: Account<'info, OFTStore>,
    #[account(
        seeds = [PEER_SEED, oft_store.key().as_ref(), &params.dst_eid.to_be_bytes()],
        bump = peer.bump
    )]
    pub peer: Account<'info, PeerConfig>,
    #[account(address = oft_store.token_mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,
}

impl QuoteSend<'_> {
    pub fn apply(ctx: &Context<QuoteSend>, params: &QuoteSendParams) -> Result<MessagingFee> {
        require!(!ctx.accounts.oft_store.paused, OFTError::Paused);

        let (_, amount_received_ld, _) = compute_fee_and_adjust_amount(
            params.amount_ld,
            &ctx.accounts.oft_store,
            &ctx.accounts.token_mint,
            ctx.accounts.peer.fee_bps,
        )?;
        require!(amount_received_ld >= params.min_amount_ld, OFTError::SlippageExceeded);

        oapp::endpoint_cpi::quote(
            ctx.accounts.oft_store.endpoint_program,
            ctx.remaining_accounts,
            QuoteParams {
                sender: ctx.accounts.oft_store.key(),
                dst_eid: params.dst_eid,
                receiver: ctx.accounts.peer.peer_address,
                message: msg_codec::encode(
                    params.to,
                    amount_received_ld,
                    Pubkey::default(),
                    &params.compose_msg,
                ),
                pay_in_lz_token: params.pay_in_lz_token,
                options: ctx
                    .accounts
                    .peer
                    .enforced_options
                    .combine_options(&params.compose_msg, &params.options)?,
            },
        )
    }
}

/// Compute fees and return (amount_sent_ld, amount_received_ld, oft_fee_ld).
pub fn compute_fee_and_adjust_amount(
    amount_ld: u64,
    oft_store: &OFTStore,
    token_mint: &InterfaceAccount<Mint>,
    fee_bps: Option<u16>,
) -> Result<(u64, u64, u64)> {
    use anchor_spl::token_2022::spl_token_2022::{
        extension::{transfer_fee::TransferFeeConfig, BaseStateWithExtensions, StateWithExtensions},
        state::Mint as MintState,
    };

    let (amount_sent_ld, amount_received_ld, oft_fee_ld) = if OFTType::Adapter == oft_store.oft_type
    {
        let token_mint_info = token_mint.to_account_info();
        let data = token_mint_info.try_borrow_data()?;
        let ext = StateWithExtensions::<MintState>::unpack(&data)?;

        // Adapter: account for token-2022 transfer fee
        let amount_received_ld = oft_store.remove_dust(
            if let Ok(tf) = ext.get_extension::<TransferFeeConfig>() {
                tf.get_epoch_fee(Clock::get()?.epoch)
                    .calculate_post_fee_amount(amount_ld)
                    .ok_or(ProgramError::InvalidArgument)?
            } else {
                amount_ld
            },
        );
        // Compute pre-fee amount (amount the user must hold)
        let token_mint_info2 = token_mint.to_account_info();
        let data2 = token_mint_info2.try_borrow_data()?;
        let ext2 = StateWithExtensions::<MintState>::unpack(&data2)?;
        let amount_sent_ld = if let Ok(tf) = ext2.get_extension::<TransferFeeConfig>() {
            calculate_pre_fee_amount(tf.get_epoch_fee(Clock::get()?.epoch), amount_received_ld)
                .ok_or(ProgramError::InvalidArgument)?
        } else {
            amount_received_ld
        };
        let oft_fee_ld =
            oft_store.remove_dust(calculate_fee(amount_received_ld, oft_store.default_fee_bps, fee_bps));
        let amount_received_ld = amount_received_ld - oft_fee_ld;
        (amount_sent_ld, amount_received_ld, oft_fee_ld)
    } else {
        // Native: no token-2022 transfer fee
        let amount_sent_ld = oft_store.remove_dust(amount_ld);
        let oft_fee_ld =
            oft_store.remove_dust(calculate_fee(amount_sent_ld, oft_store.default_fee_bps, fee_bps));
        let amount_received_ld = amount_sent_ld - oft_fee_ld;
        (amount_sent_ld, amount_received_ld, oft_fee_ld)
    };

    Ok((amount_sent_ld, amount_received_ld, oft_fee_ld))
}

fn calculate_fee(pre_fee_amount: u64, default_fee_bps: u16, fee_bps: Option<u16>) -> u64 {
    let bps = if let Some(b) = fee_bps { b as u128 } else { default_fee_bps as u128 };
    if bps == 0 || pre_fee_amount == 0 {
        return 0;
    }
    ((pre_fee_amount as u128) * bps / ONE_IN_BASIS_POINTS) as u64
}

// ─── Token-2022 transfer-fee helpers (bug workaround — do not change) ─────────
// Reference: https://github.com/solana-labs/solana-program-library/pull/6704

pub const MAX_FEE_BASIS_POINTS: u16 = 10_000;
const ONE_IN_BASIS_POINTS: u128 = MAX_FEE_BASIS_POINTS as u128;

use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::TransferFee;

fn calculate_pre_fee_amount(fee: &TransferFee, post_fee_amount: u64) -> Option<u64> {
    let maximum_fee = u64::from(fee.maximum_fee);
    let bps = u16::from(fee.transfer_fee_basis_points) as u128;
    match (bps, post_fee_amount) {
        (0, _) => Some(post_fee_amount),
        (_, 0) => Some(0),
        (ONE_IN_BASIS_POINTS, _) => maximum_fee.checked_add(post_fee_amount),
        _ => {
            let numerator = (post_fee_amount as u128).checked_mul(ONE_IN_BASIS_POINTS)?;
            let denominator = ONE_IN_BASIS_POINTS.checked_sub(bps)?;
            let raw = ceil_div(numerator, denominator)?;
            if raw.checked_sub(post_fee_amount as u128)? >= maximum_fee as u128 {
                post_fee_amount.checked_add(maximum_fee)
            } else {
                u64::try_from(raw).ok()
            }
        },
    }
}

fn ceil_div(n: u128, d: u128) -> Option<u128> {
    n.checked_add(d)?.checked_sub(1)?.checked_div(d)
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct QuoteSendParams {
    pub dst_eid: u32,
    pub to: [u8; 32],
    pub amount_ld: u64,
    pub min_amount_ld: u64,
    pub options: Vec<u8>,
    pub compose_msg: Option<Vec<u8>>,
    pub pay_in_lz_token: bool,
}
