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
 *   - Registers Base Sepolia    (EID 40245) → EVM_BASE_SEPOLIA_PAYE_ADDRESS
 *
 * What this script does for mainnet:
 *   - Registers Ethereum mainnet (EID 30101) → EVM_MAINNET_PAYE_ADDRESS
 *   - Registers Linea mainnet    (EID 30183) → EVM_LINEA_MAINNET_PAYE_ADDRESS
 *   - Registers Base mainnet     (EID 30184) → EVM_BASE_MAINNET_PAYE_ADDRESS
 *
 * The caller must be either the `admin` (treasury) or the enabled `developer`.
 * This script loads the deployer keypair by default (acts as developer).
 *
 * NOTE: The EVM side must separately call setPeer() pointing at this
 *       OFT Store PDA.  See SOLANA_README.md §Cross-chain wiring checklist.
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  EndpointProgram,
  EndpointPDADeriver,
  EventPDADeriver,
  UlnProgram,
  SetConfigType,
  DVNDeriver,
} from "@layerzerolabs/lz-solana-sdk-v2";
import {
  EID_ETHEREUM_SEPOLIA,
  EID_ETHEREUM_MAINNET,
  EID_LINEA_SEPOLIA,
  EID_LINEA_MAINNET,
  EID_BASE_SEPOLIA,
  EID_BASE_MAINNET,
  derivePeer,
  evmAddressToBytes32,
  loadKeypair,
  loadTreasuryKeypair,
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
  {
    remoteEid: EID_BASE_SEPOLIA,
    label: "Base Sepolia",
    envVar: "EVM_BASE_SEPOLIA_PAYE_ADDRESS",
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
  {
    remoteEid: EID_BASE_MAINNET,
    label: "Base mainnet",
    envVar: "EVM_BASE_MAINNET_PAYE_ADDRESS",
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
        config: { peerAddress: [Array.from(peerBytes32)] },
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
  console.log(`  (as bytes32 : 0x${Buffer.from(new PublicKey(deployment.oftStore).toBytes()).toString("hex")}`);

  // ── [2/4] Transfer LZ endpoint delegate from treasury → developer ─────────
  // The OApp registry stores `delegate = treasury` from init_oft.
  // initReceiveLibrary / setOappConfig require the signer == registered delegate.
  // Call set_oft_config { Delegate: developer } so the developer can run steps 3 & 4.
  console.log("\n[2/4] Transferring LZ endpoint delegate to developer…");
  const LZ_ENDPOINT_PROGRAM = new PublicKey("76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6");
  const treasury = loadTreasuryKeypair();
  const endpointDeriver = new EndpointPDADeriver(LZ_ENDPOINT_PROGRAM);
  const [oappRegistry] = endpointDeriver.oappRegistry(oftStore);
  const [eventAuthority] = new EventPDADeriver(LZ_ENDPOINT_PROGRAM).eventAuthority();

  const delegateTx = await program.methods
    .setOftConfig({ delegate: [caller.publicKey] })
    .accounts({
      admin: treasury.publicKey,
      oftStore,
    } as any)
    .remainingAccounts([
      { pubkey: LZ_ENDPOINT_PROGRAM, isSigner: false, isWritable: false },  // [0] CPI program
      { pubkey: oftStore,            isSigner: false, isWritable: false },  // [1] oapp (PDA signer)
      { pubkey: oappRegistry,        isSigner: false, isWritable: true  },  // [2] oapp_registry
      { pubkey: eventAuthority,      isSigner: false, isWritable: false },  // [3] event_authority
      { pubkey: LZ_ENDPOINT_PROGRAM, isSigner: false, isWritable: false },  // [4] program (#[event_cpi])
    ])
    .signers([treasury])
    .rpc({ commitment: "confirmed" });
  console.log(`  ✓ Delegate set to developer — tx: ${delegateTx}`);

  // ── Set Solana library + DVN config for each remote EID ──────────────────
  // Per EID the required call sequence is:
  //   tx1: initSendLibrary + initReceiveLibrary  — create library config PDAs
  //   tx2: initOAppConfig                        — create send_config + receive_config PDAs in ULN
  //   tx3: setOappConfig x3                      — set executor, send DVNs, receive DVNs
  console.log("\n[3/4] Initialising Solana library + ULN config…");

  const ULN_PROGRAM         = new PublicKey("7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pmG9tdXVH");
  const LZ_DVN_PROGRAM      = new PublicKey("HtEYV4xB4wvsj5fgTkcfuChYpvGYzgzwvNhgDZQNh7wW");
  const LZ_EXECUTOR_PROGRAM = new PublicKey("6doghB248px58JSSwG4qejQ46kFMW4AMj7vzJnWZHNZn");

  const endpointSdk = new EndpointProgram.Endpoint(LZ_ENDPOINT_PROGRAM);
  const ulnSdk      = new UlnProgram.Uln(ULN_PROGRAM);

  // DVN config PDA — the worker address registered on-chain by the LZ DVN program
  const [dvnConfigPda] = new DVNDeriver(LZ_DVN_PROGRAM).config();

  const remoteEids = cluster === "mainnet"
    ? [EID_ETHEREUM_MAINNET, EID_LINEA_MAINNET, EID_BASE_MAINNET]
    : [EID_ETHEREUM_SEPOLIA, EID_LINEA_SEPOLIA, EID_BASE_SEPOLIA];

  const ulnConfig = {
    confirmations: 15,
    requiredDvnCount: 1,
    optionalDvnCount: 0,
    optionalDvnThreshold: 0,
    requiredDvns: [dvnConfigPda],
    optionalDvns: [] as any[],
  };

  for (const remoteEid of remoteEids) {
    console.log(`  Configuring EID ${remoteEid}…`);
    try {
      // tx1: init send + receive library config PDAs
      const initSendIx = endpointSdk.initSendLibrary(caller.publicKey, oftStore, remoteEid);
      const initRxIx   = endpointSdk.initReceiveLibrary(caller.publicKey, oftStore, remoteEid);
      await sendAndConfirmTransaction(
        connection, new Transaction().add(initSendIx).add(initRxIx), [caller], { commitment: "confirmed" }
      );

      // tx2: init OApp ULN config PDAs (creates send_config + receive_config in ULN)
      const initConfigIx = endpointSdk.initOAppConfig(caller.publicKey, ulnSdk, caller.publicKey, oftStore, remoteEid);
      await sendAndConfirmTransaction(
        connection, new Transaction().add(initConfigIx), [caller], { commitment: "confirmed" }
      );

      // tx3: set executor, send ULN, receive ULN configs
      const executorIx = await endpointSdk.setOappConfig(
        connection, caller.publicKey, oftStore, ULN_PROGRAM, remoteEid,
        { configType: SetConfigType.EXECUTOR, value: { maxMessageSize: 10000, executor: LZ_EXECUTOR_PROGRAM } }
      );
      const sendUlnIx = await endpointSdk.setOappConfig(
        connection, caller.publicKey, oftStore, ULN_PROGRAM, remoteEid,
        { configType: SetConfigType.SEND_ULN, value: ulnConfig }
      );
      const rxUlnIx = await endpointSdk.setOappConfig(
        connection, caller.publicKey, oftStore, ULN_PROGRAM, remoteEid,
        { configType: SetConfigType.RECEIVE_ULN, value: ulnConfig }
      );
      const sig = await sendAndConfirmTransaction(
        connection, new Transaction().add(executorIx).add(sendUlnIx).add(rxUlnIx), [caller], { commitment: "confirmed" }
      );
      console.log(`  ✓ EID ${remoteEid} fully configured — tx: ${sig}`);
    } catch (e: any) {
      if (e?.message?.includes("already in use") || e?.message?.includes("AlreadyInUse")) {
        console.log(`  ℹ EID ${remoteEid} already initialised — skipping.`);
      } else {
        throw e;
      }
    }
  }

  console.log("\n✓ Solana LZ config complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
