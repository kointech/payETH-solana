/**
 * layerzero.config.ts — Cross-chain wiring configuration for the PAYE OFT.
 *
 * Used by `pnpm hardhat lz:oapp:wire --oapp-config layerzero.config.ts`
 * (when running the LayerZero Hardhat tasks from the EVM project or a
 * combined monorepo).
 *
 * The Solana `address` is auto-populated from the deployment artefact.
 */

import { EndpointId } from "@layerzerolabs/lz-definitions";
import * as fs from "fs";
import * as path from "path";

// ─── Load OFT Store address from deployment artefact ──────────────────────────

function getOftStoreAddress(cluster: "devnet" | "mainnet"): string {
  const file = path.join(__dirname, "deployments", `solana-${cluster}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`[layerzero.config] No deployment found at ${file}. Returning placeholder.`);
    return "11111111111111111111111111111111"; // SystemProgram placeholder
  }
  const record = JSON.parse(fs.readFileSync(file, "utf-8"));
  return record.oftStore as string;
}

const isMainnet = process.env.NETWORK === "mainnet";

// ─── Contract definitions ──────────────────────────────────────────────────────

const solanaContract = {
  eid: isMainnet ? EndpointId.SOLANA_V2_MAINNET : EndpointId.SOLANA_V2_TESTNET,
  address: getOftStoreAddress(isMainnet ? "mainnet" : "devnet"),
};

// EVM contracts are resolved by hardhat-deploy (no address needed here)
const ethereumContract = {
  eid: isMainnet ? EndpointId.ETHEREUM_V2_MAINNET : EndpointId.SEPOLIA_V2_TESTNET,
};

const lineaContract = {
  eid: isMainnet ? EndpointId.LINEA_V2_MAINNET : EndpointId.LINEA_SEPOLIA_V2_TESTNET,
};

const baseContract = {
  eid: isMainnet ? EndpointId.BASE_V2_MAINNET : EndpointId.BASESEP_V2_TESTNET,
};

// LayerZero Labs DVN addresses (testnet)
const LZ_DVN_SEPOLIA     = "0x8eebf8b423B73bFCa51a1Db4B7354AA0bFCA9193";
const LZ_DVN_LINEA_SEP   = "0x701f3927871EfcEa1235dB722f9E608aEdAa81F5";
const LZ_DVN_BASE_SEP    = "0xe1a12515F9AB2764b887bF60B923Ca494EBBb2D6";
const LZ_DVN_SOLANA_DEV  = "0x2bBf41BE58E15ea5A0E75faa9E1b11B38f16C48b";

// ─── Pathway configuration ────────────────────────────────────────────────────

export default {
  contracts: [
    { contract: solanaContract },
    { contract: ethereumContract },
    { contract: lineaContract },
    { contract: baseContract },
  ],
  connections: [
    // ── Ethereum Sepolia ↔ Solana devnet ───────────────────────────────────
    {
      from: ethereumContract,
      to: solanaContract,
      config: {
        sendConfig: {
          executorConfig: { maxMessageSize: 10000, executor: "0x718B92b5CB0a5552039B46e88b1B27621F9C74e8" },
          ulnConfig: { confirmations: 2, requiredDVNs: [LZ_DVN_SEPOLIA], optionalDVNs: [] },
        },
        receiveConfig: {
          ulnConfig: { confirmations: 1, requiredDVNs: [LZ_DVN_SOLANA_DEV], optionalDVNs: [] },
        },
      },
    },
    {
      from: solanaContract,
      to: ethereumContract,
      config: {
        sendConfig: {
          ulnConfig: { confirmations: 1, requiredDVNs: [LZ_DVN_SOLANA_DEV], optionalDVNs: [] },
        },
        receiveConfig: {
          ulnConfig: { confirmations: 2, requiredDVNs: [LZ_DVN_SEPOLIA], optionalDVNs: [] },
        },
      },
    },
    // ── Linea Sepolia ↔ Solana devnet ──────────────────────────────────────
    {
      from: lineaContract,
      to: solanaContract,
      config: {
        sendConfig: {
          ulnConfig: { confirmations: 2, requiredDVNs: [LZ_DVN_LINEA_SEP], optionalDVNs: [] },
        },
        receiveConfig: {
          ulnConfig: { confirmations: 1, requiredDVNs: [LZ_DVN_SOLANA_DEV], optionalDVNs: [] },
        },
      },
    },
    {
      from: solanaContract,
      to: lineaContract,
      config: {
        sendConfig: {
          ulnConfig: { confirmations: 1, requiredDVNs: [LZ_DVN_SOLANA_DEV], optionalDVNs: [] },
        },
        receiveConfig: {
          ulnConfig: { confirmations: 2, requiredDVNs: [LZ_DVN_LINEA_SEP], optionalDVNs: [] },
        },
      },
    },
    // ── Base Sepolia ↔ Solana devnet ───────────────────────────────────────
    {
      from: baseContract,
      to: solanaContract,
      config: {
        sendConfig: {
          executorConfig: { maxMessageSize: 10000, executor: "0x8A3D588D9f6AC041476b094f97AF94906B9f55B2" },
          ulnConfig: { confirmations: 2, requiredDVNs: [LZ_DVN_BASE_SEP], optionalDVNs: [] },
        },
        receiveConfig: {
          ulnConfig: { confirmations: 1, requiredDVNs: [LZ_DVN_SOLANA_DEV], optionalDVNs: [] },
        },
      },
    },
    {
      from: solanaContract,
      to: baseContract,
      config: {
        sendConfig: {
          ulnConfig: { confirmations: 1, requiredDVNs: [LZ_DVN_SOLANA_DEV], optionalDVNs: [] },
        },
        receiveConfig: {
          ulnConfig: { confirmations: 2, requiredDVNs: [LZ_DVN_BASE_SEP], optionalDVNs: [] },
        },
      },
    },
  ],
};
