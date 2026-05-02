# ─────────────────────────────────────────────────────────────────────────────
# PAYE OFT Solana — Makefile
# Issued by a United States Entity (US Virgin Islands)
# Beneficially owned 100% by Matthew Mecke and/or assigns.
# Held through Krypto Capital LLC (Koinon) — interim USVI holding entity.
# IP © 2025–2026 Matthew Mecke / Krypto Capital LLC. All rights reserved.
# ─────────────────────────────────────────────────────────────────────────────

.PHONY: help build test deploy-devnet deploy-mainnet configure-lz-devnet configure-lz-mainnet \
        dry-run-devnet dry-run-mainnet clean keys oft-store-bytes32-devnet oft-store-bytes32-mainnet \
        set-delegate-devnet set-delegate-mainnet to-bytes32 to-b32

help: ## Show this help
	@awk 'BEGIN{FS=":.*##"} /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-22s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)

# ── Keypair / program ID ─────────────────────────────────────────────────────

keys: ## Generate / sync program keypairs and show IDs
	anchor keys sync -p paye-oft
	@echo ""
	anchor keys list

# ── Build ─────────────────────────────────────────────────────────────────────

build: ## Build the Anchor program (local toolchain — fast, for development)
	anchor build

build-verifiable: ## Verifiable build via Docker (required for mainnet deployment)
	anchor build -v

# ── Tests ─────────────────────────────────────────────────────────────────────

test: ## Run all tests against a local validator
	anchor test

# ── Devnet ────────────────────────────────────────────────────────────────────

dry-run-devnet: ## Simulate devnet deployment (no transactions)
	npx ts-node app/scripts/deploy.ts --cluster devnet --dry-run

deploy-program-devnet: ## Upload/upgrade only the .so binary on devnet
	@echo "=== Upload program binary → devnet ==="
	solana program deploy target/deploy/paye_oft.so \
		--keypair ~/.config/solana/id.json \
		--program-id target/deploy/paye_oft-keypair.json \
		-u devnet

init-devnet: ## Run init_oft on devnet (program must already be on-chain)
	@echo "=== Init OFT → devnet ==="
	npx ts-node app/scripts/deploy.ts --cluster devnet

deploy-devnet: deploy-program-devnet init-devnet ## Deploy program binary AND init OFT on devnet

configure-lz-devnet: ## Configure LayerZero peers on Solana devnet
	@echo "=== Configure LayerZero peers → devnet ==="
	npx ts-node app/scripts/ConfigureLz.ts --cluster devnet

# ── Mainnet ───────────────────────────────────────────────────────────────────

dry-run-mainnet: ## Simulate mainnet deployment (no transactions)
	npx ts-node app/scripts/deploy.ts --cluster mainnet --dry-run

deploy-mainnet: ## Deploy program and create OFT on Solana mainnet
	@echo "⚠  MAINNET DEPLOYMENT — proceed with caution"
	@DEVNET_ID=$$(grep -A2 '\[programs\.devnet\]' Anchor.toml | awk -F'"' '/paye-oft/{print $$2}'); \
	MAINNET_ID=$$(grep -A2 '\[programs\.mainnet\]' Anchor.toml | awk -F'"' '/paye-oft/{print $$2}'); \
	if [ -z "$$MAINNET_ID" ]; then \
	  echo "ERROR: [programs.mainnet] paye-oft is not set in Anchor.toml."; \
	  echo "       Set a distinct mainnet program ID before deploying."; \
	  exit 1; \
	fi; \
	if [ "$$MAINNET_ID" = "$$DEVNET_ID" ]; then \
	  echo "ERROR: mainnet program ID matches devnet ID ($$MAINNET_ID)."; \
	  echo "       Set a distinct mainnet program ID in Anchor.toml before deploying."; \
	  exit 1; \
	fi
	@read -p "Are you sure? (yes/no) " CONFIRM; \
	[ "$$CONFIRM" = "yes" ] || (echo "Aborted."; exit 1)
	npx ts-node app/scripts/deploy.ts --cluster mainnet

configure-lz-mainnet: ## Configure LayerZero peers on Solana mainnet
	@echo "⚠  MAINNET LZ CONFIG — proceed with caution"
	@read -p "Are you sure? (yes/no) " CONFIRM; \
	[ "$$CONFIRM" = "yes" ] || (echo "Aborted."; exit 1)
	npx ts-node app/scripts/ConfigureLz.ts --cluster mainnet

# ── OFT Store bytes32 ─────────────────────────────────────────────────────────
# Accept address as positional arg OR ADDR= variable:
#   make to-b32 AYzvhvYYmBU72saFBveRgRvXL3BpQwQv1E5uDL4bBM3F
#   make to-b32 ADDR=AYzvhvYYmBU72saFBveRgRvXL3BpQwQv1E5uDL4bBM3F
_B32_ADDR := $(or $(ADDR),$(filter-out to-b32 to-bytes32,$(MAKECMDGOALS)))

to-b32 to-bytes32: ## Convert a Solana address to bytes32 hex: make to-b32 <base58>
	@[ -n "$(_B32_ADDR)" ] || (echo "Usage: make to-b32 <base58-address>"; exit 1)
	@npx ts-node app/scripts/toBytes32.ts $(_B32_ADDR)

# Absorb the address token so make doesn't treat it as a separate target
%:
	@:

oft-store-bytes32-devnet: ## Print OFT Store address as bytes32 (use as REMOTE_PEER_BYTES32 on EVM side)
	@node -e " \
	  const { PublicKey } = require('@solana/web3.js'); \
	  const dep = require('./deployments/solana-devnet.json'); \
	  console.log('OFT Store (devnet) bytes32:'); \
	  console.log('0x' + Buffer.from(new PublicKey(dep.oftStore).toBytes()).toString('hex')); \
	"

oft-store-bytes32-mainnet: ## Print OFT Store address as bytes32 (use as REMOTE_PEER_BYTES32 on EVM side)
	@node -e " \
	  const { PublicKey } = require('@solana/web3.js'); \
	  const dep = require('./deployments/solana-mainnet.json'); \
	  console.log('OFT Store (mainnet) bytes32:'); \
	  console.log('0x' + Buffer.from(new PublicKey(dep.oftStore).toBytes()).toString('hex')); \
	"


# ── Admin one-time setup ─────────────────────────────────────────────────────
# Run once after deployment to allow the developer key to operate LZ config
# without ever needing the admin key again.
# Usage: DELEGATE_ADDRESS=<developer-pubkey> make set-delegate-devnet

set-delegate-devnet: ## (Admin only) Set LZ endpoint delegate → DELEGATE_ADDRESS on devnet
	@[ -n "$$DELEGATE_ADDRESS" ] || (echo "Error: DELEGATE_ADDRESS is not set."; exit 1)
	@echo "=== SetDelegate → devnet ==="
	npx ts-node app/scripts/SetDelegate.ts --cluster devnet

set-delegate-mainnet: ## (Admin only) Set LZ endpoint delegate → DELEGATE_ADDRESS on mainnet
	@[ -n "$$DELEGATE_ADDRESS" ] || (echo "Error: DELEGATE_ADDRESS is not set."; exit 1)
	@echo "⚠  MAINNET DELEGATE — proceed with caution"
	@read -p "Are you sure? (yes/no) " CONFIRM; \
	[ "$$CONFIRM" = "yes" ] || (echo "Aborted."; exit 1)
	npx ts-node app/scripts/SetDelegate.ts --cluster mainnet

# ── Maintenance ───────────────────────────────────────────────────────────────

clean: ## Remove build artefacts
	rm -rf target .anchor

install: ## Install Node.js dependencies
	npm install
