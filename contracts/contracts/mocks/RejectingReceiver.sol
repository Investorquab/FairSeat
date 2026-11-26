// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RejectingReceiver
/// @notice TEST-ONLY: a contract that rejects every native transfer, used to prove that a
///         recipient which refuses funds is skipped (best-effort payout) rather than locking a
///         giveaway or a batch distribution.
contract RejectingReceiver {
    receive() external payable {
        revert("RejectingReceiver: no");
    }

    fallback() external payable {
        revert("RejectingReceiver: no");
    }
}
