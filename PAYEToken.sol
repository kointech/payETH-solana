// SPDX-License-Identifier: UNLICENSED
//
// PAYE / PayETH — Omnichain Fungible Token (LayerZero OFT v2)
// Issued by a United States Entity (US Virgin Islands)
// ─────────────────────────────────────────────────────────────────────────────
// Beneficially owned 100% by Matthew Mecke and/or assigns.
// Held and issued through Krypto Capital LLC, a US Virgin Islands registered
// company (interim holding entity), pending establishment of a successor USVI
// holding company.  All rights, title, and interest in this code, the PAYE
// token, and all related intellectual property vest solely in Matthew Mecke
// and/or his designated assigns or successor entities.
//
// IP © 2025–2026 Matthew Mecke / Krypto Capital LLC (Koinon). All rights reserved.
//
// This code was developed under instruction from Matthew Mecke commencing
// December 1, 2025.  At that time the beneficial owner advised that the final
// corporate ownership structure was yet to be established; Krypto Capital LLC
// is therefore named as the interim issuing entity.  Any successor USVI entity
// established by Matthew Mecke shall automatically succeed to all rights herein
// by corporate IP assignment without affecting the validity of this notice.
//
// No licence to reproduce, distribute, or create derivative works is granted
// without prior written consent of the beneficial owner.
// ─────────────────────────────────────────────────────────────────────────────
//
// SECURITY NOTICE:
//   - Fixed total supply: 125,000,000 PAYE (minted once at deployment on the home chain)
//   - No privileged mint or burn functions beyond the LayerZero OFT bridge mechanism
//   - Ownership transferred via two-step process to prevent accidental loss
//   - No backdoors; contract logic is fully transparent and auditable
//
// CROSS-CHAIN ARCHITECTURE:
//   Home chain  (Ethereum)  — deploys with initialSupply = 125_000_000 × 10^4
//   Remote chains (Linea, …) — deploys with initialSupply = 0  (supply arrives via bridge)
//   All deployments must be wired together with setPeer() before any bridging

pragma solidity 0.8.22;

import {OFT} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/OFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title  PAYEToken
 * @author Krypto Capital LLC (Koinon)
 * @notice PAYE is the native token of the PayETH project.
 *         It is a LayerZero OFT (Omnichain Fungible Token) with a fixed total supply
 *         of 125,000,000 PAYE distributed across all connected chains.
 *
 * @dev Decimals are set to 4 (not the ERC-20 default of 18).
 *      sharedDecimals() is overridden to 4 so the inter-chain decimal conversion
 *      rate is exactly 1 (no dust loss on any EVM chain).
 *
 *      Deployment pattern:
 *        • Home chain   → pass initialSupply = 125_000_000 * 10**4
 *        • Remote chains → pass initialSupply = 0
 */
