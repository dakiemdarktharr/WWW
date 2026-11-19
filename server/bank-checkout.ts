import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CloudUser } from './cloud-auth.ts';
import { DomainError, type Store } from './store.ts';

const PERIOD = 30 * 86400_000;
const QUOTE_VALID_FOR = 15 * 60_000;
const PRICES = { plus: 2, max: 6 } as const;
// Intentionally non-routable identifiers. No real bank can execute this transfer.
const RECIPIENT = {
  bankBin: 'DEMO',
  bankName: 'Ngân hàng mô phỏng Kivuno',
  accountNumber: 'DEMO-KIVUNO',
  accountName: 'KIVUNO DEMO',
} as const;
type Plan = keyof typeof PRICES;
type Order = {
  id: string;
  ownerId: string;
  plan: Plan;
  amountVnd: number;
  rateVndPerUsdc: number;
  reference: string;
  createdAt: number;
  expiresAt: number;
  paidUntil?: number;
};
type Credit = {
  id: string;
  ownerId: string;
  accountNumber: string;
  reference: string;
  amountVnd: number;
  creditedAt: number;
};
type BankTerm = { id: string; tier: Plan; paidUntil: number; latestPaidAt: number };
type Inbox = { id: string; orderIds: string[] };

export function bankCheckoutMode(store: Store): 'sandbox' | null {
  const env = process.env;
  const dataDir = env.RELAY_DATA_DIR;
  if (
    env.RELAY_LOCAL_CLOUD_DEMO !== '1' ||
    env.NODE_ENV !== 'development' ||
    env.RELAY_DEPLOYMENT !== 'cloud' ||
    env.RELAY_PUBLIC_ORIGIN !== 'http://127.0.0.1:5173' ||
    env.RELAY_PORT !== '4317' ||
    !dataDir ||
    !path.isAbsolute(dataDir) ||
    path.basename(dataDir) !== '.relay-fuji-demo'
  )
    return null;
  const dbPath = store.db.location();
  return dbPath && path.relative(path.join(dataDir, 'workspace.db'), dbPath) === ''
    ? 'sandbox'
    : null;
}

export function bankEntitlement(store: Store, userId: string): BankTerm | undefined {
  if (bankCheckoutMode(store) === null) return undefined;
  return store.lookup<BankTerm>('bankEntitlement', userId);
}

function demoRate() {
  const raw = process.env.KIVUNO_BANK_VND_PER_USDC ?? '26100';
  if (!/^[1-9]\d{0,6}(\.\d{1,4})?$/.test(raw))
    throw new DomainError('Tỷ lệ minh họa VND/USDC không hợp lệ.', 503);
  return Number(raw);
}

function publicOrder(order: Order) {
  return {
    id: order.id,
    mode: 'sandbox' as const,
    plan: order.plan,
    amountUsdc: PRICES[order.plan],
    amountVnd: order.amountVnd,
    rateVndPerUsdc: order.rateVndPerUsdc,
    rateAsOf: new Date(order.createdAt).toISOString(),
    expiresAt: new Date(order.expiresAt).toISOString(),
    ...RECIPIENT,
    reference: order.reference,
    status:
      order.paidUntil !== undefined
        ? 'paid'
        : Date.now() >= order.expiresAt
          ? 'expired'
          : 'pending',
    ...(order.paidUntil === undefined
      ? {}
      : { paidUntil: new Date(order.paidUntil).toISOString() }),
  };
}

function ownOrder(store: Store, userId: string, id: string) {
  const order = store.lookup<Order>('bankOrder', id);
  if (!order || order.ownerId !== userId)
    throw new DomainError('Không tìm thấy đơn chuyển khoản.', 404);
  return order;
}

function matches(credit: Credit, order: Order) {
  return (
    credit.id === order.id &&
    credit.ownerId === order.ownerId &&
    credit.amountVnd === order.amountVnd &&
    credit.reference === order.reference &&
    credit.accountNumber === RECIPIENT.accountNumber &&
    credit.creditedAt >= order.createdAt &&
    credit.creditedAt < order.expiresAt
  );
}

