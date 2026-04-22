use anchor_lang::prelude::error_code;

#[error_code]
pub enum OFTError {
    /// Caller is neither the admin nor an enabled developer.
    Unauthorized,
    /// The LayerZero sender does not match the registered peer.
    InvalidSender,
    /// The mint decimals are inconsistent with shared_decimals.
    InvalidDecimals,
    /// Received amount is below the caller's minimum acceptable amount.
    SlippageExceeded,
    /// The destination token account does not match the message recipient.
    InvalidTokenDest,
    /// A rate limit was exceeded.
    RateLimitExceeded,
    /// A fee parameter is out of range.
    InvalidFee,
    /// The mint authority is not the OFT store or an approved multisig.
    InvalidMintAuthority,
    /// All sends and receives are paused.
    Paused,
    /// `accept_admin` was called but no pending admin has been nominated.
    NoPendingAdmin,
    /// The LayerZero message payload is too short to be a valid OFT message.
    InvalidMessage,
    /// A token amount conversion would overflow u64 (amount_sd × ld2sd_rate > u64::MAX).
    ArithmeticOverflow,
}
