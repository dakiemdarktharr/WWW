// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC3009Receiver {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @notice Fuji-only manual payments for Kivuno Plus and Max.
/// @dev The payer authorizes one exact USDC transfer per confirmed purchase.
///      This contract has no owner, no allowance flow, and no refund path.
contract KivunoPlans is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FUJI_CHAIN_ID = 43113;
    uint8 public constant PLUS = 1;
    uint8 public constant MAX = 2;
    uint256 public constant PLUS_PRICE = 2_000_000;
    uint256 public constant MAX_PRICE = 6_000_000;
    uint256 public constant PERIOD = 30 days;

    IERC3009Receiver public immutable usdc;
    address public immutable treasury;

    struct Subscription {
        uint64 paidUntil;
        uint8 planId;
    }

    mapping(address payer => Subscription subscription) public subscriptions;
    mapping(bytes32 intentId => bool used) public usedIntents;

    event PlanPaid(
        bytes32 indexed paymentIntentId,
        address indexed payer,
        uint8 indexed planId,
        address token,
        uint256 amount,
        uint64 paidUntil
    );

    error WrongChain();
    error InvalidAddress();
    error InvalidPlan();
    error InvalidIntent();
    error InvalidAuthorizationWindow();
    error UnexpectedTokenAmount();

    constructor(address usdc_, address treasury_) {
        if (block.chainid != FUJI_CHAIN_ID) revert WrongChain();
        if (usdc_ == address(0) || treasury_ == address(0) || usdc_ == treasury_)
            revert InvalidAddress();
        usdc = IERC3009Receiver(usdc_);
        treasury = treasury_;
    }

    /// @param paymentIntentId Server-created unique ID. It contains no user data.
    /// @param planId PLUS or MAX.
    /// @param validAfter EIP-3009 authorization start time.
    /// @param validBefore EIP-3009 authorization expiry; at most one hour away.
    /// @param nonce EIP-3009 one-use authorization nonce.
    /// @dev The caller is the payer and pays C-Chain gas. The USDC authorization is
    ///      only for this exact contract, amount and short time window.
    function pay(
        bytes32 paymentIntentId,
        uint8 planId,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        if (paymentIntentId == bytes32(0) || usedIntents[paymentIntentId]) revert InvalidIntent();
        uint256 amount;
        if (planId == PLUS) amount = PLUS_PRICE;
        else if (planId == MAX) amount = MAX_PRICE;
        else revert InvalidPlan();
        if (
            nonce == bytes32(0) ||
            validAfter > block.timestamp ||
            validBefore <= block.timestamp ||
            validBefore <= validAfter ||
            validBefore > block.timestamp + 1 hours
        ) revert InvalidAuthorizationWindow();

        usedIntents[paymentIntentId] = true;
        usdc.receiveWithAuthorization(
            msg.sender,
            address(this),
            amount,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );

        IERC20 token = IERC20(address(usdc));
        uint256 treasuryBalance = token.balanceOf(treasury);
        token.safeTransfer(treasury, amount);
        if (token.balanceOf(treasury) - treasuryBalance != amount) revert UnexpectedTokenAmount();

        Subscription storage current = subscriptions[msg.sender];
        uint256 start = current.planId == planId && current.paidUntil > block.timestamp
            ? current.paidUntil
            : block.timestamp;
        uint64 paidUntil = uint64(start + PERIOD);
        current.paidUntil = paidUntil;
        current.planId = planId;

        emit PlanPaid(paymentIntentId, msg.sender, planId, address(usdc), amount, paidUntil);
    }
}
