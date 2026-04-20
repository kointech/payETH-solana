/// Compose-message codec.
///
/// Layout (big-endian):
///   [0..8]   nonce      — source nonce (u64)
///   [8..12]  src_eid    — source chain EID (u32)
///   [12..20] amount_ld  — received amount in *local* decimals (u64)
///   [20..52] compose_from — sending wallet pubkey (bytes32)
///   [52..]   compose_msg  — application-defined payload

const NONCE_OFFSET: usize = 0;
const SRC_EID_OFFSET: usize = 8;
const AMOUNT_LD_OFFSET: usize = 12;
const COMPOSE_FROM_OFFSET: usize = 20;
const COMPOSE_MSG_OFFSET: usize = 52;

pub fn encode(nonce: u64, src_eid: u32, amount_ld: u64, compose_msg: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(20 + compose_msg.len());
    encoded.extend_from_slice(&nonce.to_be_bytes());
    encoded.extend_from_slice(&src_eid.to_be_bytes());
    encoded.extend_from_slice(&amount_ld.to_be_bytes());
    encoded.extend_from_slice(compose_msg);
    encoded
}

pub fn nonce(message: &[u8]) -> u64 {
    let mut b = [0u8; 8];
    if let Some(slice) = message.get(NONCE_OFFSET..SRC_EID_OFFSET) {
        b.copy_from_slice(slice);
    }
    u64::from_be_bytes(b)
}

pub fn src_eid(message: &[u8]) -> u32 {
    let mut b = [0u8; 4];
    if let Some(slice) = message.get(SRC_EID_OFFSET..AMOUNT_LD_OFFSET) {
        b.copy_from_slice(slice);
    }
    u32::from_be_bytes(b)
}

pub fn amount_ld(message: &[u8]) -> u64 {
    let mut b = [0u8; 8];
    if let Some(slice) = message.get(AMOUNT_LD_OFFSET..COMPOSE_FROM_OFFSET) {
        b.copy_from_slice(slice);
    }
    u64::from_be_bytes(b)
}

pub fn compose_from(message: &[u8]) -> [u8; 32] {
    let mut b = [0u8; 32];
    if let Some(slice) = message.get(COMPOSE_FROM_OFFSET..COMPOSE_MSG_OFFSET) {
        b.copy_from_slice(slice);
    }
    b
}

pub fn compose_msg(message: &[u8]) -> Vec<u8> {
    if message.len() > COMPOSE_MSG_OFFSET {
        message[COMPOSE_MSG_OFFSET..].to_vec()
    } else {
        Vec::new()
    }
}
