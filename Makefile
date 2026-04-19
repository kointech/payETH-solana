# ─────────────────────────────────────────────────────────────────────────────
# PAYE OFT Solana — Makefile
# Issued by a United States Entity (US Virgin Islands)
# Beneficially owned 100% by Matthew Mecke and/or assigns.
# Held through Krypto Capital LLC (Koinon) — interim USVI holding entity.
# IP © 2025–2026 Matthew Mecke / Krypto Capital LLC. All rights reserved.
# ─────────────────────────────────────────────────────────────────────────────

.PHONY: help build test deploy-devnet deploy-mainnet wire-devnet wire-mainnet \
        dry-run-devnet dry-run-mainnet clean keys

help: ## Show this help
	@awk 'BEGIN{FS=":.*##"} /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-22s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)

# ── Keypair / program ID ─────────────────────────────────────────────────────

keys: ## Generate / sync program keypairs and show IDs
	anchor keys sync -p paye-oft
	@echo ""
	anchor keys list

# ── Build ─────────────────────────────────────────────────────────────────────

build: ## Build the Anchor program (local toolchain — fast, for development)
	@PROGRAM_ID=$$(anchor keys list 2>/dev/null | awk '/paye[_-]oft/{print $$2}'); \
	if [ -z "$$PROGRAM_ID" ]; then \
	  echo "Run 'make keys' first to generate the program keypair."; \
	  exit 1; \
	fi; \
	echo "Building with OFT_ID=$$PROGRAM_ID …"; \
	anchor build -e OFT_ID=$$PROGRAM_ID

build-verifiable: ## Verifiable build via Docker (required for mainnet deployment)
	@PROGRAM_ID=$$(anchor keys list 2>/dev/null | awk '/paye[_-]oft/{print $$2}'); \
	if [ -z "$$PROGRAM_ID" ]; then \
	  echo "Run 'make keys' first to generate the program keypair."; \
	  exit 1; \
	fi; \
	echo "Verifiable build with OFT_ID=$$PROGRAM_ID (requires Docker) …"; \
	anchor build -v -e OFT_ID=$$PROGRAM_ID

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

wire-devnet: ## Wire peers on Solana devnet
	@echo "=== Wire peers → devnet ==="
	npx ts-node app/scripts/wire.ts --cluster devnet

# ── Mainnet ───────────────────────────────────────────────────────────────────

dry-run-mainnet: ## Simulate mainnet deployment (no transactions)
	npx ts-node app/scripts/deploy.ts --cluster mainnet --dry-run

deploy-mainnet: ## Deploy program and create OFT on Solana mainnet
	@echo "⚠  MAINNET DEPLOYMENT — proceed with caution"
	@read -p "Are you sure? (yes/no) " CONFIRM; \
	[ "$$CONFIRM" = "yes" ] || (echo "Aborted."; exit 1)
	npx ts-node app/scripts/deploy.ts --cluster mainnet

wire-mainnet: ## Wire peers on Solana mainnet
	@echo "⚠  MAINNET WIRING — proceed with caution"
	@read -p "Are you sure? (yes/no) " CONFIRM; \
	[ "$$CONFIRM" = "yes" ] || (echo "Aborted."; exit 1)
	npx ts-node app/scripts/wire.ts --cluster mainnet

# ── Maintenance ───────────────────────────────────────────────────────────────

clean: ## Remove build artefacts
	rm -rf target .anchor

install: ## Install Node.js dependencies
	npm install
