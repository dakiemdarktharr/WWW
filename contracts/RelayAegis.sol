// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Fuji-only policy and evidence registry. No deposits, payments, or tokens.
/// @dev Off-chain software must enforce these policies. Registry data is not proof of execution.
contract RelayAegis is Ownable2Step {
    uint256 public constant FUJI_CHAIN_ID = 43113;
    uint8 public constant RUN = 1;
    uint8 public constant MERGE = 2;
    address public immutable executor;

    struct Grant { uint64 epoch; uint64 expiresAt; uint8 permissions; }
    struct Action {
        bytes32 projectId;
        bytes32 machineId;
        bytes32 payloadDigest;
        uint64 epoch;
        uint64 projectEpoch;
        uint64 expiresAt;
        bool consumed;
    }
    mapping(bytes32 => bool) public protectedProjects;
    mapping(bytes32 => uint64) public projectEpochs;
    mapping(bytes32 => mapping(bytes32 => Grant)) public grants;
    mapping(bytes32 => Action) public actions;
    mapping(bytes32 => mapping(bytes32 => bytes32)) public receipts;
    event ProjectPolicy(bytes32 indexed projectId, bool enabled);
    event MachineGrant(bytes32 indexed projectId, bytes32 indexed machineId, uint64 epoch, uint8 permissions, uint64 expiresAt);
    event ActionApproved(bytes32 indexed actionId, bytes32 indexed projectId, bytes32 payloadDigest, uint64 expiresAt);
    event ActionConsumed(bytes32 indexed actionId);
    event ReceiptAnchored(bytes32 indexed projectId, bytes32 indexed receiptId, bytes32 digest);
    error WrongChain();
    error Denied();
    error InvalidInput();
    error ExpiredOrConsumed();

    constructor(address owner_, address executor_) Ownable(owner_) {
        if (block.chainid != FUJI_CHAIN_ID) revert WrongChain();
        if (executor_ == address(0) || executor_ == owner_) revert InvalidInput();
        executor = executor_;
    }
    modifier onlyExecutor() { if (msg.sender != executor) revert Denied(); _; }

    function setProject(bytes32 projectId, bool enabled) external onlyOwner {
        if (projectId == bytes32(0)) revert InvalidInput();
        protectedProjects[projectId] = enabled;
        projectEpochs[projectId] += 1;
        emit ProjectPolicy(projectId, enabled);
    }
    function setGrant(bytes32 projectId, bytes32 machineId, uint8 permissions, uint64 expiresAt) external onlyOwner {
        if (projectId == bytes32(0) || machineId == bytes32(0) || permissions > 3) revert InvalidInput();
        if (permissions != 0 && (expiresAt <= block.timestamp || expiresAt > block.timestamp + 30 days)) revert InvalidInput();
        Grant storage grant = grants[projectId][machineId];
        grant.epoch += 1;
        grant.permissions = permissions;
        grant.expiresAt = permissions == 0 ? 0 : expiresAt;
        emit MachineGrant(projectId, machineId, grant.epoch, permissions, grant.expiresAt);
    }
    function canRun(bytes32 projectId, bytes32 machineId) public view returns (bool) {
        Grant memory grant = grants[projectId][machineId];
        return protectedProjects[projectId] && grant.expiresAt > block.timestamp && (grant.permissions & RUN) != 0;
    }
    function approveMerge(bytes32 projectId, bytes32 machineId, bytes32 payloadDigest, uint64 expiresAt, bytes32 nonce) external onlyOwner returns (bytes32 actionId) {
        Grant memory grant = grants[projectId][machineId];
        if (!protectedProjects[projectId] || (grant.permissions & MERGE) == 0 || grant.expiresAt <= block.timestamp) revert Denied();
        if (payloadDigest == bytes32(0) || nonce == bytes32(0) || expiresAt <= block.timestamp || expiresAt > block.timestamp + 1 hours || expiresAt > grant.expiresAt) revert InvalidInput();
        actionId = keccak256(abi.encode(block.chainid, address(this), projectId, machineId, grant.epoch, projectEpochs[projectId], payloadDigest, expiresAt, nonce));
        if (actions[actionId].expiresAt != 0) revert InvalidInput();
        actions[actionId] = Action(projectId, machineId, payloadDigest, grant.epoch, projectEpochs[projectId], expiresAt, false);
        emit ActionApproved(actionId, projectId, payloadDigest, expiresAt);
    }
    function consumeMerge(bytes32 actionId, bytes32 payloadDigest) external onlyExecutor {
        Action storage action = actions[actionId];
        Grant memory grant = grants[action.projectId][action.machineId];
        if (action.consumed || action.expiresAt <= block.timestamp) revert ExpiredOrConsumed();
        if (!protectedProjects[action.projectId] || action.payloadDigest != payloadDigest || action.epoch != grant.epoch || action.projectEpoch != projectEpochs[action.projectId] || grant.expiresAt <= block.timestamp || (grant.permissions & MERGE) == 0) revert Denied();
        action.consumed = true;
        emit ActionConsumed(actionId);
    }
    function anchorReceipt(bytes32 projectId, bytes32 receiptId, bytes32 digest) external onlyExecutor {
        if (!protectedProjects[projectId] || receiptId == bytes32(0) || digest == bytes32(0)) revert InvalidInput();
        if (receipts[projectId][receiptId] != bytes32(0)) revert InvalidInput();
        receipts[projectId][receiptId] = digest;
        emit ReceiptAnchored(projectId, receiptId, digest);
    }
    /// @dev Avoid accidentally making a protected workspace impossible to administer.
    function renounceOwnership() public view override onlyOwner { revert Denied(); }
}
