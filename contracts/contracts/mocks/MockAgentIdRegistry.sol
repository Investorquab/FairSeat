// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentIdRegistry} from "../interfaces/IAgentIdRegistry.sol";

/// @title MockAgentIdRegistry
/// @notice TEST-ONLY stand-in for the real Agent ID registry, for local + BSC-testnet runs
///         (the real Agent ID only exists on BNB mainnet). It mirrors the single behaviour
///         FairSeat depends on: `balanceOf(addr) > 0` means `addr` holds an Agent ID, and an
///         address can hold at most one (soulbound / non-transferable).
/// @dev    NEVER deploy this to mainnet — mainnet uses the real registry
///         0x60B9262456dE011F7d15a54cdd8c48bAaa8B022f.
contract MockAgentIdRegistry is IAgentIdRegistry {
    string public constant name = "SPACE ID Agent ID";
    string public constant symbol = "AI";

    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _owners;
    uint256 public nextTokenId = 1;

    event AgentIdAssigned(address indexed owner, uint256 indexed tokenId);

    /// @notice Give `to` an Agent ID (one per address, like mainnet). Test helper.
    function assign(address to) external returns (uint256 tokenId) {
        require(to != address(0), "zero address");
        require(_balances[to] == 0, "already holds Agent ID");
        tokenId = nextTokenId++;
        _balances[to] = 1;
        _owners[tokenId] = to;
        emit AgentIdAssigned(to, tokenId);
    }

    /// @inheritdoc IAgentIdRegistry
    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }

    /// @inheritdoc IAgentIdRegistry
    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = _owners[tokenId];
        require(o != address(0), "nonexistent token");
        return o;
    }
}
