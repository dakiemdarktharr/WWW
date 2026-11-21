import { randomUUID } from 'node:crypto';
import {
  JsonRpcProvider,
  Wallet,
  keccak256,
  FetchRequest,
  Contract,
  Signature,
  verifyTypedData,
  TypedDataEncoder,
  getAddress,
  zeroPadValue,
} from 'ethers';
import {
  AUTHORIZATION_ABI,
  AUTHORIZATION_TYPES,
  SPONSORED_PROTOCOL,
  authorizationInterface,
  purchaseAuthorization,
} from '../shared/sponsored-authorization.ts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DomainError, type Store } from './store.ts';
import type { CloudUser } from './cloud-auth.ts';

const CHAIN = 43113;
const PERIOD = 30 * 86400_000;
type Plan = 'plus' | 'max';
type Order = {
  id: string;
  ownerId: string;
  wallet: string;
  plan: Plan;
  createdAt: number;
  status: 'quoted' | 'pending' | 'confirmed' | 'failed';
  commitment?: string;
  raw?: string;
  hash?: string;
  sponsor?: string;
  paidUntil?: number;
  protocol?: string;
  token?: string;
  treasury?: string;
  startBlock?: number;
  scanBlock?: number;
  signature?: string;
  settlementHash?: string;
};
type Lane = { id: string; orderId?: string; holder?: string; until: number };
type Term = { id: string; tier: Plan; paidUntil: number };
export const sponsoredMode = () => process.env.KIVUNO_BILLING_MODE === 'sponsored-demo';

