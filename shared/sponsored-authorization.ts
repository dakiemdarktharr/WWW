import { AbiCoder, Interface, keccak256, toUtf8Bytes } from 'ethers';

export const LEGACY_SPONSORED_PROTOCOL = 'usdc-authorization-v2';
export const SPONSORED_PROTOCOL = 'kivuno-plans-sponsored-v3';
export const LEGACY_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};
export const AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: LEGACY_AUTHORIZATION_TYPES.TransferWithAuthorization,
};
export const PLANS_ABI = [
  'function protocol() view returns(string)',
  'function usdc() view returns(address)',
  'function treasury() view returns(address)',
  'function relayer() view returns(address)',
  'function ACTUAL_PRICE() view returns(uint256)',
  'function subscriptions(address) view returns(uint64 paidUntil,uint8 planId)',
  'function usedIntents(bytes32) view returns(bool)',
  'function paySponsored((bytes32 intentId,address payer,uint8 planId,uint8 previousPlan,uint64 previousPaidUntil,uint256 validAfter,uint256 validBefore) purchase,uint8 v,bytes32 r,bytes32 s)',
  'event PlanPaid(bytes32 indexed paymentIntentId,address indexed payer,uint8 indexed planId,address token,uint256 amount,uint64 paidUntil)',
];
export const plansInterface = new Interface(PLANS_ABI);
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
  contract?: string;
  previousPlan?: number;
  previousPaidUntil?: number;
};
export const purchaseIntent = (id: string) => keccak256(toUtf8Bytes(id));
export function contractPurchase(order: SignedPurchase) {
  return {
    intentId: purchaseIntent(order.id),
    payer: order.wallet,
    planId: order.plan === 'plus' ? 1 : 2,
    previousPlan: order.previousPlan ?? 0,
    previousPaidUntil: order.previousPaidUntil ?? 0,
    validAfter: Math.floor(order.createdAt / 1000) - 60,
    validBefore: Math.floor(order.createdAt / 1000) + 900,
  };
}
export function purchaseAuthorization(order: SignedPurchase) {
  const purchase = contractPurchase(order);
  return {
    domain: { name: 'USD Coin', version: '2', chainId: 43113, verifyingContract: order.token },
    message: {
      from: order.wallet,
      to: order.contract || order.treasury,
      value: '0',
      validAfter: Math.floor(order.createdAt / 1000) - 60,
      validBefore: Math.floor(order.createdAt / 1000) + 900,
      nonce: order.contract
        ? keccak256(
            AbiCoder.defaultAbiCoder().encode(
              ['address', 'uint256', 'bytes32', 'address', 'uint8', 'uint8', 'uint64'],
              [
                order.contract,
                43113,
                purchase.intentId,
                purchase.payer,
                purchase.planId,
                purchase.previousPlan,
                purchase.previousPaidUntil,
              ],
            ),
          )
        : keccak256(
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