// The simulated bank commits its credit first. If checkout is interrupted between writes,
// the next status request replays this buyer's inbox in bank posting order.
function reconcile(store: Store, ownerId: string) {
  store.transaction(() => {
    const inbox = store.lookup<Inbox>('bankCreditInbox', ownerId);
    if (!inbox) return;
    for (const id of inbox.orderIds) {
      const order = ownOrder(store, ownerId, id);
      if (order.paidUntil !== undefined) continue;
      const credit = store.get<Credit>('bankSimulatedCredit', id);
      if (!matches(credit, order))
        throw new DomainError('Giao dịch mô phỏng không khớp với đơn.', 409);
      const previous = store.lookup<BankTerm>('bankEntitlement', ownerId);
      const start =
        previous?.tier === order.plan
          ? Math.max(credit.creditedAt, previous.paidUntil)
          : credit.creditedAt;
      const paidUntil = start + PERIOD;
      store.put('bankOrder', { ...order, paidUntil });
      store.put('bankEntitlement', {
        id: ownerId,
        tier: order.plan,
        paidUntil,
        latestPaidAt: credit.creditedAt,
      } satisfies BankTerm);
      store.put('bankFujiCandidate', {
        id,
        ownerId,
        plan: order.plan,
        amountVnd: order.amountVnd,
        paidUntil,
        paidAt: credit.creditedAt,
        nonce: '0x' + randomBytes(32).toString('hex'),
      });
    }
    store.remove('bankCreditInbox', ownerId);
  });
}

const orderRequest = z.object({ plan: z.enum(['plus', 'max']) }).strict();
const lookupRequest = z.object({ id: z.uuid() }).strict();
const paymentRequest = lookupRequest
  .extend({
    accountNumber: z.string().max(40),
    amountVnd: z.number().int().positive().safe(),
    reference: z.string().max(80),
  })
  .strict();

export function registerBankCheckout(
  app: FastifyInstance,
  store: Store,
  currentUser: (request: FastifyRequest) => Promise<CloudUser | null>,
) {
  async function buyer(request: FastifyRequest) {
    if (bankCheckoutMode(store) !== 'sandbox')
      throw new DomainError('Demo ngân hàng cục bộ chưa bật.', 404);
    const user = await currentUser(request);
    if (!user) throw new DomainError('Đăng nhập Kivuno để xem đơn của bạn.', 401);
    return user.id;
  }
  app.get('/api/billing/bank/config', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const mode = bankCheckoutMode(store);
    const rate = mode ? demoRate() : null;
    return {
      mode: 'sandbox',
      available: Boolean(mode),
      plusVnd: rate === null ? null : Math.round(rate * PRICES.plus),
      maxVnd: rate === null ? null : Math.round(rate * PRICES.max),
    };
  });
  app.post('/api/billing/bank/order', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const ownerId = await buyer(request);
    const { plan } = orderRequest.parse(request.body);
    reconcile(store, ownerId);
    return store.transaction(() => {
      const pointer = ownerId + ':' + plan;
      const latest = store.lookup<{ orderId: string }>('bankCheckoutLatest', pointer);
      const current = latest && ownOrder(store, ownerId, latest.orderId);
      const now = Date.now();
      if (current && current.paidUntil === undefined && current.expiresAt > now)
        return publicOrder(current);
      const rate = demoRate();
      const order: Order = {
        id: randomUUID(),
        ownerId,
        plan,
        rateVndPerUsdc: rate,
        amountVnd: Math.round(PRICES[plan] * rate),
        reference: 'KV' + randomBytes(8).toString('hex').toUpperCase(),
        createdAt: now,
        expiresAt: now + QUOTE_VALID_FOR,
      };
      store.put('bankOrder', order);
      store.put('bankCheckoutLatest', { id: pointer, orderId: order.id });
      return publicOrder(order);
    });
  });
  app.post('/api/billing/bank/status', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const ownerId = await buyer(request);
    const { id } = lookupRequest.parse(request.body);
    ownOrder(store, ownerId, id);
    reconcile(store, ownerId);
    return publicOrder(ownOrder(store, ownerId, id));
  });
  app.post('/api/billing/bank/simulate', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const ownerId = await buyer(request);
    const { id, amountVnd, reference, accountNumber } = paymentRequest.parse(request.body);
    store.transaction(() => {
      const order = ownOrder(store, ownerId, id);
      if (
        accountNumber !== RECIPIENT.accountNumber ||
        amountVnd !== order.amountVnd ||
        reference !== order.reference
      )
        throw new DomainError(
          'Kiểm tra lại tài khoản mô phỏng, số tiền và nội dung chuyển khoản.',
          400,
        );
      if (store.lookup('bankSimulatedCredit', id)) return;
      const creditedAt = Date.now();
      if (creditedAt < order.createdAt || creditedAt >= order.expiresAt)
        throw new DomainError('Đơn chuyển khoản đã hết hiệu lực.', 409);
      const credit: Credit = { id, ownerId, creditedAt, reference, amountVnd, accountNumber };
      store.put('bankSimulatedCredit', credit);
      const inbox = store.lookup<Inbox>('bankCreditInbox', ownerId);
      store.put('bankCreditInbox', { id: ownerId, orderIds: [...(inbox?.orderIds ?? []), id] });
    });
    reconcile(store, ownerId);
    return publicOrder(ownOrder(store, ownerId, id));
  });
}
