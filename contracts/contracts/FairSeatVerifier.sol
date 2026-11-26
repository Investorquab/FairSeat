// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentIdRegistry} from "./interfaces/IAgentIdRegistry.sol";

/// @title FairSeatVerifier
/// @notice One-time proof that a wallet controls a Binance Agent ID, by a tiny
///         self-initiated transfer. A user sends a small amount of native BNB to this
///         contract FROM the wallet that holds their Agent ID. The contract checks
///         `registry.balanceOf(sender) > 0`, emits `Verified` (which the FairSeat backend
///         watches to bind a Telegram/site account to that wallet), and refunds the dust.
///
/// @dev Design / red-line compliance:
///      - The user initiates and confirms the transfer in their own wallet. FairSeat never
///        signs for the user, never stores wallet sessions, and never asks for keys.
///      - Non-holders simply have their transaction revert, so their funds never leave them.
///      - Holders are refunded in full; the contract keeps nothing.
///      - The sent `amount` doubles as a one-time nonce: the backend issues a unique tiny
///        amount per verification session and matches it from the `Verified` event.
contract FairSeatVerifier {
    IAgentIdRegistry public immutable registry;

    event Verified(address indexed account, uint256 amount);

    error NotAgentIdHolder();
    error RefundFailed();

    constructor(address registry_) {
        require(registry_ != address(0), "registry=0");
        registry = IAgentIdRegistry(registry_);
    }

    /// @notice Verify by a plain value transfer (no calldata needed).
    receive() external payable {
        _verify(msg.value);
    }

    /// @notice Verify via an explicit call (equivalent to `receive`).
    function verify() external payable {
        _verify(msg.value);
    }

    function _verify(uint256 amount) internal {
        // Not a holder: revert so the whole transfer is undone and funds stay with the user.
        if (registry.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();

        emit Verified(msg.sender, amount);

        // Refund the dust to the sender; keep nothing.
        if (amount > 0) {
            (bool ok, ) = payable(msg.sender).call{value: amount}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @notice Convenience read: does `account` currently hold an Agent ID?
    function holdsAgentId(address account) external view returns (bool) {
        return registry.balanceOf(account) > 0;
    }
}
