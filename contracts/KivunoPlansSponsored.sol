// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC3009Receiver} from "./KivunoPlans.sol";

/// @notice Fuji contest subscriptions: the buyer signs, the project relays, and payment is always zero.
/// @dev ReceiveWithAuthorization restricts consumption to this contract. Its nonce binds the plan,
///      intent and one-time legacy term import, so a relayer cannot change what the buyer signed.
///      Legacy terms originate in the previous off-chain service; only the immutable project relayer
///      may import them on a wallet's first purchase. Later terms follow this contract's rules.
contract KivunoPlansSponsored is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FUJI_CHAIN_ID = 43113;
    uint8 public constant PLUS = 1;
    uint8 public constant MAX = 2;
    uint256 public constant ACTUAL_PRICE = 0;
    uint256 public constant SIMULATED_PLUS_PRICE = 2_000_000;
    uint256 public constant SIMULATED_MAX_PRICE = 6_000_000;
    uint256 public constant PERIOD = 30 days;
    string public constant protocol = "kivuno-plans-sponsored-v3";

    IERC3009Receiver public immutable usdc;
    address public immutable treasury;
    address public immutable relayer;

    struct Subscription { uint64 paidUntil; uint8 planId; }
    struct Purchase {
        bytes32 intentId;
        address payer;
        uint8 planId;
        uint8 previousPlan;
        uint64 previousPaidUntil;
        uint256 validAfter;
        uint256 validBefore;
    }
    mapping(address => Subscription) public subscriptions;
    mapping(bytes32 => bool) public usedIntents;

    event PlanPaid(bytes32 indexed paymentIntentId, address indexed payer, uint8 indexed planId,
        address token, uint256 amount, uint64 paidUntil);
    event LegacyTermImported(address indexed payer, uint8 planId, uint64 paidUntil);

    error WrongChain();
    error InvalidAddress();
    error UnauthorizedRelayer();
    error InvalidPlan();
    error InvalidIntent();
    error InvalidAuthorizationWindow();
    error InvalidLegacyTerm();

    constructor(address token_, address treasury_, address relayer_) {
        if (block.chainid != FUJI_CHAIN_ID) revert WrongChain();
        if (token_.code.length == 0 || treasury_ == address(0) || relayer_ == address(0)
            || token_ == treasury_) revert InvalidAddress();
        usdc = IERC3009Receiver(token_);
        treasury = treasury_;
        relayer = relayer_;
    }

    function authorizationNonce(Purchase calldata purchase) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), FUJI_CHAIN_ID, purchase.intentId,
            purchase.payer, purchase.planId, purchase.previousPlan, purchase.previousPaidUntil));
    }

    function paySponsored(Purchase calldata purchase, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        if (block.chainid != FUJI_CHAIN_ID) revert WrongChain();
        if (msg.sender != relayer) revert UnauthorizedRelayer();
        if (purchase.payer == address(0)) revert InvalidAddress();
        if (purchase.intentId == bytes32(0) || usedIntents[purchase.intentId]) revert InvalidIntent();
        if (purchase.planId != PLUS && purchase.planId != MAX) revert InvalidPlan();
        if (purchase.validAfter >= block.timestamp || purchase.validBefore <= block.timestamp
            || purchase.validBefore <= purchase.validAfter || purchase.validBefore > block.timestamp + 1 hours)
            revert InvalidAuthorizationWindow();

        Subscription storage current = subscriptions[purchase.payer];
        if (purchase.previousPaidUntil != 0 || purchase.previousPlan != 0) {
            if (current.paidUntil != 0 || purchase.previousPaidUntil == 0
                || (purchase.previousPlan != PLUS && purchase.previousPlan != MAX)) revert InvalidLegacyTerm();
            current.paidUntil = purchase.previousPaidUntil;
            current.planId = purchase.previousPlan;
            emit LegacyTermImported(purchase.payer, purchase.previousPlan, purchase.previousPaidUntil);
        }
        usedIntents[purchase.intentId] = true;
        usdc.receiveWithAuthorization(purchase.payer, address(this), ACTUAL_PRICE,
            purchase.validAfter, purchase.validBefore, authorizationNonce(purchase), v, r, s);
        IERC20(address(usdc)).safeTransfer(treasury, ACTUAL_PRICE);

        uint256 start = current.planId == purchase.planId && current.paidUntil > block.timestamp
            ? current.paidUntil : block.timestamp;
        current.paidUntil = uint64(start + PERIOD);
        current.planId = purchase.planId;
        emit PlanPaid(purchase.intentId, purchase.payer, purchase.planId, address(usdc), ACTUAL_PRICE, current.paidUntil);
    }
}
