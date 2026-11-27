// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAgentIdRegistry
/// @notice Minimal interface to the Binance / SPACE ID "Agent ID" registry on BNB Chain.
/// @dev Mainnet registry: 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F
///      (name "SPACE ID Agent ID", symbol "AI", ERC-721, non-transferable / soulbound).
///      Verified first-hand on BSC mainnet: `balanceOf(addr) > 0` means `addr` holds an Agent ID.
///      Note: the registry is NOT ERC-721 Enumerable (totalSupply reverts), so there is no
///      on-chain holder list or global count - per-address `balanceOf` is the only membership gate.
interface IAgentIdRegistry {
    /// @notice Number of Agent IDs held by `owner`. Soulbound ⇒ 0 or 1 per address.
    function balanceOf(address owner) external view returns (uint256);

    /// @notice Owner of a given Agent ID token. (Used for optional name→owner resolution.)
    function ownerOf(uint256 tokenId) external view returns (address);
}
