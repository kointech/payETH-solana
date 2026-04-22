/**
 * deploy.ts — Deploy the PAYE OFT on Solana devnet or mainnet.
 *
 * Copyright (c) 2026 Krypto Capital LLC (Koinon). All rights reserved.
 *
 * Usage:
 *   npx ts-node app/scripts/deploy.ts --cluster devnet [--dry-run]
 *   npx ts-node app/scripts/deploy.ts --cluster mainnet [--dry-run]
 *
 * Prerequisites:
 *   1. Anchor program already deployed on-chain (solana program deploy …)
 *   2. .env populated (see .env.example)
 *   3. Treasury keypair available at TREASURY_KEYPAIR_PATH
 *
 * What this script does:
 *   1. Creates the PAYE SPL mint with 18 decimal places
 *   2. Calls init_oft on the PAYE OFT program:
 *      - Sets OFT type = Native (burn/mint)
 *      - Sets shared_decimals = 6
 *      - Sets admin = treasury wallet
 *      - Registers the OApp with the LayerZero Endpoint (delegate = deployer)
 *   3. Saves deployment artifacts to deployments/solana-{cluster}.json
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { EndpointProgram } from "@layerzerolabs/lz-solana-sdk-v2";
import {
  PAYE_DECIMALS,
  PAYE_SHARED_DECIMALS,
  EID_SOLANA_DEVNET,
  EID_SOLANA_MAINNET,
  LZ_ENDPOINT_MAINNET,
  LZ_ENDPOINT_DEVNET,
  deriveOftStore,
  saveDeployment,
  loadKeypair,
  loadTreasuryKeypair,
  getConnection,
  DeploymentRecord,
} from "./utils";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const clusterArg = args.find((a) => a.startsWith("--cluster="))?.split("=")[1]
  ?? (args[args.indexOf("--cluster") + 1] as string | undefined)
  ?? "devnet";
const cluster = clusterArg as "devnet" | "mainnet";
const isDryRun = args.includes("--dry-run");

if (!["devnet", "mainnet"].includes(cluster)) {
  console.error("--cluster must be devnet or mainnet");
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== PAYE OFT Deploy ===`);
  console.log(`Cluster : ${cluster}`);
  console.log(`Dry run : ${isDryRun}\n`);

  const connection = getConnection(cluster);
  const deployer = loadKeypair();
  const treasury = loadTreasuryKeypair();

  console.log(`Deployer  : ${deployer.publicKey.toBase58()}`);
  console.log(`Treasury  : ${treasury.publicKey.toBase58()}`);

  // Load program ID from IDL / env
  const programIdStr = process.env.OFT_PROGRAM_ID;
  if (!programIdStr) {
    throw new Error("OFT_PROGRAM_ID env var must be set to the deployed program ID");
  }
  const programId = new PublicKey(programIdStr);
  console.log(`Program   : ${programId.toBase58()}`);

  if (isDryRun) {
    console.log("\n[DRY RUN] Simulation complete — no transactions submitted.");
    return;
  }

  // Check deployer balance
  const balance = await connection.getBalance(deployer.publicKey);
  console.log(`\nDeployer balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    throw new Error(
      "Deployer balance too low (<0.05 SOL). Run: solana airdrop 2 -u devnet"
    );
  }

  // Load Anchor program
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(deployer),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idlPath = path.join(
    process.cwd(),
    "target",
    "idl",
    "paye_oft.json"
  );
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}. Run \`anchor build\` first.`);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new anchor.Program(idl, provider);

  // ── Step 1: Create PAYE SPL mint ───────────────────────────────────────────
  console.log("\n[1/2] Creating PAYE SPL mint (18 decimals)…");

  // Mint authority will be the deployer initially; after init_oft the OFT store
  // becomes the effective mint authority via the SPL multisig or directly.
  const mintKeypair = Keypair.generate();
  const tokenMint = await createMint(
    connection,
    deployer,            // fee payer
    deployer.publicKey,  // mint authority (temporary — will be transferred)
    deployer.publicKey,  // freeze authority (will be renounced for --only-oft-store)
    PAYE_DECIMALS,
    mintKeypair,
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
  console.log(`  Mint : ${tokenMint.toBase58()}`);

  // ── Step 2: Derive escrow keypair (random — its address seeds the OFT store) ─
  const escrowKeypair = Keypair.generate();
  const [oftStore, oftStoreBump] = deriveOftStore(programId, escrowKeypair.publicKey);
  console.log(`  OFT Store PDA  : ${oftStore.toBase58()}`);
  console.log(`  Token Escrow   : ${escrowKeypair.publicKey.toBase58()}`);

  // ── Step 3: Call init_oft ──────────────────────────────────────────────────
  console.log("\n[2/2] Calling init_oft…");

  const endpointProgram =
    cluster === "mainnet" ? LZ_ENDPOINT_MAINNET : LZ_ENDPOINT_DEVNET;

  // Derive the lzReceiveTypesAccounts PDA
  const LZ_RECEIVE_TYPES_SEED = Buffer.from("LzReceiveTypes");
  const [lzReceiveTypesAccounts] = PublicKey.findProgramAddressSync(
    [LZ_RECEIVE_TYPES_SEED, oftStore.toBuffer()],
    programId
  );

  // Build the remaining_accounts required for the register_oapp CPI inside init_oft.
  // The endpoint program expects: [endpointProgram, payer, oapp(oftStore),
  // oappRegistry, systemProgram, eventAuthority, program]
  const endpoint = new EndpointProgram.Endpoint(endpointProgram);
  const registerOappAccounts = endpoint
    .getRegisterOappIxAccountMetaForCPI(deployer.publicKey, oftStore)
    .map((acc) => ({
      pubkey: new PublicKey(acc.pubkey.toString()),
      isSigner: false,
      isWritable: acc.isWritable,
    }));

  const tx = await program.methods
    .initOft({
      oftType: { native: {} },
      admin: treasury.publicKey,
      sharedDecimals: PAYE_SHARED_DECIMALS,
      endpointProgram: endpointProgram,
    })
    .accounts({
      payer: deployer.publicKey,
      oftStore,
      lzReceiveTypesAccounts,
      tokenMint,
      tokenEscrow: escrowKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .remainingAccounts(registerOappAccounts)
    .signers([deployer, escrowKeypair])
    .rpc({ commitment: "confirmed" });

  console.log(`  init_oft tx : ${tx}`);

  // ── Save deployment record ─────────────────────────────────────────────────
  const record: DeploymentRecord = {
    cluster,
    programId: programId.toBase58(),
    tokenMint: tokenMint.toBase58(),
    tokenEscrow: escrowKeypair.publicKey.toBase58(),
    oftStore: oftStore.toBase58(),
    admin: treasury.publicKey.toBase58(),
    developer: deployer.publicKey.toBase58(),
    deployedAt: new Date().toISOString(),
  };
  saveDeployment(cluster, record);

  console.log("\n✓ Deployment complete.");
  console.log(
    "\nNext steps:"
  );
  console.log(
    "  1. Transfer / renounce freeze authority on the mint if required."
  );
  console.log(
    "  2. Run `make wire-devnet` (or wire-mainnet) to register all peers."
  );
  console.log(
    "  3. Run `make test` to verify the deployment."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