// The raw transaction is persisted before broadcast. A single durable lane serializes
// nonces, including after a restart or an ambiguous RPC response. Lease fencing keeps
// a delayed worker from signing/broadcasting a different transaction after takeover.
export function registerSponsoredBilling(
  app: FastifyInstance,
  store: Store,
  currentUser: (request: FastifyRequest) => Promise<CloudUser | null>,
) {
  const demo = sponsoredMode();
  const request = new FetchRequest(
    process.env.KIVUNO_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
  );
  request.timeout = 10_000;
  const provider = new JsonRpcProvider(request, CHAIN, { staticNetwork: true, cacheTimeout: -1 });
  const key = process.env.KIVUNO_FUJI_RECEIPT_KEY;
  const signer = key ? new Wallet(key, provider) : null;
  const token = process.env.KIVUNO_FUJI_USDC_ADDRESS
    ? getAddress(process.env.KIVUNO_FUJI_USDC_ADDRESS)
    : null;
  const treasury = process.env.KIVUNO_FUJI_TREASURY_ADDRESS
    ? getAddress(process.env.KIVUNO_FUJI_TREASURY_ADDRESS)
    : null;
  const authorization = (order: Order) =>
    purchaseAuthorization({ ...order, token: order.token!, treasury: order.treasury! });
  app.addHook('onClose', async () => provider.destroy());
  const laneId = signer?.address || 'unconfigured';
  const publicOrder = (order: Order) => ({
    id: order.id,
    plan: order.plan,
    wallet: order.wallet,
    status: order.status,
    actualUsdc: 0,
    simulatedUsdc: order.plan === 'plus' ? 2 : 6,
    chainId: CHAIN,
    txHash: order.settlementHash || order.hash || null,
    commitment: order.commitment || null,
    sponsor: order.sponsor || null,
    createdAt: order.createdAt,
    paidUntil: order.paidUntil ? new Date(order.paidUntil).toISOString() : null,
    protocol: order.protocol || 'legacy-receipt-v1',
    token: order.token || null,
    treasury: order.treasury || null,
    authorization: order.protocol === SPONSORED_PROTOCOL ? authorization(order) : null,
  });
  const userFor = async (req: FastifyRequest) => {
    const user = await currentUser(req);
    if (!user) throw new DomainError('Đăng nhập để tiếp tục.', 401);
    if (!demo) throw new DomainError('Thanh toán mô phỏng chưa được bật.', 503);
    return user;
  };
  const ownOrder = (id: string, ownerId: string) => {
    const order = store.lookup<Order>('sponsoredOrder', id);
    if (!order || order.ownerId !== ownerId)
      throw new DomainError('Không tìm thấy biên nhận.', 404);
    return order;
  };
  const ready = async () => {
    if (!signer || !token || !treasury) return false;
    try {
      return (
        BigInt(await provider.send('eth_chainId', [])) === BigInt(CHAIN) &&
        (await new Contract(token, AUTHORIZATION_ABI, provider).DOMAIN_SEPARATOR()) ===
          TypedDataEncoder.hashDomain({
            name: 'USD Coin',
            version: '2',
            chainId: CHAIN,
            verifyingContract: token,
          }) &&
        (await provider.getBalance(signer.address)) >= 2_000_000_000_000_000n
      );
    } catch {
      return false;
    }
  };
  app.get('/api/billing/demo/config', async (req) => {
    await userFor(req);
    return {
      available: await ready(),
      sponsor: signer?.address || null,
      actualUsdc: 0,
      chainId: CHAIN,
      token,
      treasury,
      protocol: SPONSORED_PROTOCOL,
    };
  });
  app.post('/api/billing/demo/order', async (req) => {
    const user = await userFor(req);
    const { plan } = z
      .object({ plan: z.enum(['plus', 'max']) })
      .strict()
      .parse(req.body);
    const binding = store.lookup<{ id: string; address: string }>('billingWallet', user.id);
    if (!binding)
      throw new DomainError('Ví tài khoản chưa sẵn sàng. Đăng nhập lại để tạo ví.', 409);
    if (!token || !treasury) throw new DomainError('Chưa cấu hình ví nhận và USDC Fuji.', 503);
    const startBlock = await provider.getBlockNumber();
    return store.transaction(() => {
      const orders = store.all<Order>('sponsoredOrder').filter((o) => o.ownerId === user.id);
      // Returning the open order makes double clicks and multiple tabs idempotent.
      const pending = orders.find((o) => o.status === 'pending');
      const quote = orders.find(
        (o) =>
          o.status === 'quoted' &&
          o.protocol === SPONSORED_PROTOCOL &&
          o.token === token &&
          o.treasury === treasury &&
          o.plan === plan &&
          o.wallet === binding.address &&
          Date.now() - o.createdAt < 900_000,
      );
      if (pending || quote) return publicOrder((pending || quote)!);
      if (orders.filter((o) => Date.now() - o.createdAt < 86400_000).length >= 10)
        throw new DomainError('Bạn đã đạt giới hạn 10 đơn demo hôm nay. Thử lại ngày mai.', 429);
      return publicOrder(
        store.put<Order>('sponsoredOrder', {
          id: randomUUID(),
          ownerId: user.id,
          wallet: binding.address,
          plan,
          createdAt: Date.now(),
          status: 'quoted',
          protocol: SPONSORED_PROTOCOL,
          token,
          treasury,
          startBlock,
        }),
      );
    });
  });
  async function settle(order: Order) {
    if (!order.hash || !order.raw || !signer) return false;
    let receipt = await provider.getTransactionReceipt(order.hash);
    if (!receipt) {
      if (!(await provider.getTransaction(order.hash))) {
        try {
          await provider.broadcastTransaction(order.raw);
        } catch {
          /* Same bytes may already be accepted. */
        }
      }
      receipt = await provider.getTransactionReceipt(order.hash);
    }
    if (!receipt) return false;
    let tx = await provider.getTransaction(order.hash);
    const signed = order.protocol === SPONSORED_PROTOCOL;
    // Another relayer can submit an EIP-3009 authorization first. Reconcile the
    // exact token event/nonce instead of losing a valid purchase to front-running.
    const matches = (candidate: typeof receipt) => {
      if (!candidate || candidate.status !== 1) return false;
      const events = candidate.logs
        .filter((l) => l.address.toLowerCase() === order.token!.toLowerCase())
        .flatMap((l) => {
          try {
            const e = authorizationInterface.parseLog(l);
            return e ? [e] : [];
          } catch {
            return [];
          }
        });
      return (
        events.some(
          (e) =>
            e.name === 'AuthorizationUsed' &&
            e.args.authorizer === order.wallet &&
            e.args.nonce === order.commitment,
        ) &&
        events.some(
          (e) =>
            e.name === 'Transfer' &&
            e.args.from === order.wallet &&
            e.args.to === order.treasury &&
            e.args.value === 0n,
        )
      );
    };
    if (signed && receipt.status === 0) {
      const end = await provider.getBlockNumber();
      let from = order.scanBlock ?? order.startBlock!;
      for (let i = 0; i < 3 && from <= end; i++) {
        const to = Math.min(from + 2047, end);
        const logs = await provider.getLogs({
          address: order.token,
          topics: [
            authorizationInterface.getEvent('AuthorizationUsed')!.topicHash,
            zeroPadValue(order.wallet, 32),
            order.commitment!,
          ],
          fromBlock: from,
          toBlock: to,
        });
        for (const log of logs) {
          const found = await provider.getTransactionReceipt(log.transactionHash);
          if (matches(found)) {
            receipt = found!;
            tx = await provider.getTransaction(log.transactionHash);
            break;
          }
        }
        if (receipt.status === 1) break;
        from = to + 1;
        store.put('sponsoredOrder', {
          ...store.get<Order>('sponsoredOrder', order.id),
          scanBlock: from,
        });
      }
      // Scan only up to the reverted relay's block: any earlier successful use
      // must be there. Do not permanently fail while an old range is unscanned.
      if (receipt.status === 0 && from <= receipt.blockNumber) return false;
    }
    if (
      !signed &&
      (!tx ||
        Number(tx.chainId) !== CHAIN ||
        tx.from !== order.sponsor ||
        tx.to !== order.sponsor ||
        tx.value !== 0n ||
        tx.data !== order.commitment)
    )
      throw new DomainError('Biên nhận Fuji không khớp. Chưa cấp quyền sử dụng.', 409);
    if (
      signed &&
      receipt.status === 1 &&
      (!matches(receipt) || !tx || Number(tx.chainId) !== CHAIN)
    )
      throw new DomainError(
        'USDC chưa xác nhận đúng chữ ký, ví nhận và số tiền 0. Chưa cấp gói.',
        409,
      );
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block) return false;
    store.transaction(() => {
      const latest = store.get<Order>('sponsoredOrder', order.id);
      if (latest.status === 'confirmed' || latest.status === 'failed') return;
      if (receipt!.status !== 1) {
        store.put('sponsoredOrder', { ...latest, status: 'failed' });
        return;
      }
      const previous = store.lookup<Term>('billingEntitlement', order.ownerId);
      const paidAt = block.timestamp * 1000;
      const paidUntil =
        (previous?.tier === order.plan ? Math.max(paidAt, previous.paidUntil) : paidAt) + PERIOD;
      store.put('billingEntitlement', {
        id: order.ownerId,
        ownerId: order.ownerId,
        tier: order.plan,
        paidUntil,
        syncedBlock: receipt!.blockNumber,
        updatedAt: new Date(paidAt).toISOString(),
      });
      store.put('sponsoredOrder', {
        ...latest,
        status: 'confirmed',
        paidUntil,
        settlementHash: receipt!.hash,
      });
    });
    return true;
  }
  async function processOrder(id: string, ownerId: string, confirm: boolean, signature?: string) {
    let order = ownOrder(id, ownerId);
    if (
      order.status === 'confirmed' ||
      order.status === 'failed' ||
      (!confirm && order.status === 'quoted')
    )
      return publicOrder(order);
    if (!signer) throw new DomainError('Ví dự án chưa sẵn sàng. Bạn không cần nạp tiền.', 503);
    if (order.status === 'quoted' && confirm) {
      if (order.protocol !== SPONSORED_PROTOCOL)
        throw new DomainError('Đơn cũ cần tạo lại để ví của bạn ký. Quay lại danh sách gói.', 409);
      if (!signature) throw new DomainError('Cần chữ ký từ ví riêng của tài khoản.', 400);
      const auth = authorization(order);
      let recovered = '';
      try {
        recovered = verifyTypedData(auth.domain, AUTHORIZATION_TYPES, auth.message, signature);
      } catch {
        /* Reject below. */
      }
      if (recovered !== order.wallet)
        throw new DomainError('Chữ ký không khớp ví tài khoản hoặc nội dung mua gói.', 403);
    }
    const holder = randomUUID();
    const activeLaneId = order.sponsor || laneId;
    const locked = store.transaction(() => {
      const lane = store.lookup<Lane>('sponsoredLane', activeLaneId);
      if (lane?.holder && lane.until > Date.now()) return false;
      store.put<Lane>('sponsoredLane', {
        ...lane,
        id: activeLaneId,
        holder,
        until: Date.now() + 120_000,
      });
      return true;
    });
    if (!locked)
      throw new DomainError('Dự án đang ghi biên nhận khác. Thử kiểm tra lại sau vài giây.', 409);
    const fence = () => {
      const lane = store.get<Lane>('sponsoredLane', activeLaneId);
      if (lane.holder !== holder || lane.until <= Date.now())
        throw new DomainError('Hãy kiểm tra lại biên nhận.', 409);
      return lane;
    };
    try {
      if (BigInt(await provider.send('eth_chainId', [])) !== BigInt(CHAIN))
        throw new DomainError('Mạng Fuji chưa sẵn sàng.', 503);
      const lane = fence();
      if (lane.orderId) {
        if (!(await settle(store.get<Order>('sponsoredOrder', lane.orderId)))) {
          if (lane.orderId === id) return publicOrder(ownOrder(id, ownerId));
          throw new DomainError('Biên nhận trước đang chờ Fuji xác nhận. Thử lại sau.', 409);
        }
        store.transaction(() => store.put('sponsoredLane', { ...fence(), orderId: undefined }));
      }
      order = ownOrder(id, ownerId);
      if (order.status !== 'quoted') return publicOrder(order);
      if (!confirm) return publicOrder(order);
      if (Date.now() - order.createdAt >= 900_000)
        throw new DomainError('Đơn đã hết hạn. Quay lại chọn gói để tạo đơn mới.', 409);
      if (store.lookup<{ address: string }>('billingWallet', ownerId)?.address !== order.wallet)
        throw new DomainError('Ví tài khoản đã thay đổi. Hãy tạo đơn mới.', 409);
      if (
        store
          .all<Order>('sponsoredOrder')
          .filter((o) => o.hash && Date.now() - o.createdAt < 86400_000).length >= 200
      )
        throw new DomainError(
          'Dự án đã dùng hết lượt ghi biên nhận demo hôm nay. Thử lại ngày mai.',
          429,
        );
      if (order.token !== token || order.treasury !== treasury)
        throw new DomainError('Cấu hình ví nhận đã thay đổi. Hãy tạo đơn mới.', 409);
      const auth = authorization(order);
      if (
        (await new Contract(order.token!, AUTHORIZATION_ABI, provider).DOMAIN_SEPARATOR()) !==
        TypedDataEncoder.hashDomain(auth.domain)
      )
        throw new DomainError('Hợp đồng USDC không khớp miền chữ ký.', 503);
      const commitment = auth.message.nonce;
      const sig = Signature.from(signature!);
      const data = authorizationInterface.encodeFunctionData('transferWithAuthorization', [
        order.wallet,
        order.treasury,
        0,
        auth.message.validAfter,
        auth.message.validBefore,
        commitment,
        sig.v,
        sig.r,
        sig.s,
      ]);
      const gasPrice = (await provider.getFeeData()).gasPrice;
      const gasLimit = 150_000n;
      if (
        !gasPrice ||
        gasPrice * gasLimit > 2_000_000_000_000_000n ||
        (await provider.getBalance(signer.address)) < gasPrice * gasLimit
      )
        throw new DomainError(
          'Ví dự án chưa đủ gas hoặc mạng đang bận. Bạn không cần nạp tiền.',
          503,
        );
      const raw = await signer.signTransaction({
        chainId: CHAIN,
        to: order.token,
        value: 0n,
        data,
        nonce: await provider.getTransactionCount(signer.address, 'pending'),
        gasLimit,
        gasPrice,
        type: 0,
      });
      store.transaction(() => {
        const currentLane = fence();
        const latest = ownOrder(id, ownerId);
        if (latest.status !== 'quoted')
          throw new DomainError('Đơn đã thay đổi. Hãy kiểm tra lại.', 409);
        order = store.put('sponsoredOrder', {
          ...latest,
          status: 'pending',
          commitment,
          raw,
          hash: keccak256(raw),
          sponsor: signer.address,
          signature,
        });
        store.put('sponsoredLane', { ...currentLane, orderId: id });
      });
      fence();
      await settle(order);
      return publicOrder(ownOrder(id, ownerId));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'Fuji tạm thời chưa phản hồi. Kiểm tra lại đơn để tiếp tục; bạn không cần nạp tiền.',
        503,
      );
    } finally {
      store.transaction(() => {
        const lane = store.lookup<Lane>('sponsoredLane', activeLaneId);
        if (lane?.holder === holder)
          store.put('sponsoredLane', { ...lane, holder: undefined, until: 0 });
      });
    }
  }
  app.post('/api/billing/demo/confirm', async (req) => {
    const user = await userFor(req);
    const { id, signature } = z
      .object({
        id: z.string().uuid(),
        signature: z
          .string()
          .regex(/^0x[\da-fA-F]{130}$/)
          .optional(),
      })
      .strict()
      .parse(req.body);
    return processOrder(id, user.id, true, signature);
  });
  app.get('/api/billing/demo/status', async (req) => {
    const user = await userFor(req);
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(req.query);
    return processOrder(id, user.id, false);
  });
}
