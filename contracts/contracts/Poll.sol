// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentIdRegistry} from "./interfaces/IAgentIdRegistry.sol";

/// @title Poll
/// @notice One Agent ID, one vote. Open, on-chain tallies where each Binance Agent ID counts once.
///
/// @dev Mirrors GiveawayVault's trust model without funds:
///      - On-chain voting (`vote`): a holder votes directly; one vote per address (soulbound Agent
///        ID ⇒ one per Agent ID), gated by `balanceOf > 0`. Fully trustless and public.
///      - Off-chain-tap voting (`commitVotes`): the FairSeat `operator` submits tap votes collected
///        in the app, each still checked `balanceOf > 0` and deduplicated on-chain. The operator can
///        only add votes before close and can never change a cast vote.
///      Option labels and the question live off-chain (published for audit); the contract counts
///      votes per option index. Tallies are readable by anyone at any time.
contract Poll {
    IAgentIdRegistry public immutable registry;
    address public immutable operator;

    enum Mode {
        OnChainVote,
        OffChainTap
    }

    struct PollInfo {
        address host;
        uint8 numOptions;
        uint64 closeBlock;
        Mode mode;
    }

    uint256 public nextId = 1;
    mapping(uint256 => PollInfo) private _polls;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(uint8 => uint256)) private _tally;
    mapping(uint256 => uint256) public totalVotes;

    event PollCreated(uint256 indexed id, address indexed host, uint8 numOptions, uint64 closeBlock, Mode mode);
    event Voted(uint256 indexed id, address indexed voter, uint8 option);

    error BadParams();
    error NotOperator();
    error WrongMode();
    error Closed();
    error NotAgentIdHolder();
    error AlreadyVoted();
    error BadOption();

    constructor(address registry_, address operator_) {
        require(registry_ != address(0) && operator_ != address(0), "zero addr");
        registry = IAgentIdRegistry(registry_);
        operator = operator_;
    }

    function createPoll(uint8 numOptions, uint64 closeBlock, Mode mode) external returns (uint256 id) {
        if (numOptions < 2 || numOptions > 32) revert BadParams();
        if (closeBlock <= block.number) revert BadParams();
        id = nextId++;
        _polls[id] = PollInfo({host: msg.sender, numOptions: numOptions, closeBlock: closeBlock, mode: mode});
        emit PollCreated(id, msg.sender, numOptions, closeBlock, mode);
    }

    /// @notice Cast your own vote (on-chain mode). One per Agent-ID holder.
    function vote(uint256 id, uint8 option) external {
        PollInfo storage p = _polls[id];
        if (p.numOptions == 0) revert BadParams();
        if (p.mode != Mode.OnChainVote) revert WrongMode();
        _castVote(id, p, msg.sender, option);
    }

    /// @notice Operator submits tap votes (off-chain mode). Each is gated + deduplicated on-chain.
    function commitVotes(uint256 id, address[] calldata voters, uint8[] calldata options) external {
        if (msg.sender != operator) revert NotOperator();
        PollInfo storage p = _polls[id];
        if (p.numOptions == 0) revert BadParams();
        if (p.mode != Mode.OffChainTap) revert WrongMode();
        if (voters.length != options.length) revert BadParams();
        for (uint256 i = 0; i < voters.length; i++) {
            address v = voters[i];
            if (
                v == address(0) ||
                options[i] >= p.numOptions ||
                hasVoted[id][v] ||
                block.number >= p.closeBlock ||
                registry.balanceOf(v) == 0
            ) continue;
            hasVoted[id][v] = true;
            _tally[id][options[i]]++;
            totalVotes[id]++;
            emit Voted(id, v, options[i]);
        }
    }

    function _castVote(uint256 id, PollInfo storage p, address voter, uint8 option) internal {
        if (block.number >= p.closeBlock) revert Closed();
        if (option >= p.numOptions) revert BadOption();
        if (registry.balanceOf(voter) == 0) revert NotAgentIdHolder();
        if (hasVoted[id][voter]) revert AlreadyVoted();
        hasVoted[id][voter] = true;
        _tally[id][option]++;
        totalVotes[id]++;
        emit Voted(id, voter, option);
    }

    // ---- views ----
    function getPoll(uint256 id)
        external
        view
        returns (address host, uint8 numOptions, uint64 closeBlock, Mode mode, uint256 votes, bool closed)
    {
        PollInfo storage p = _polls[id];
        return (p.host, p.numOptions, p.closeBlock, p.mode, totalVotes[id], block.number >= p.closeBlock);
    }

    function getTally(uint256 id) external view returns (uint256[] memory counts) {
        PollInfo storage p = _polls[id];
        counts = new uint256[](p.numOptions);
        for (uint8 i = 0; i < p.numOptions; i++) counts[i] = _tally[id][i];
    }
}
