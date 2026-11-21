// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev Minimal local fixture for the Fuji USDC EIP-3009 path. It does not replace Circle USDC.
contract MockUSDC {
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        'ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'
    );
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
    );
    bytes32 private constant NAME_HASH = keccak256('USD Coin');
    bytes32 private constant VERSION_HASH = keccak256('2');

    mapping(address account => uint256 amount) private balances;
    mapping(address account => mapping(bytes32 nonce => bool used)) public authorizationState;

    error InvalidAuthorization();
    error InsufficientBalance();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
        if (block.timestamp <= validAfter || block.timestamp >= validBefore || authorizationState[from][nonce]) revert InvalidAuthorization();
        bytes32 hash = keccak256(abi.encode(keccak256('TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'), from, to, value, validAfter, validBefore, nonce));
        if (from == address(0) || ecrecover(keccak256(abi.encodePacked('\x19\x01', DOMAIN_SEPARATOR(), hash)), v, r, s) != from || balances[from] < value) revert InvalidAuthorization();
        authorizationState[from][nonce] = true;
        balances[from] -= value;
        balances[to] += value;
        emit AuthorizationUsed(from, nonce);
        emit Transfer(from, to, value);
    }

    function name() external pure returns (string memory) {
        return 'USD Coin';
    }

    function version() external pure returns (string memory) {
        return '2';
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function mint(address account, uint256 amount) external {
        balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balances[msg.sender] < amount) revert InsufficientBalance();
        balances[msg.sender] -= amount;
        balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

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
    ) external {
        if (
            to != msg.sender ||
            validAfter > block.timestamp ||
            validBefore <= block.timestamp ||
            nonce == bytes32(0) ||
            authorizationState[from][nonce]
        ) revert InvalidAuthorization();

        bytes32 structHash = keccak256(
            abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
        bytes32 digest = keccak256(abi.encodePacked('\x19\x01', domainSeparator, structHash));
        if (ecrecover(digest, v, r, s) != from || balances[from] < value)
            revert InvalidAuthorization();

        authorizationState[from][nonce] = true;
        balances[from] -= value;
        balances[to] += value;
        emit AuthorizationUsed(from, nonce);
        emit Transfer(from, to, value);
    }
}
