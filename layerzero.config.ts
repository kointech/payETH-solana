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

// ─── Pathway configuration ────────────────────────────────────────────────────

export default {
  contracts: [
    { contract: solanaContract },
    { contract: ethereumContract },
    { contract: lineaContract },
  ],
  connections: [
    {
      from: solanaContract,
      to: ethereumContract,
    },
    {
      from: ethereumContract,
      to: solanaContract,
    },
    {
      from: solanaContract,
      to: lineaContract,
    },
    {
      from: lineaContract,
      to: solanaContract,
    },
  ],
};
