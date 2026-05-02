/**
 * ConfigureLz.ts — Configure ONE chain pair on the Solana OFT Store.
 *
 * Copyright (c) 2026 Krypto Capital LLC (Koinon). All rights reserved.
 *
 * Mirrors the EVM-side ConfigureLz.s.sol pattern: run once per direction,
 * targeting a single remote EID.  For each pair, run from both sides.
 *
 * Usage:
 *   npx ts-node app/scripts/ConfigureLz.ts --cluster devnet --remote-eid <EID> [--dry-run]
 *   npx ts-node app/scripts/ConfigureLz.ts --cluster mainnet --remote-eid <EID> [--dry-run]
 *
 * Required env vars:
 *   REMOTE_EID             — LayerZero EID of the peer chain
 *   REMOTE_PAYE_ADDRESS    — PAYEToken address on the peer EVM chain (0x…)
 *                            (mutually exclusive with REMOTE_PEER_BYTES32)
 *   REMOTE_PEER_BYTES32    — raw bytes32 peer for non-EVM chains
 *                            (takes precedence over REMOTE_PAYE_ADDRESS if set)
 *
 * LayerZero EIDs:
 *   Testnet:  Eth Sepolia 40161 | Base Sepolia 40245 | Linea Sepolia 40287 | Solana Devnet 40168
 *   Mainnet:  Linea 30183 | Base 30184 | Eth 30101 | Solana 30168
 *
 * Example — wire Eth Sepolia (EVM) ↔ Solana Devnet:
 *   # From Eth Sepolia: run ConfigureLz.s.sol with REMOTE_EID=40168 REMOTE_PEER_BYTES32=<solana-oft-store-as-bytes32>
 *   # From Solana:
 *   REMOTE_EID=40161 REMOTE_PAYE_ADDRESS=<eth-sep-paye-addr> \
 *     npx ts-node app/scripts/ConfigureLz.ts --cluster devnet --remote-eid 40161
 *
 * The caller must be the enabled developer (or admin). Fresh deployments already
 * have delegate=deployer set during init_oft, so no treasury handoff is needed.
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  EndpointProgram,
  EndpointPDADeriver,
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
  loadKeypair,
  loadTreasuryKeypair,
  loadDeployment,
  getConnection,
} from "./utils";

dotenv.config();

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const _clusterIdx = args.indexOf("--cluster");
const clusterArg =
  args.find((a) => a.startsWith("--cluster="))?.split("=")[1] ??
  (_clusterIdx !== -1 ? args[_clusterIdx + 1] : undefined) ??
  "devnet";
const cluster = clusterArg as "devnet" | "mainnet";
const isDryRun = args.includes("--dry-run");

// --remote-eid can be passed as CLI flag OR as REMOTE_EID env var (mirrors EVM script).
const _remoteEidIdx = args.indexOf("--remote-eid");
const remoteEidArg =
  args.find((a) => a.startsWith("--remote-eid="))?.split("=")[1] ??
  (_remoteEidIdx !== -1 ? args[_remoteEidIdx + 1] : undefined) ??
  process.env.REMOTE_EID;
const targetRemoteEid = remoteEidArg ? parseInt(remoteEidArg, 10) : undefined;

// ─── Peer configuration ───────────────────────────────────────────────────────

interface PeerEntry {
  remoteEid: number;
  label: string;
}

interface UlnConfirmations {
  send: number;
  receive: number;
}

// ─── Known peers ──────────────────────────────────────────────────────────────
// Used for label lookup only.  Peer address comes from REMOTE_PAYE_ADDRESS or
// REMOTE_PEER_BYTES32 (mirrors ConfigureLz.s.sol — one chain pair at a time).

const DEVNET_PEERS: PeerEntry[] = [
  { remoteEid: EID_ETHEREUM_SEPOLIA, label: "Ethereum Sepolia" },
  { remoteEid: EID_LINEA_SEPOLIA,    label: "Linea Sepolia"    },
  { remoteEid: EID_BASE_SEPOLIA,     label: "Base Sepolia"     },
];

const MAINNET_PEERS: PeerEntry[] = [
  { remoteEid: EID_ETHEREUM_MAINNET, label: "Ethereum mainnet" },
  { remoteEid: EID_LINEA_MAINNET,    label: "Linea mainnet"    },
  { remoteEid: EID_BASE_MAINNET,     label: "Base mainnet"     },
];

// ─── Solana program addresses ────────────────────────────────────────────────
// Source: https://docs.layerzero.network/v2/deployments/deployed-contracts
//         https://docs.layerzero.network/v2/deployments/chains/solana          (mainnet)
//         https://docs.layerzero.network/v2/deployments/chains/solana-testnet  (devnet)
//
// Protocol contracts — identical across devnet and mainnet:
const LZ_ENDPOINT_PROGRAM  = "76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6";
const ULN_PROGRAM          = "7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pmG9tdXVH";
const LZ_EXECUTOR_PROGRAM  = "6doghB248px58JSSwG4qejQ46kFMW4AMj7vzJnWZHNZn";
const BLOCKED_LIB_PROGRAM  = "2XrYqmhBMPJgDsb4SVbjV1PnJBprurd5bzRCkHwiFCJB";
const LZ_EXECUTOR_PDA      = "AwrbHeCyniXaQhiJZkLhgWdUCteeWSGaSN1sTfLiY7xK";

// Devnet DVNs (3):
const LZ_LABS_DVN_DEVNET   = "4VDjp6XQaxoZf5RGwiPU9NR1EXSZn2TP4ATMmiSzLfhb";
const BRALE_DVN_DEVNET     = "ELBjsx9r8Egz6Kgvdvg8P2rTj16jHGxppoZRwh1gEwRJ";
const P2P_DVN_DEVNET       = "29EKzmCscUg8mf4f5uskwMqvu2SXM8hKF1gWi1cCBoKT";

// Mainnet DVNs (16) — LZ Labs and P2P share the same ID as devnet:
const LZ_LABS_DVN_MAINNET     = "4VDjp6XQaxoZf5RGwiPU9NR1EXSZn2TP4ATMmiSzLfhb";
const BRALE_DVN_MAINNET        = "4EsNicsBtbNE2ZQqB24DVjjqgKh1sWjSKNcdxEgD5d8b";
const P2P_DVN_MAINNET          = "29EKzmCscUg8mf4f5uskwMqvu2SXM8hKF1gWi1cCBoKT";
const BHARVEST_DVN_MAINNET     = "F8tr3GMivioYFEvJAR2WW5CKjPtgMQtM5CEuSjjVkjWL";
const CANARY_DVN_MAINNET       = "7jMeX5mzXnSSKYd8DxBDP4xMnkNFZZZm5W28FWUTbwU3";
const DEUTSCHE_TELEKOM_MAINNET = "FxFxe8j7e2xgpP9bw8LUehmz7DoQXaNFadJMEUKwBcRs";
const FIDELITY_DVN_MAINNET     = "AQGjhJcqEVZP5WHd3NhidpbL743eiTti2Mxgc6XZeKPV";
const FRAX_DVN_MAINNET         = "6YB63FDuyYLt5gnJeiVmYRE4c6tFid5SrBZzMLQFfexm";
const GOOGLE_DVN_MAINNET       = "F7gu9kLcpn4bSTZn183mhn2RXUuMy7zckdxJZdUjuALw";
const HORIZEN_DVN_MAINNET      = "HR9NQKK1ynW9NzgdM37dU5CBtqRHTukmbMKS7qkwSkHX";
const LUGANODES_DVN_MAINNET    = "41QAdzUraTcvk1P2B6fcs5nQ4EeEKEGnQy5EPpCQ5AdX";
const NANSEN_DVN_MAINNET       = "Fn8yyjaLbqw9FZyyLaTkb8o8RWp3vztxNChtPxcV1cLV";
const NETHERMIND_DVN_MAINNET   = "GPjyWr8vCotGuFubDpTxDxy9Vj1ZeEN4F2dwRmFiaGab";
const POPS_DVN_MAINNET         = "CratyHhkQXbRAgck3sooXFYbBADsCtjoxhjVbPKAAhK2";
const USDT0_DVN_MAINNET        = "JBt34GkVns6VSoP2dCPpViW28eqE4GNgKaoZPRP63wZs";
const WORLDPAY_DVN_MAINNET     = "SzcKuPbuMGwMqd9pWTRQDEyL3qZT8YJU4Q5DY9M2aee";

// ─── Solana per-EID config ───────────────────────────────────────────────────
// Mirrors ConfigureLz.s.sol ChainConfig: explicit DVN program IDs and
// confirmation counts per remote EID.
//
// Each DVN on Solana has its own on-chain program.  Its config PDA is derived
// via DVNDeriver(programId).config().  To add a second DVN, append its
// Solana program ID to requiredDvnPrograms (or optionalDvnPrograms).

interface SolanaEidConfig {
  confirmations:          UlnConfirmations;
  requiredDvnPrograms:    string[];  // Solana program IDs — order matters if > 1
  optionalDvnPrograms:    string[];  // Solana program IDs for optional DVNs
  optionalDvnThreshold:   number;
}

// Confirmations must satisfy: EVM-side outbound confirmations >= Solana inbound confirmations.
// These values mirror ConfigureLz.s.sol `cfg.confirmations` per chain.
const DEVNET_EID_CONFIG: Record<number, SolanaEidConfig> = {
  [EID_ETHEREUM_SEPOLIA]: {
    confirmations:        { send: 1, receive: 1 },
    requiredDvnPrograms:  [LZ_LABS_DVN_DEVNET, P2P_DVN_DEVNET],
    optionalDvnPrograms:  [],
    optionalDvnThreshold: 0,
  },
  [EID_LINEA_SEPOLIA]: {
    confirmations:        { send: 1, receive: 1 },
    requiredDvnPrograms:  [LZ_LABS_DVN_DEVNET, P2P_DVN_DEVNET],
    optionalDvnPrograms:  [],
    optionalDvnThreshold: 0,
  },
  [EID_BASE_SEPOLIA]: {
    confirmations:        { send: 1, receive: 1 },
    requiredDvnPrograms:  [LZ_LABS_DVN_DEVNET, P2P_DVN_DEVNET],
    optionalDvnPrograms:  [],
    optionalDvnThreshold: 0,
  },
};

const MAINNET_EID_CONFIG: Record<number, SolanaEidConfig> = {
  [EID_ETHEREUM_MAINNET]: {
    confirmations:        { send: 15, receive: 15 },
    requiredDvnPrograms:  [LZ_LABS_DVN_MAINNET],
    optionalDvnPrograms:  [],
    optionalDvnThreshold: 0,
  },
  [EID_LINEA_MAINNET]: {
    confirmations:        { send: 15, receive: 15 },
    requiredDvnPrograms:  [LZ_LABS_DVN_MAINNET],
    optionalDvnPrograms:  [],
    optionalDvnThreshold: 0,
  },
  [EID_BASE_MAINNET]: {
    confirmations:        { send: 15, receive: 15 },
    requiredDvnPrograms:  [LZ_LABS_DVN_MAINNET],
    optionalDvnPrograms:  [],
    optionalDvnThreshold: 0,
  },
};

// ─── Peer address resolution ──────────────────────────────────────────────────
// Mirrors ConfigureLz.s.sol: prefer REMOTE_PEER_BYTES32 for non-EVM chains,
// fall back to REMOTE_PAYE_ADDRESS (EVM address padded to bytes32).
function resolvePeerBytes32(entry: PeerEntry): Uint8Array {
  const raw = process.env.REMOTE_PEER_BYTES32;
  if (raw && raw.trim().length > 0) {
    const hex = raw.replace(/^0x/, "");
    if (hex.length !== 64) throw new Error(`REMOTE_PEER_BYTES32 must be 32 bytes (64 hex chars), got ${hex.length}`);
    return Uint8Array.from(Buffer.from(hex, "hex"));
  }
  const addr = process.env.REMOTE_PAYE_ADDRESS;
  if (!addr) throw new Error(`Set REMOTE_PAYE_ADDRESS (or REMOTE_PEER_BYTES32) for ${entry.label}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error(`${entry.label} peer address invalid: ${addr}`);
  const bytes = new Uint8Array(32);
  bytes.set(Buffer.from(addr.replace(/^0x/, ""), "hex"), 12);
  return bytes;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const allPeers = cluster === "mainnet" ? MAINNET_PEERS : DEVNET_PEERS;

  // --remote-eid is required (mirrors ConfigureLz.s.sol: one chain pair per run).
  if (targetRemoteEid === undefined) {
    throw new Error("--remote-eid <EID> is required. Pass it as a CLI flag or set REMOTE_EID env var.");
  }
  const found = allPeers.find((p) => p.remoteEid === targetRemoteEid);
  if (!found) throw new Error(`--remote-eid ${targetRemoteEid} not in known peer list for ${cluster}.`);
  const peers = [found];

  console.log(`\n=== PAYE OFT Wire — Solana side ===`);
  console.log(`Cluster    : ${cluster}`);
  console.log(`Remote EID : ${targetRemoteEid}`);
  console.log(`Dry run    : ${isDryRun}\n`);

  const deployment = loadDeployment(cluster);
  const programId = new PublicKey(deployment.programId);
  const oftStore = new PublicKey(deployment.oftStore);

  console.log(`OFT Store : ${oftStore.toBase58()}`);
  console.log(`Program   : ${programId.toBase58()}\n`);

  if (isDryRun) {
    for (const peer of peers) {
      const peerBytes32 = resolvePeerBytes32(peer);
      const [peerPda] = derivePeer(programId, oftStore, peer.remoteEid);
      const eidCfg = (cluster === "mainnet" ? MAINNET_EID_CONFIG : DEVNET_EID_CONFIG)[peer.remoteEid];
      const confs = eidCfg?.confirmations ?? { send: 15, receive: 15 };
      console.log(`[DRY RUN] Would wire: ${peer.label} (EID ${peer.remoteEid})`);
      console.log(`          Peer bytes32 : 0x${Buffer.from(peerBytes32).toString("hex")}`);
      console.log(`          Peer PDA     : ${peerPda.toBase58()}`);
      console.log(`          Send confs   : ${confs.send}  Receive confs: ${confs.receive}`);
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

  // Read current OFT store authority state so we can ensure the developer
  // (caller) is allowed to manage peer + OApp config.
  const oftStoreState = (await (program.account as any).oftStore.fetch(oftStore)) as {
    admin: PublicKey;
    developer: PublicKey;
    developerEnabled: boolean;
  };

  let treasury: anchor.web3.Keypair | null = null;
  const getTreasury = () => {
    if (!treasury) treasury = loadTreasuryKeypair();
    return treasury;
  };

  // ── [1/4] Ensure caller is the enabled OFT developer ─────────────────────
  const isCallerAdmin = oftStoreState.admin.equals(caller.publicKey);
  const isCallerDeveloper = oftStoreState.developer.equals(caller.publicKey);
  const isDeveloperEnabled = !!oftStoreState.developerEnabled;

  console.log("\n[1/4] Ensuring caller is the enabled OFT developer…");
  if (!isCallerDeveloper) {
    const adminSigner = isCallerAdmin ? caller : getTreasury();
    const setDeveloperTx = await program.methods
      .setOftConfig({ developer: [caller.publicKey] })
      .accounts({
        admin: adminSigner.publicKey,
        oftStore,
      } as any)
      .signers(isCallerAdmin ? [] : [adminSigner])
      .rpc({ commitment: "confirmed" });
    console.log(`  ✓ Developer set to caller — tx: ${setDeveloperTx}`);
  } else {
    console.log("  ℹ Developer already set to caller.");
  }

  if (!isDeveloperEnabled) {
    const adminSigner = isCallerAdmin ? caller : getTreasury();
    const enableDeveloperTx = await program.methods
      .setOftConfig({ developerEnabled: [true] })
      .accounts({
        admin: adminSigner.publicKey,
        oftStore,
      } as any)
      .signers(isCallerAdmin ? [] : [adminSigner])
      .rpc({ commitment: "confirmed" });
    console.log(`  ✓ Developer role enabled — tx: ${enableDeveloperTx}`);
  } else {
    console.log("  ℹ Developer role already enabled.");
  }

  // ── [2/4] Verify LZ endpoint delegate ────────────────────────────────────
  // The admin must have run `make set-delegate-devnet` beforehand to point
  // oapp_registry.delegate → caller.  We read it here and fail fast with a
  // clear message rather than attempting an admin-only CPI.
  console.log("\n[2/4] Verifying LZ endpoint delegate…");
  const endpointPubkey = new PublicKey(LZ_ENDPOINT_PROGRAM);
  {
    const endpointDeriver  = new EndpointPDADeriver(endpointPubkey);
    const [oappRegistry]   = endpointDeriver.oappRegistry(oftStore);
    const registryAccount  = await connection.getAccountInfo(oappRegistry);
    if (!registryAccount) {
      throw new Error(
        `oapp_registry PDA not found (${oappRegistry.toBase58()}). ` +
        `Has init_oft been run?`
      );
    }
    // delegate is the first public key in the account data after the 8-byte discriminator.
    const delegate = new PublicKey(registryAccount.data.slice(8, 40));
    console.log(`  oapp_registry.delegate : ${delegate.toBase58()}`);
    if (!delegate.equals(caller.publicKey)) {
      throw new Error(
        `Endpoint delegate is ${delegate.toBase58()} but caller is ${caller.publicKey.toBase58()}.\n` +
        `Ask the admin to run:\n` +
        `  DELEGATE_ADDRESS=${caller.publicKey.toBase58()} make set-delegate-${cluster}`
      );
    }
    console.log(`  ✓ Delegate matches caller.`);
  }

  // ── [3/4] Wire peer ───────────────────────────────────────────────────────
  for (const peer of peers) {
    const peerBytes32 = resolvePeerBytes32(peer);
    const [peerPda] = derivePeer(programId, oftStore, peer.remoteEid);

    console.log(`\n[3/4] Wiring peer: ${peer.label} (EID ${peer.remoteEid})…`);
    console.log(`  Peer bytes32 : 0x${Buffer.from(peerBytes32).toString("hex")}`);
    console.log(`  Peer PDA     : ${peerPda.toBase58()}`);

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

    console.log(`  ✓ tx : ${tx}`);
  }

  console.log(`\n✓ Peer(s) wired.`);
  console.log(`\nRemember: also run ConfigureLz.s.sol on each EVM chain with:`);
  console.log(`  REMOTE_EID=40168 (devnet) or 30168 (mainnet)`);
  console.log(`  REMOTE_PEER_BYTES32=0x${Buffer.from(new PublicKey(deployment.oftStore).toBytes()).toString("hex")}`);

  // ── [4/4] Set Solana library + DVN config for each remote EID ────────────
  // Per EID the required call sequence is:
  //   tx1: initSendLibrary + initReceiveLibrary  — create library config PDAs
  //   tx2: initOAppConfig                        — create send_config + receive_config PDAs in ULN
  //   tx3: setOappConfig x3                      — set executor, send DVNs, receive DVNs
  console.log("\n[4/4] Initialising Solana library + ULN config…");

  const endpointSdk = new EndpointProgram.Endpoint(endpointPubkey);
  const ulnSdk      = new UlnProgram.Uln(new PublicKey(ULN_PROGRAM));

  // Use the peer list already filtered by --remote-eid (or all if not given).
  const remoteEids = peers.map((p) => p.remoteEid);

  const eidConfigMap = cluster === "mainnet" ? MAINNET_EID_CONFIG : DEVNET_EID_CONFIG;

  for (const remoteEid of remoteEids) {
    console.log(`  Configuring EID ${remoteEid}…`);
    try {
      const eidConfig = eidConfigMap[remoteEid];
      if (!eidConfig) throw new Error(`No Solana EID config found for EID ${remoteEid}. Add it to DEVNET_EID_CONFIG or MAINNET_EID_CONFIG.`);

      // Derive DVN config PDAs from each DVN's Solana program ID.
      const requiredDvnPdas = eidConfig.requiredDvnPrograms.map(
        (progId) => new DVNDeriver(new PublicKey(progId)).config()[0]
      );
      const optionalDvnPdas = eidConfig.optionalDvnPrograms.map(
        (progId) => new DVNDeriver(new PublicKey(progId)).config()[0]
      );

      console.log(`    Required DVNs  : ${requiredDvnPdas.map((p) => p.toBase58()).join(", ")}`);
      if (optionalDvnPdas.length > 0)
        console.log(`    Optional DVNs  : ${optionalDvnPdas.map((p) => p.toBase58()).join(", ")} (threshold ${eidConfig.optionalDvnThreshold})`);

      const sendUlnConfig = {
        confirmations:        eidConfig.confirmations.send,
        requiredDvnCount:     requiredDvnPdas.length,
        optionalDvnCount:     optionalDvnPdas.length,
        optionalDvnThreshold: eidConfig.optionalDvnThreshold,
        requiredDvns:         requiredDvnPdas,
        optionalDvns:         optionalDvnPdas,
      };

      const receiveUlnConfig = {
        confirmations:        eidConfig.confirmations.receive,
        requiredDvnCount:     requiredDvnPdas.length,
        optionalDvnCount:     optionalDvnPdas.length,
        optionalDvnThreshold: eidConfig.optionalDvnThreshold,
        requiredDvns:         requiredDvnPdas,
        optionalDvns:         optionalDvnPdas,
      };

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
      const ulnPubkey      = new PublicKey(ULN_PROGRAM);
      const executorPubkey  = new PublicKey(LZ_EXECUTOR_PROGRAM);
      const executorIx = await endpointSdk.setOappConfig(
        connection, caller.publicKey, oftStore, ulnPubkey, remoteEid,
        { configType: SetConfigType.EXECUTOR, value: { maxMessageSize: 10000, executor: executorPubkey } }
      );
      const sendUlnIx = await endpointSdk.setOappConfig(
        connection, caller.publicKey, oftStore, ulnPubkey, remoteEid,
        { configType: SetConfigType.SEND_ULN, value: sendUlnConfig }
      );
      const rxUlnIx = await endpointSdk.setOappConfig(
        connection, caller.publicKey, oftStore, ulnPubkey, remoteEid,
        { configType: SetConfigType.RECEIVE_ULN, value: receiveUlnConfig }
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
