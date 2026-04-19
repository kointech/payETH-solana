/**
 * Shared utilities for PAYE Solana deployment scripts.
 *
 * Copyright (c) 2026 Krypto Capital LLC (Koinon). All rights reserved.
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import bs58 from "bs58";

dotenv.config();

// ─── PAYE constants ────────────────────────────────────────────────────────────

export const PAYE_DECIMALS = 4;
export const PAYE_SHARED_DECIMALS = 4;
export const PAYE_NAME = "PayETH";
export const PAYE_SYMBOL = "PAYE";

// LayerZero Endpoint IDs
export const EID_ETHEREUM_MAINNET = 30101;
export const EID_ETHEREUM_SEPOLIA = 40161;
export const EID_LINEA_MAINNET = 30183;
export const EID_LINEA_SEPOLIA = 40287;
export const EID_BASE_MAINNET = 30184;
export const EID_BASE_SEPOLIA = 40245;
export const EID_SOLANA_MAINNET = 30168;
export const EID_SOLANA_DEVNET = 40168;

// LayerZero Endpoint program IDs (Solana)
export const LZ_ENDPOINT_MAINNET = new PublicKey(
  "76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6"
);
export const LZ_ENDPOINT_DEVNET = new PublicKey(
  "76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6"
);

// ─── Keypair helpers ──────────────────────────────────────────────────────────

export function loadKeypair(): Keypair {
  // Priority: SOLANA_PRIVATE_KEY env var → SOLANA_KEYPAIR_PATH → default path
  const privateKeyStr = process.env.SOLANA_PRIVATE_KEY;
  if (privateKeyStr) {
    try {
      // Try Uint8Array JSON format first: [1,2,...,64]
      const arr = JSON.parse(privateKeyStr) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } catch {
      // Fall back to base-58 string
      return Keypair.fromSecretKey(bs58.decode(privateKeyStr));
    }
  }

  const keypairPath =
    process.env.SOLANA_KEYPAIR_PATH ||
    path.join(process.env.HOME || "~", ".config", "solana", "id.json");
  const raw = fs.readFileSync(keypairPath, "utf-8");
  const arr = JSON.parse(raw) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

export function loadTreasuryKeypair(): Keypair {
  const path_ = process.env.TREASURY_KEYPAIR_PATH;
  if (!path_) {
    throw new Error(
      "TREASURY_KEYPAIR_PATH not set. Treasury keypair must be supplied explicitly."
    );
  }
  const raw = fs.readFileSync(path_, "utf-8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

// ─── Connection ───────────────────────────────────────────────────────────────

export function getConnection(cluster: "devnet" | "mainnet"): Connection {
  const url =
    cluster === "mainnet"
      ? process.env.RPC_URL_SOLANA || "https://api.mainnet-beta.solana.com"
      : process.env.RPC_URL_SOLANA_TESTNET || "https://api.devnet.solana.com";
  return new Connection(url, "confirmed");
}

// ─── PDA derivation ───────────────────────────────────────────────────────────

export const OFT_SEED = Buffer.from("OFT");
export const PEER_SEED = Buffer.from("Peer");

export function deriveOftStore(
  programId: PublicKey,
  tokenEscrow: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [OFT_SEED, tokenEscrow.toBuffer()],
    programId
  );
}

export function derivePeer(
  programId: PublicKey,
  oftStore: PublicKey,
  remoteEid: number
): [PublicKey, number] {
  const eidBuf = Buffer.alloc(4);
  eidBuf.writeUInt32BE(remoteEid, 0);
  return PublicKey.findProgramAddressSync(
    [PEER_SEED, oftStore.toBuffer(), eidBuf],
    programId
  );
}

// ─── EVM address → bytes32 ────────────────────────────────────────────────────

/** Left-pad an EVM hex address to a 32-byte array (bytes32). */
export function evmAddressToBytes32(address: string): Uint8Array {
  const clean = address.replace(/^0x/, "").toLowerCase();
  if (clean.length !== 40) {
    throw new Error(`Invalid EVM address: ${address}`);
  }
  const bytes = new Uint8Array(32);
  const addrBytes = Buffer.from(clean, "hex");
  bytes.set(addrBytes, 12); // left-pad 12 zero bytes
  return bytes;
}

/** Convert a Solana PublicKey to a bytes32 array for use in EVM setPeer calls. */
export function solanaKeyToBytes32(pk: PublicKey): Uint8Array {
  return pk.toBytes(); // already 32 bytes
}

// ─── Deployment record helpers ────────────────────────────────────────────────

export interface DeploymentRecord {
  cluster: string;
  programId: string;
  tokenMint: string;
  tokenEscrow: string;
  oftStore: string;
  admin: string;
  developer: string;
  deployedAt: string;
}

export function saveDeployment(
  cluster: "devnet" | "mainnet",
  record: DeploymentRecord
): void {
  const dir = path.join(process.cwd(), "deployments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `solana-${cluster}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`Deployment saved to ${file}`);
}

export function loadDeployment(cluster: "devnet" | "mainnet"): DeploymentRecord {
  const file = path.join(
    process.cwd(),
    "deployments",
    `solana-${cluster}.json`
  );
  if (!fs.existsSync(file)) {
    throw new Error(
      `No deployment found for ${cluster}. Run deploy-${cluster} first.`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as DeploymentRecord;
}