contract PAYEToken is OFT, Ownable2Step {
    // ─── Constants ────────────────────────────────────────────────────────────

    uint8 private constant _DECIMALS = 4;
    uint8 private constant _SHARED_DECIMALS = 4;
    string private constant _NAME = "PayETH";
    string private constant _SYMBOL = "PAYE";

    // ─── Immutables ───────────────────────────────────────────────────────────

    /// @notice True on the Ethereum home-chain deployment where the full supply was minted.
    bool public immutable IS_HOME_CHAIN;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Address authorised to call setPeer() on behalf of the owner.
    address public developer;

    /// @notice Whether the developer role is currently active.
    bool public developerEnabled;

    // ─── Events ───────────────────────────────────────────────────────────────

    /// @dev Emitted once at construction when the full supply is minted.
    event SupplyMinted(address indexed treasury, uint256 amount);

    /// @dev Emitted when the developer address is changed.
    event DeveloperChanged(
        address indexed previousDeveloper,
        address indexed newDeveloper
    );

    /// @dev Emitted when the developer role is enabled or disabled.
    event DeveloperToggled(bool enabled);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotOwnerOrDeveloper();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    /// @dev Allows owner OR (enabled developer) to call the function.
    modifier onlyOwnerOrDeveloper() {
        if (
            msg.sender != owner() &&
            !(developerEnabled && msg.sender == developer)
        ) {
            revert NotOwnerOrDeveloper();
        }
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @param lzEndpoint   Address of the LayerZero EndpointV2 on this chain.
     * @param treasury     Address that receives the initial supply (Koinon wallet).
     *                     Also becomes the initial owner / delegate.
     * @param initialSupply Amount of PAYE (in smallest units, i.e. × 10**4) to mint
     *                     at deployment.  Must be 0 on remote chains.
     */
    constructor(
        address lzEndpoint,
        address treasury,
        uint256 initialSupply
    ) OFT(_NAME, _SYMBOL, lzEndpoint, treasury) {
        require(treasury != address(0), "PAYE: zero treasury");

        // OZ v4 Ownable defaults owner to msg.sender (deployer).
        // Transfer ownership to the Koinon treasury wallet immediately so that
        // the treasury holds full control from the moment the contract is live.
        _transferOwnership(treasury);

        // Assign the deployer as the initial developer so they can wire peers.
        developer = msg.sender;
        developerEnabled = true;
        emit DeveloperChanged(address(0), msg.sender);
        emit DeveloperToggled(true);

        IS_HOME_CHAIN = (initialSupply > 0);

        if (initialSupply > 0) {
            _mint(treasury, initialSupply);
            emit SupplyMinted(treasury, initialSupply);
        }
    }

    // ─── ERC-20 overrides ─────────────────────────────────────────────────────

    /**
     * @notice Returns the number of decimal places used by PAYE.
     * @dev    Overrides the ERC-20 default of 18.  Must equal or exceed sharedDecimals().
     */
    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    // ─── OFT overrides ────────────────────────────────────────────────────────

    /**
     * @notice Returns the shared decimal precision used across all chains in the OFT mesh.
     * @dev    Must be ≤ decimals().  Setting this equal to decimals() means the
     *         decimalConversionRate == 1, so no dust is ever lost during bridging.
     */
    function sharedDecimals() public pure override returns (uint8) {
        return _SHARED_DECIMALS;
    }

    // ─── Ownership (Ownable2Step) ─────────────────────────────────────────────

    /**
     * @dev Overrides both OFT (Ownable) and Ownable2Step.  Ownership transfers are
     *      two-step: the proposed new owner must explicitly accept before the transfer
     *      is finalised, protecting against accidental key-loss.
     */
    function transferOwnership(
        address newOwner
    ) public override(Ownable, Ownable2Step) onlyOwner {
        Ownable2Step.transferOwnership(newOwner);
    }

    function _transferOwnership(
        address newOwner
    ) internal override(Ownable, Ownable2Step) {
        Ownable2Step._transferOwnership(newOwner);
    }

    // ─── Peer management (owner or developer) ─────────────────────────────────

    /**
     * @notice Registers a peer OFT contract on a remote chain.
     * @dev    Overrides OAppCore.setPeer() to allow the developer role in addition
     *         to the owner.  The owner can always call this regardless of the
     *         developer toggle.
     */
    function setPeer(
        uint32 _eid,
        bytes32 _peer
    ) public override onlyOwnerOrDeveloper {
        _setPeer(_eid, _peer);
    }

    // ─── Developer management (owner-only) ────────────────────────────────────

    /**
     * @notice Sets a new developer address.
     * @param  newDeveloper The address to authorise.  Use address(0) to remove.
     */
    function setDeveloper(address newDeveloper) external onlyOwner {
        address previous = developer;
        developer = newDeveloper;
        emit DeveloperChanged(previous, newDeveloper);
    }

    /**
     * @notice Enables the developer role.  Owner calls this to let the developer wire peers.
     */
    function enableDeveloper() external onlyOwner {
        developerEnabled = true;
        emit DeveloperToggled(true);
    }

    /**
     * @notice Disables the developer role.  Owner calls this to revoke peer-wiring access.
     */
    function disableDeveloper() external onlyOwner {
        developerEnabled = false;
        emit DeveloperToggled(false);
    }
}
