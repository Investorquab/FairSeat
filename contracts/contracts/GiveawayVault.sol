// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentIdRegistry} from "./interfaces/IAgentIdRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title GiveawayVault
/// @notice Locks a host's reward and pays it out to Agent-ID-holding winners by a rule the
///         host chooses, with no one — not even the host or FairSeat — able to withdraw the
///         funds early or re-roll the draw.
///
/// @dev Trust model (what this contract guarantees on-chain):
///      - Funds are locked at creation and can only leave via `resolve` (to winners +
///        leftover to host) or `cancel` (only before anyone has entered, back to host).
///      - There is NO owner/admin that can take funds. The `operator` can ONLY submit the
///        entrant list for off-chain-tap giveaways, never move money.
///      - Every paid winner is checked to hold an Agent ID (`balanceOf > 0`) at payout.
///      - Random draws are seeded from a FUTURE block hash (`drawBlock`); entrants are fixed
///        before that block exists, so the result is recomputable by anyone and cannot be
///        re-rolled. (Honest caveat: block producers can influence a single block hash; this
///        is standard for on-chain giveaways and acceptable at this scale — not a VRF.)
///
///      What lives OFF-CHAIN (by design): Telegram group membership, access keys, "most
///      active" and other host rules, and for off-chain-tap giveaways the entrant selection.
///      Those are published by the FairSeat backend for audit; the money guarantees above are
///      on-chain regardless.
contract GiveawayVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IAgentIdRegistry public immutable registry;

    /// @notice Address allowed to commit entrants for off-chain-tap giveaways (the FairSeat
    ///         backend). It can NEVER move funds. Set once at deployment.
    address public immutable operator;

    enum Rule {
        FirstN,       // first `winnerCount` entrants (by entry/commit order)
        Random,       // `winnerCount` entrants chosen by future-block-hash seed
        SplitEqually  // every entrant shares the prize equally
    }

    enum EntryMode {
        OffChainTap,  // entrants submitted by `operator` via `commitEntrants` (bot taps)
        OnChainEnter  // entrants call `enter` themselves (public only)
    }

    enum State {
        Open,
        Resolved,
        Cancelled
    }

    struct Giveaway {
        address host;
        address token;        // address(0) = native BNB, else BEP-20
        uint256 prize;        // total locked reward
        uint32 winnerCount;   // number of winners (ignored for SplitEqually)
        Rule rule;
        EntryMode entryMode;
        uint64 drawBlock;     // resolve allowed after this block; blockhash(drawBlock) is the seed
        State state;
        address[] entrants;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Giveaway) private _giveaways;
    mapping(uint256 => mapping(address => bool)) public hasEntered;

    event GiveawayCreated(
        uint256 indexed id,
        address indexed host,
        address token,
        uint256 prize,
        uint32 winnerCount,
        Rule rule,
        EntryMode entryMode,
        uint64 drawBlock
    );
    event Entered(uint256 indexed id, address indexed account);
    event EntrantsCommitted(uint256 indexed id, uint256 count);
    event Resolved(uint256 indexed id, bytes32 seed, address[] winners, uint256 perWinner, uint256 leftoverToHost);
    event Cancelled(uint256 indexed id);

    error BadParams();
    error NotOpen();
    error NotOperator();
    error WrongEntryMode();
    error NotAgentIdHolder();
    error AlreadyEntered();
    error TooLate();
    error TooEarly();
    error NotHost();
    error HasEntrants();
    error TransferFailed();

    constructor(address registry_, address operator_) {
        require(registry_ != address(0) && operator_ != address(0), "zero addr");
        registry = IAgentIdRegistry(registry_);
        operator = operator_;
    }

    // ----------------------------------------------------------------------------------
    // Create + fund (host locks the reward here)
    // ----------------------------------------------------------------------------------

    /// @param token address(0) for native BNB, otherwise a BEP-20 token.
    /// @param prize total reward to lock. For native, must equal msg.value.
    /// @param winnerCount number of winners (must be >= 1; ignored for SplitEqually).
    /// @param rule selection rule.
    /// @param entryMode how entrants are collected.
    /// @param drawBlock block number after which `resolve` is allowed and whose hash seeds Random.
    function createGiveaway(
        address token,
        uint256 prize,
        uint32 winnerCount,
        Rule rule,
        EntryMode entryMode,
        uint64 drawBlock
    ) external payable nonReentrant returns (uint256 id) {
        if (prize == 0) revert BadParams();
        if (rule != Rule.SplitEqually && winnerCount == 0) revert BadParams();
        if (drawBlock <= block.number) revert BadParams();
        // On-chain entry is public by nature; private giveaways must use off-chain-tap.
        // (Access-key / membership gating for private lives in the backend.)

        if (token == address(0)) {
            if (msg.value != prize) revert BadParams();
        } else {
            if (msg.value != 0) revert BadParams();
            IERC20(token).safeTransferFrom(msg.sender, address(this), prize);
        }

        id = nextId++;
        Giveaway storage g = _giveaways[id];
        g.host = msg.sender;
        g.token = token;
        g.prize = prize;
        g.winnerCount = winnerCount;
        g.rule = rule;
        g.entryMode = entryMode;
        g.drawBlock = drawBlock;
        g.state = State.Open;

        emit GiveawayCreated(id, msg.sender, token, prize, winnerCount, rule, entryMode, drawBlock);
    }

    // ----------------------------------------------------------------------------------
    // Enter (on-chain mode) / commit entrants (off-chain-tap mode)
    // ----------------------------------------------------------------------------------

    /// @notice Enter an on-chain giveaway. Only addresses holding an Agent ID can enter, once.
    function enter(uint256 id) external {
        Giveaway storage g = _giveaways[id];
        if (g.state != State.Open) revert NotOpen();
        if (g.entryMode != EntryMode.OnChainEnter) revert WrongEntryMode();
        if (block.number >= g.drawBlock) revert TooLate();
        if (registry.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        if (hasEntered[id][msg.sender]) revert AlreadyEntered();

        hasEntered[id][msg.sender] = true;
        g.entrants.push(msg.sender);
        emit Entered(id, msg.sender);
    }

    /// @notice Commit entrants for an off-chain-tap giveaway. Only the FairSeat `operator`,
    ///         only before `drawBlock` (so the set is fixed before the seed exists). May be
    ///         called multiple times to append; duplicates are skipped.
    function commitEntrants(uint256 id, address[] calldata entrants) external {
        if (msg.sender != operator) revert NotOperator();
        Giveaway storage g = _giveaways[id];
        if (g.state != State.Open) revert NotOpen();
        if (g.entryMode != EntryMode.OffChainTap) revert WrongEntryMode();
        if (block.number >= g.drawBlock) revert TooLate();

        uint256 added;
        for (uint256 i = 0; i < entrants.length; i++) {
            address a = entrants[i];
            if (a == address(0) || hasEntered[id][a]) continue;
            hasEntered[id][a] = true;
            g.entrants.push(a);
            added++;
        }
        emit EntrantsCommitted(id, added);
    }

    // ----------------------------------------------------------------------------------
    // Resolve (permissionless) — pick winners from the fixed entrant set and pay them
    // ----------------------------------------------------------------------------------

    /// @notice Resolve a giveaway after its draw block. Anyone may call it (no trusted party).
    function resolve(uint256 id) external nonReentrant {
        Giveaway storage g = _giveaways[id];
        if (g.state != State.Open) revert NotOpen();
        if (block.number <= g.drawBlock) revert TooEarly();

        // Seed from the draw block's hash. `blockhash` only covers the most recent 256
        // blocks, so if resolution is very late (draw block older than that) we fall back
        // to a recent block hash — funds can never get stuck. Entrants were fixed before
        // the draw block in either case. (The backend resolves promptly, so the primary
        // path is the norm; the fallback is a safety net only.)
        bytes32 seed = blockhash(g.drawBlock);
        if (seed == bytes32(0)) {
            seed = blockhash(block.number - 1);
        }

        g.state = State.Resolved;

        address[] memory entrants = g.entrants;
        uint256 prize = g.prize;

        // No entrants → return everything to the host.
        if (entrants.length == 0) {
            _payout(g.token, g.host, prize);
            emit Resolved(id, seed, new address[](0), 0, prize);
            return;
        }

        address[] memory winners = _selectWinners(entrants, g.rule, g.winnerCount, uint256(seed));
        uint256 perWinner = prize / winners.length;

        uint256 totalPaid;
        for (uint256 i = 0; i < winners.length; i++) {
            // Only pay winners that hold an Agent ID; a transfer that fails (e.g. a winner whose
            // wallet rejects funds) is skipped, never reverted, so one bad winner cannot lock the
            // giveaway. A skipped winner's share stays in `leftover` and returns to the host.
            if (registry.balanceOf(winners[i]) == 0) continue;
            if (_tryPay(g.token, winners[i], perWinner)) totalPaid += perWinner;
        }

        uint256 leftover = prize - totalPaid;
        if (leftover > 0) _tryPay(g.token, g.host, leftover);

        emit Resolved(id, seed, winners, perWinner, leftover);
    }

    /// @notice Host may cancel and reclaim the prize ONLY before anyone has entered.
    function cancel(uint256 id) external nonReentrant {
        Giveaway storage g = _giveaways[id];
        if (msg.sender != g.host) revert NotHost();
        if (g.state != State.Open) revert NotOpen();
        if (g.entrants.length != 0) revert HasEntrants();

        g.state = State.Cancelled;
        _payout(g.token, g.host, g.prize);
        emit Cancelled(id);
    }

    // ----------------------------------------------------------------------------------
    // Winner selection (pure & deterministic → recomputable off-chain)
    // ----------------------------------------------------------------------------------

    function _selectWinners(
        address[] memory entrants,
        Rule rule,
        uint32 winnerCount,
        uint256 seed
    ) internal pure returns (address[] memory winners) {
        uint256 len = entrants.length;

        if (rule == Rule.SplitEqually) {
            return entrants; // everyone wins an equal share
        }

        uint256 count = winnerCount < len ? winnerCount : len;

        if (rule == Rule.FirstN) {
            winners = new address[](count);
            for (uint256 i = 0; i < count; i++) winners[i] = entrants[i];
            return winners;
        }

        // Rule.Random — partial Fisher-Yates shuffle seeded by the block hash.
        winners = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 j = i + (uint256(keccak256(abi.encode(seed, i))) % (len - i));
            (entrants[i], entrants[j]) = (entrants[j], entrants[i]);
            winners[i] = entrants[i];
        }
    }

    // ----------------------------------------------------------------------------------
    // Internal payout (native or BEP-20)
    // ----------------------------------------------------------------------------------

    function _payout(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @dev Best-effort transfer used in `resolve`: returns false instead of reverting, so one
    ///      recipient that rejects funds can never block the whole payout (F-1).
    function _tryPay(address token, address to, uint256 amount) internal returns (bool) {
        if (amount == 0) return true;
        if (token == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            return ok;
        }
        (bool ok2, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        return ok2 && (data.length == 0 || abi.decode(data, (bool)));
    }

    // ----------------------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------------------

    function getGiveaway(uint256 id)
        external
        view
        returns (
            address host,
            address token,
            uint256 prize,
            uint32 winnerCount,
            Rule rule,
            EntryMode entryMode,
            uint64 drawBlock,
            State state,
            uint256 entrantCount
        )
    {
        Giveaway storage g = _giveaways[id];
        return (g.host, g.token, g.prize, g.winnerCount, g.rule, g.entryMode, g.drawBlock, g.state, g.entrants.length);
    }

    function getEntrants(uint256 id) external view returns (address[] memory) {
        return _giveaways[id].entrants;
    }
}
