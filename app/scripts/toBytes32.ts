/**
 * toBytes32.ts — Convert a Solana base58 address to a bytes32 hex string.
 *
 * Usage:
 *   npx ts-node app/scripts/toBytes32.ts <base58-address>
 *   npx ts-node app/scripts/toBytes32.ts Edh3nk8MTB1Ej5o4kmDDEX5W9x8TUz1x4zB9V5ujWWt4
 */

import { PublicKey } from "@solana/web3.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npx ts-node app/scripts/toBytes32.ts <base58-address>");
  process.exit(1);
}

try {
  const pubkey = new PublicKey(input);
  console.log("0x" + Buffer.from(pubkey.toBytes()).toString("hex"));
} catch {
  console.error(`Invalid Solana address: ${input}`);
  process.exit(1);
}
