import { Interface, keccak256, toUtf8Bytes } from 'ethers';

export const SPONSORED_PROTOCOL = 'usdc-authorization-v2';
export const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};
export const AUTHORIZATION_ABI = [
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
  'function authorizationState(address authorizer,bytes32 nonce) view returns(bool)',
  'function DOMAIN_SEPARATOR() view returns(bytes32)',
  'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
];
export const authorizationInterface = new Interface(AUTHORIZATION_ABI);
export type SignedPurchase = {
  id: string;
  wallet: string;
  plan: 'plus' | 'max';
  createdAt: number;
  token: string;
  treasury: string;
};
export function purchaseAuthorization(order: SignedPurchase) {
  return {
    domain: { name: 'USD Coin', version: '2', chainId: 43113, verifyingContract: order.token },
    message: {
      from: order.wallet,
      to: order.treasury,
      value: '0',
      validAfter: Math.floor(order.createdAt / 1000) - 60,
      validBefore: Math.floor(order.createdAt / 1000) + 900,
      nonce: keccak256(
        toUtf8Bytes(
          JSON.stringify([
            'kivuno-usdc-purchase-v2',
            43113,
            order.id,
            order.wallet,
            order.plan,
            0,
            order.plan === 'plus' ? 2 : 6,
            order.createdAt,
            order.token,
            order.treasury,
          ]),
        ),
      ),
    },
  };
}
