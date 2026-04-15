/**
 * wire.ts — Register peers on the PAYE OFT Store (Solana side).
 *
 * Copyright (c) 2026 Krypto Capital LLC (Koinon). All rights reserved.
 *
 * Usage:
 *   npx ts-node app/scripts/wire.ts --cluster devnet [--dry-run]
 *   npx ts-node app/scripts/wire.ts --cluster mainnet [--dry-run]
 *
 * What this script does for devnet:
 *   - Registers Ethereum Sepolia (EID 40161) → EVM_SEPOLIA_PAYE_ADDRESS
 *   - Registers Linea Sepolia   (EID 40287) → EVM_LINEA_SEPOLIA_PAYE_ADDRESS
 *
 * What this script does for mainnet:
 *   - Registers Ethereum mainnet (EID 30101) → EVM_MAINNET_PAYE_ADDRESS
 *   - Registers Linea mainnet    (EID 30183) → EVM_LINEA_MAINNET_PAYE_ADDRESS
 *
 * The caller must be either the `admin` (treasury) or the enabled `developer`.
 * This script loads the deployer keypair by default (acts as developer).
 *
 * NOTE: The EVM side must separately call setPeer() pointing at this
 *       OFT Store PDA.  See SOLANA_README.md §Cross-chain wiring checklist.
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  EID_ETHEREUM_SEPOLIA,
  EID_ETHEREUM_MAINNET,
  EID_LINEA_SEPOLIA,
  EID_LINEA_MAINNET,
  derivePeer,
  evmAddressToBytes32,
  loadKeypair,
  loadDeployment,
  getConnection,
} from "./utils";

dotenv.config();

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const clusterArg =
  args.find((a) => a.startsWith("--cluster="))?.split("=")[1] ??
  (args[args.indexOf("--cluster") + 1] as string | undefined) ??
  "devnet";
const cluster = clusterArg as "devnet" | "mainnet";
const isDryRun = args.includes("--dry-run");

// ─── Peer configuration ───────────────────────────────────────────────────────

interface PeerEntry {
  remoteEid: number;
  label: string;
  envVar: string; // name of the env variable holding the EVM OFT address
}

const DEVNET_PEERS: PeerEntry[] = [
  {
    remoteEid: EID_ETHEREUM_SEPOLIA,
    label: "Ethereum Sepolia",
    envVar: "EVM_SEPOLIA_PAYE_ADDRESS",
  },
  {
    remoteEid: EID_LINEA_SEPOLIA,
    label: "Linea Sepolia",
    envVar: "EVM_LINEA_SEPOLIA_PAYE_ADDRESS",
  },
];

const MAINNET_PEERS: PeerEntry[] = [
  {
    remoteEid: EID_ETHEREUM_MAINNET,
    label: "Ethereum mainnet",
    envVar: "EVM_MAINNET_PAYE_ADDRESS",
  },
  {
    remoteEid: EID_LINEA_MAINNET,
    label: "Linea mainnet",
    envVar: "EVM_LINEA_MAINNET_PAYE_ADDRESS",
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== PAYE OFT Wire Peers ===`);
  console.log(`Cluster : ${cluster}`);
  console.log(`Dry run : ${isDryRun}\n`);

  const peers = cluster === "mainnet" ? MAINNET_PEERS : DEVNET_PEERS;

  // Validate env vars before submitting any transactions
  for (const peer of peers) {
    const addr = process.env[peer.envVar];
    if (!addr) {
      throw new Error(
        `${peer.envVar} is not set in .env. ` +
          `Please add the ${peer.label} PAYE contract address.`
      );
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      throw new Error(
        `${peer.envVar} value "${addr}" is not a valid EVM address (0x + 40 hex chars).`
      );
    }
  }

  const deployment = loadDeployment(cluster);
  const programId = new PublicKey(deployment.programId);
  const oftStore = new PublicKey(deployment.oftStore);

  console.log(`OFT Store : ${oftStore.toBase58()}`);
  console.log(`Program   : ${programId.toBase58()}\n`);

  if (isDryRun) {
    for (const peer of peers) {
      const addr = process.env[peer.envVar]!;
      const [peerPda] = derivePeer(programId, oftStore, peer.remoteEid);
      console.log(
        `[DRY RUN] Would set peer: ${peer.label} (EID ${peer.remoteEid})`
      );
      console.log(`          EVM address : ${addr}`);
      console.log(`          Peer PDA    : ${peerPda.toBase58()}`);
    }
    return;
  }

  const connection = getConnection(cluster);
  const caller = loadKeypair(); // developer (or treasury) keypair

  console.log(`Caller (developer) : ${caller.publicKey.toBase58()}`);

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(caller),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idlPath = path.join(process.cwd(), "target", "idl", "paye_oft.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}. Run \`anchor build\` first.`);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new anchor.Program(idl, provider);

  // ── Wire each peer ────────────────────────────────────────────────────────
  for (const peer of peers) {
    const evmAddr = process.env[peer.envVar]!;
    const peerBytes32 = evmAddressToBytes32(evmAddr);
    const [peerPda] = derivePeer(programId, oftStore, peer.remoteEid);

    console.log(`Wiring ${peer.label} (EID ${peer.remoteEid})…`);
    console.log(`  EVM address : ${evmAddr}`);
    console.log(`  Peer PDA    : ${peerPda.toBase58()}`);

    const tx = await program.methods
      .setPeerConfig({
        remoteEid: peer.remoteEid,
        config: { peerAddress: Array.from(peerBytes32) },
      })
      .accounts({
        authority: caller.publicKey,
        peer: peerPda,
        oftStore,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    console.log(`  ✓ tx : ${tx}\n`);
  }

  console.log("✓ All peers wired.");
  console.log(
    "\nRemember: also call setPeer() on each EVM chain pointing at:"
  );
  console.log(`  OFT Store PDA: ${oftStore.toBase58()}`);
  console.log(`  (as bytes32 : 0x${Buffer.from(new PublicKey(deployment.oftStore).toBytes()).toString("hex")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
