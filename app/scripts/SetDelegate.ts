/**
 * SetDelegate.ts — One-time admin operation: set the LayerZero endpoint delegate.
 *
 * Copyright (c) 2026 Krypto Capital LLC (Koinon). All rights reserved.
 *
 * Run this ONCE as admin after deploying the OFT, before handing off to the
 * developer.  Sets oapp_registry.delegate = DELEGATE_ADDRESS on the LZ endpoint
 * so the developer key can call initSendLibrary / initReceiveLibrary / setOappConfig
 * without needing the admin key again.
 *
 * Usage:
 *   DELEGATE_ADDRESS=<developer-pubkey> \
 *     npx ts-node app/scripts/SetDelegate.ts --cluster devnet
 *
 * Required env vars:
 *   DELEGATE_ADDRESS — Solana public key of the delegate (usually the developer wallet)
 *
 * Signer: SOLANA_KEYPAIR_PATH / SOLANA_PRIVATE_KEY  → must be the OFT admin
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { EndpointPDADeriver, EventPDADeriver } from "@layerzerolabs/lz-solana-sdk-v2";
import { loadKeypair, loadDeployment, getConnection } from "./utils";

dotenv.config();

// ─── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const _clusterIdx = args.indexOf("--cluster");
const clusterArg =
  args.find((a) => a.startsWith("--cluster="))?.split("=")[1] ??
  (_clusterIdx !== -1 ? args[_clusterIdx + 1] : undefined) ??
  "devnet";
const cluster = clusterArg as "devnet" | "mainnet";

// ─── Constants ─────────────────────────────────────────────────────────────────

const LZ_ENDPOINT_PROGRAM = "76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6";

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const delegateStr = process.env.DELEGATE_ADDRESS;
  if (!delegateStr) throw new Error("DELEGATE_ADDRESS env var is required.");
  const delegate = new PublicKey(delegateStr);

  const deployment = loadDeployment(cluster);
  const programId  = new PublicKey(deployment.programId);
  const oftStore   = new PublicKey(deployment.oftStore);

  const connection = getConnection(cluster);
  const admin = loadKeypair();  // must be the OFT admin

  console.log(`\n=== SetDelegate — Solana ${cluster} ===`);
  console.log(`OFT Store : ${oftStore.toBase58()}`);
  console.log(`Admin     : ${admin.publicKey.toBase58()}`);
  console.log(`Delegate  : ${delegate.toBase58()}\n`);

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(admin),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idlPath = path.join(process.cwd(), "target", "idl", "paye_oft.json");
  if (!fs.existsSync(idlPath)) throw new Error(`IDL not found at ${idlPath}. Run \`anchor build\` first.`);
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new anchor.Program(idl, provider);

  const endpointPubkey = new PublicKey(LZ_ENDPOINT_PROGRAM);
  const [oappRegistry]  = new EndpointPDADeriver(endpointPubkey).oappRegistry(oftStore);
  const [eventAuthority] = new EventPDADeriver(endpointPubkey).eventAuthority();

  const tx = await program.methods
    .setOftConfig({ delegate: [delegate] })
    .accounts({ admin: admin.publicKey, oftStore } as any)
    .remainingAccounts([
      { pubkey: endpointPubkey, isSigner: false, isWritable: false },
      { pubkey: oftStore,       isSigner: false, isWritable: false },
      { pubkey: oappRegistry,   isSigner: false, isWritable: true  },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: endpointPubkey, isSigner: false, isWritable: false },
    ])
    .rpc({ commitment: "confirmed" });

  console.log(`✓ Delegate set — tx: ${tx}`);
  console.log(`\nThe developer can now run configure-lz-devnet / configure-lz-mainnet independently.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
