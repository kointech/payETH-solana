/// OFT wire-message codec.
///
/// Message layout (big-endian):
///   [0..32]  send_to   — recipient address on destination chain (bytes32)
///   [32..40] amount_sd — token amount in *shared* decimals (u64, big-endian)
///   [40..]   compose_msg — optional compose data (sender pubkey + payload)

use crate::*;

const SEND_TO_OFFSET: usize = 0;
const SEND_AMOUNT_SD_OFFSET: usize = 32;
/// Minimum valid message length: 32 bytes (send_to) + 8 bytes (amount_sd).
/// Exported so callers can validate before decoding.
pub const COMPOSE_MSG_OFFSET: usize = 40;

/// Encode an OFT send message.
pub fn encode(
    send_to: [u8; 32],
    amount_sd: u64,
    sender: Pubkey,
    compose_msg: &Option<Vec<u8>>,
) -> Vec<u8> {
    if let Some(msg) = compose_msg {
        // with compose: 32 + 8 + 32 (sender) + msg
        let mut encoded = Vec::with_capacity(72 + msg.len());
        encoded.extend_from_slice(&send_to);
        encoded.extend_from_slice(&amount_sd.to_be_bytes());
        encoded.extend_from_slice(sender.to_bytes().as_ref());
        encoded.extend_from_slice(msg);
        encoded
    } else {
        let mut encoded = Vec::with_capacity(40);
        encoded.extend_from_slice(&send_to);
        encoded.extend_from_slice(&amount_sd.to_be_bytes());
        encoded
    }
}

pub fn send_to(message: &[u8]) -> [u8; 32] {
    let mut send_to = [0u8; 32];
    if let Some(slice) = message.get(SEND_TO_OFFSET..SEND_AMOUNT_SD_OFFSET) {
        send_to.copy_from_slice(slice);
    }
    send_to
}

pub fn amount_sd(message: &[u8]) -> u64 {
    let mut bytes = [0u8; 8];
    if let Some(slice) = message.get(SEND_AMOUNT_SD_OFFSET..COMPOSE_MSG_OFFSET) {
        bytes.copy_from_slice(slice);
    }
    u64::from_be_bytes(bytes)
}

pub fn compose_msg(message: &[u8]) -> Option<Vec<u8>> {
    if message.len() > COMPOSE_MSG_OFFSET {
        Some(message[COMPOSE_MSG_OFFSET..].to_vec())
    } else {
        None
    }
}
