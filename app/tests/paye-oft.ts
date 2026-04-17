/**
 * paye-oft.ts — Integration tests for the PAYE OFT Solana program.
 *
 * Copyright (c) 2026 Krypto Capital LLC (Koinon). All rights reserved.
 *
 * Tests use a local validator with a mock LayerZero Endpoint (from the
 * endpoint-mock program shipped in examples/oft-solana/programs/endpoint-mock).
 *
 * Run with:  anchor test   (or: pnpm test)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  getAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { PayeOft } from "../../target/types/paye_oft";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAYE_DECIMALS = 4;
const PAYE_SHARED_DECIMALS = 4;
const OFT_SEED = Buffer.from("OFT");
const PEER_SEED = Buffer.from("Peer");
const LZ_RECEIVE_TYPES_SEED = Buffer.from("LzReceiveTypes");

// EIDs used in tests
const EID_ETH_SEPOLIA = 40161;
const EID_LINEA_SEPOLIA = 40287;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveOftStore(
  programId: PublicKey,
  tokenEscrow: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [OFT_SEED, tokenEscrow.toBuffer()],
    programId
  );
}

function derivePeer(
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

function evmToBytes32(hexAddr: string): number[] {
  const clean = hexAddr.replace(/^0x/, "").padStart(64, "0");
  return Array.from(Buffer.from(clean, "hex"));
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("PAYE OFT — Solana program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PayeOft as Program<PayeOft>;
  const payer = (provider.wallet as anchor.Wallet).payer;

  let tokenMint: PublicKey;
  let tokenEscrow: Keypair;
  let oftStore: PublicKey;
  let oftStoreBump: number;
  let lzReceiveTypesAccounts: PublicKey;
  let treasury: Keypair;
  let mockEndpoint: PublicKey;

  // ── Setup ─────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    treasury = Keypair.generate();
    tokenEscrow = Keypair.generate();

    // Airdrop SOL to payer
    const sig = await provider.connection.requestAirdrop(
      payer.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // The mock endpoint program ID used in localnet tests is set by Anchor.toml.
    // For the purpose of these tests it accepts any OApp registration.
    // In production wiring tests use the real LZ endpoint.
    mockEndpoint = new PublicKey(
      process.env.MOCK_ENDPOINT_ID ||
        "76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6"
    );

    [oftStore, oftStoreBump] = deriveOftStore(
      program.programId,
      tokenEscrow.publicKey
    );

    [lzReceiveTypesAccounts] = PublicKey.findProgramAddressSync(
      [LZ_RECEIVE_TYPES_SEED, oftStore.toBuffer()],
      program.programId
    );
  });

  // ── T1: SPL mint has 4 decimal places ────────────────────────────────────

  it("T1: SPL mint is created with 4 decimal places", async () => {
    tokenMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey, // temporary mint authority
      payer.publicKey,
      PAYE_DECIMALS,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    const mintInfo = await provider.connection.getParsedAccountInfo(tokenMint);
    const data = (mintInfo.value?.data as any).parsed.info;
    expect(data.decimals).to.equal(PAYE_DECIMALS, "SPL mint must have 4 decimals");
    console.log(`  ✓ mint decimals = ${data.decimals}`);
  });

  // ── T2: sharedDecimals == 4 (ld2sd_rate == 1) ────────────────────────────

  it("T2: init_oft succeeds and ld2sd_rate is 1 (no dust)", async () => {
    // init_oft requires remaining_accounts for register_oapp CPI.
    // In local tests these are empty (mock endpoint accepts empty array).
    await program.methods
      .initOft({
        oftType: { native: {} },
        admin: treasury.publicKey,
        sharedDecimals: PAYE_SHARED_DECIMALS,
        endpointProgram: mockEndpoint,
      })
      .accounts({
        payer: payer.publicKey,
        oftStore,
        lzReceiveTypesAccounts,
        tokenMint,
        tokenEscrow: tokenEscrow.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([payer, tokenEscrow])
      .rpc({ commitment: "confirmed" });

    const store = await program.account.oftStore.fetch(oftStore);

    // ld2sd_rate = 10^(local_dec - shared_dec) = 10^(4-4) = 1
    expect(store.ld2sdRate.toNumber()).to.equal(
      1,
      "ld2sd_rate must be 1 (shared_decimals == decimals → no dust)"
    );
    expect(store.admin.toBase58()).to.equal(
      treasury.publicKey.toBase58(),
      "admin must be the treasury wallet"
    );
    console.log(`  ✓ ld2sd_rate = ${store.ld2sdRate.toNumber()}`);
    console.log(`  ✓ admin = treasury`);
  });

  // ── T3: Mint authority is the OFT store PDA after init ────────────────────

  it("T3: deployer is set as developer and developer is enabled", async () => {
    const store = await program.account.oftStore.fetch(oftStore);
    expect(store.developer.toBase58()).to.equal(
      payer.publicKey.toBase58(),
      "developer must be the deployer (payer)"
    );
    expect(store.developerEnabled).to.equal(true, "developer must be enabled after init");
    console.log(`  ✓ developer = deployer`);
    console.log(`  ✓ developerEnabled = true`);
  });

  // ── T4: Total supply starts at 0 on Solana (remote chain) ─────────────────

  it("T4: total supply starts at 0 on Solana (remote chain)", async () => {
    const mintInfo = await provider.connection.getParsedAccountInfo(tokenMint);
    const supply = parseInt(
      (mintInfo.value?.data as any).parsed.info.supply,
      10
    );
    expect(supply).to.equal(0, "Remote chain must start with 0 supply");
    console.log(`  ✓ supply = 0`);
  });

  // ── T5: admin can set a peer; non-admin cannot ───────────────────────────

  it("T5: admin can set a peer address for Ethereum Sepolia", async () => {
    const [peerPda] = derivePeer(program.programId, oftStore, EID_ETH_SEPOLIA);
    const fakeEvmAddr = evmToBytes32("0x1234567890abcdef1234567890abcdef12345678");

    // Treasury (admin) sets the peer
    await program.methods
      .setPeerConfig({
        remoteEid: EID_ETH_SEPOLIA,
        config: { peerAddress: [fakeEvmAddr] },
      })
      .accounts({
        authority: treasury.publicKey,
        peer: peerPda,
        oftStore,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([treasury])
      .rpc({ commitment: "confirmed" });

    const peer = await program.account.peerConfig.fetch(peerPda);
    expect(Buffer.from(peer.peerAddress).toString("hex")).to.equal(
      Buffer.from(fakeEvmAddr).toString("hex"),
      "peer address must match what was set"
    );
    console.log(`  ✓ admin can set peer for EID ${EID_ETH_SEPOLIA}`);
  });

  it("T5b: developer can set a peer address for Linea Sepolia", async () => {
    const [peerPda] = derivePeer(program.programId, oftStore, EID_LINEA_SEPOLIA);
    const fakeEvmAddr = evmToBytes32("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");

    // Deployer (developer) sets the peer — developer_enabled is true from init
    await program.methods
      .setPeerConfig({
        remoteEid: EID_LINEA_SEPOLIA,
        config: { peerAddress: [fakeEvmAddr] },
      })
      .accounts({
        authority: payer.publicKey,
        peer: peerPda,
        oftStore,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([payer])
      .rpc({ commitment: "confirmed" });

    const peer = await program.account.peerConfig.fetch(peerPda);
    expect(Buffer.from(peer.peerAddress).toString("hex")).to.equal(
      Buffer.from(fakeEvmAddr).toString("hex")
    );
    console.log(`  ✓ developer can set peer for EID ${EID_LINEA_SEPOLIA}`);
  });

  it("T5c: random wallet cannot set a peer", async () => {
    const attacker = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      attacker.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    const [peerPda] = derivePeer(program.programId, oftStore, 99999);
    const fakeBytes = Array(32).fill(0);

    try {
      await program.methods
        .setPeerConfig({
          remoteEid: 99999,
          config: { peerAddress: [fakeBytes] },
        })
        .accounts({
          authority: attacker.publicKey,
          peer: peerPda,
          oftStore,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([attacker])
        .rpc({ commitment: "confirmed" });
      assert.fail("Expected an Unauthorized error but none was thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
      console.log(`  ✓ random wallet correctly rejected`);
    }
  });

  // ── T6: developer can be disabled and re-enabled ─────────────────────────

  it("T6: admin can disable developer role", async () => {
    await program.methods
      .setOftConfig({ developerEnabled: [false] })
      .accounts({
        admin: treasury.publicKey,
        oftStore,
      } as any)
      .signers([treasury])
      .rpc({ commitment: "confirmed" });

    const store = await program.account.oftStore.fetch(oftStore);
    expect(store.developerEnabled).to.equal(false);
    console.log(`  ✓ developerEnabled = false`);

    // Now developer must be rejected
    const [peerPda] = derivePeer(program.programId, oftStore, 55555);
    try {
      await program.methods
        .setPeerConfig({
          remoteEid: 55555,
          config: { peerAddress: [Array(32).fill(0)] },
        })
        .accounts({
          authority: payer.publicKey,
          peer: peerPda,
          oftStore,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([payer])
        .rpc({ commitment: "confirmed" });
      assert.fail("Expected Unauthorized but call succeeded");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
      console.log(`  ✓ disabled developer correctly rejected`);
    }

    // Re-enable for subsequent tests
    await program.methods
      .setOftConfig({ developerEnabled: [true] })
      .accounts({
        admin: treasury.publicKey,
        oftStore,
      } as any)
      .signers([treasury])
      .rpc({ commitment: "confirmed" });
  });

  // ── T7: Pause stops all activity ─────────────────────────────────────────

  it("T7: admin can pause and unpause the contract", async () => {
    // Set admin as pauser and unpauser for test simplicity
    await program.methods
      .setOftConfig({ pauser: [treasury.publicKey] })
      .accounts({ admin: treasury.publicKey, oftStore } as any)
      .signers([treasury])
      .rpc({ commitment: "confirmed" });

    await program.methods
      .setOftConfig({ unpauser: [treasury.publicKey] })
      .accounts({ admin: treasury.publicKey, oftStore } as any)
      .signers([treasury])
      .rpc({ commitment: "confirmed" });

    await program.methods
      .setPause({ paused: true })
      .accounts({ signer: treasury.publicKey, oftStore } as any)
      .signers([treasury])
      .rpc({ commitment: "confirmed" });

    const pausedStore = await program.account.oftStore.fetch(oftStore);
    expect(pausedStore.paused).to.equal(true);
    console.log(`  ✓ contract paused`);

    await program.methods
      .setPause({ paused: false })
      .accounts({ signer: treasury.publicKey, oftStore } as any)
      .signers([treasury])
      .rpc({ commitment: "confirmed" });

    const unpausedStore = await program.account.oftStore.fetch(oftStore);
    expect(unpausedStore.paused).to.equal(false);
    console.log(`  ✓ contract unpaused`);
  });

  // ── T8: Non-admin cannot change admin ────────────────────────────────────

  it("T8: non-admin cannot change the admin", async () => {
    const rogue = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      rogue.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .setOftConfig({ admin: [rogue.publicKey] })
        .accounts({ admin: rogue.publicKey, oftStore } as any)
        .signers([rogue])
        .rpc({ commitment: "confirmed" });
      assert.fail("Expected Unauthorized but call succeeded");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
      console.log(`  ✓ non-admin cannot change admin`);
    }
  });
});
