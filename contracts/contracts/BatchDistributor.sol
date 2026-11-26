// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentIdRegistry} from "./interfaces/IAgentIdRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BatchDistributor
/// @notice Pay a whole list of recipients in one transaction, paying ONLY addresses that hold a
///         Binance Agent ID. Use case: credit a collated list of verified winners/recipients
///         (airdrops, grant payouts, hackathon prizes) without transferring one-by-one.
///
/// @dev Atomic and custody-free: funds arrive, holders are paid, and anything left (skipped
///      non-holders + rounding) is refunded to the sender in the same transaction. There is no
///      stored balance and no admin that can take funds. Each recipient is checked
///      `registry.balanceOf(recipient) > 0`; a non-holder is skipped (its share refunded), never
///      paid. The sender confirms the transaction in their own wallet.
contract BatchDistributor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IAgentIdRegistry public immutable registry;

    event Distributed(address indexed sender, address token, uint256 paidCount, uint256 totalPaid, uint256 refunded);
    event Skipped(address indexed recipient, uint256 amount); // not an Agent ID holder

    error LengthMismatch();
    error EmptyList();
    error BadValue();
    error TransferFailed();

    constructor(address registry_) {
        require(registry_ != address(0), "registry=0");
        registry = IAgentIdRegistry(registry_);
    }

    /// @param token address(0) for native BNB, otherwise a BEP-20 token.
    /// @param recipients the collated addresses.
    /// @param amounts the amount for each recipient (same length).
    function distribute(address token, address[] calldata recipients, uint256[] calldata amounts)
        external
        payable
        nonReentrant
    {
        if (recipients.length != amounts.length) revert LengthMismatch();
        if (recipients.length == 0) revert EmptyList();

        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) total += amounts[i];

        if (token == address(0)) {
            if (msg.value != total) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            IERC20(token).safeTransferFrom(msg.sender, address(this), total);
        }

        uint256 paid;
        uint256 paidCount;
        for (uint256 i = 0; i < recipients.length; i++) {
            address to = recipients[i];
            uint256 amt = amounts[i];
            if (to != address(0) && amt > 0 && registry.balanceOf(to) > 0) {
                // Best-effort: if a recipient rejects funds, skip it (share refunded below)
                // rather than reverting the whole batch (F-2).
                if (_tryPay(token, to, amt)) {
                    paid += amt;
                    paidCount++;
                } else {
                    emit Skipped(to, amt);
                }
            } else if (amt > 0) {
                emit Skipped(to, amt);
            }
        }

        uint256 refund = total - paid;
        if (refund > 0) _pay(token, msg.sender, refund);

        emit Distributed(msg.sender, token, paidCount, paid, refund);
    }

    /// @notice Read helper: which of these addresses currently hold an Agent ID (for a UI preview).
    function holders(address[] calldata addrs) external view returns (bool[] memory out) {
        out = new bool[](addrs.length);
        for (uint256 i = 0; i < addrs.length; i++) out[i] = registry.balanceOf(addrs[i]) > 0;
    }

    function _pay(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @dev Best-effort transfer for recipients: returns false instead of reverting (F-2).
    function _tryPay(address token, address to, uint256 amount) internal returns (bool) {
        if (amount == 0) return true;
        if (token == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            return ok;
        }
        (bool ok2, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        return ok2 && (data.length == 0 || abi.decode(data, (bool)));
    }
}
