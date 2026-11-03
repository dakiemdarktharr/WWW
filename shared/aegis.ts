export const FUJI_CHAIN_ID = 43113;
export const FUJI_RPC_URL = 'https://api.avax-test.network/ext/bc/C/rpc';
export const FUJI_FAUCET_URL = 'https://core.app/tools/testnet-faucet';
export const FUJI_EXPLORER_URL = 'https://testnet.snowtrace.io';
export interface AegisProjectPolicy {
  id: string;
  projectId: string;
  enabled: boolean;
  transactionHash: string;
  updatedAt: string;
}
export interface AegisGrant {
  id: string;
  projectId: string;
  machineId: string;
  permissions: number;
  expiresAt: number;
  epoch: number;
  transactionHash: string;
}
export interface AegisAction {
  id: string;
  taskId: string;
  projectId: string;
  actionId: string;
  payloadDigest: string;
  sourceDigest: string;
  expiresAt: number;
  status: 'approved' | 'consuming' | 'consumed' | 'uncertain';
  transactionHash: string;
  consumedTransactionHash?: string;
}
export interface AegisReceipt {
  id: string;
  projectId: string;
  handoffId: string;
  digest: string;
  signer: string;
  signature: string;
  contractAddress: string;
  projectKey: string;
  receiptKey: string;
  chainId: 43113;
  status: 'signed' | 'anchoring' | 'anchored' | 'uncertain';
  transactionHash: string | null;
  createdAt: string;
}
export interface AegisReceiptBundle {
  version: 1;
  receipt: AegisReceipt;
  payload: Record<string, unknown>;
}
export interface AegisVerification {
  integrity: boolean;
  signature: boolean;
  anchored: boolean;
  trustedRegistry: boolean;
  signer: string | null;
  error: string | null;
}
export interface AegisStatus {
  chainId: 43113;
  network: 'Avalanche Fuji';
  setup: boolean;
  contractAddress: string | null;
  ownerAddress: string | null;
  executorAddress: string | null;
  balance: string;
  executorBalance: string;
  online: boolean;
  error: string | null;
  faucetUrl: string;
  explorerUrl: string;
  projects: AegisProjectPolicy[];
  grants: AegisGrant[];
  actions: AegisAction[];
  receipts: AegisReceipt[];
}
