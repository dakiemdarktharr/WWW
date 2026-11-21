import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import qrCode from 'qrcode-generator';
import { api } from './api';

type Plan = 'plus' | 'max';
type Quote =
  | { available: true; plusVnd: number; maxVnd: number }
  | { available: false; plusVnd: null; maxVnd: null };
type Order = {
  id: string;
  plan: Plan;
  amountVnd: number;
  amountUsdc: number;
  rateVndPerUsdc: number;
  expiresAt: string;
  paidUntil?: string;
  status: 'pending' | 'paid' | 'expired';
  bankName: string;
  accountName: string;
  accountNumber: string;
  reference: string;
};
type Proof = {
  txHash: string;
  commitment: string;
  verified: boolean;
  chainId: number;
  blockNumber: number;
};
const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format;
const planName = (plan: Plan) => (plan === 'plus' ? 'Plus' : 'Max');
function getOrder(id: string) {
  return api<Order>('/billing/bank/status', { id });
}
function bankUrl(id: string) {
  const url = new URL('/billing', location.origin);
  url.searchParams.set('bank', id);
  return url.href;
}
function qrImage(id: string) {
  const code = qrCode(0, 'M');
  code.addData(bankUrl(id));
  code.make();
  return code.createDataURL(5, 20);
}
function Details({ order }: { order: Order }) {
  return (
    <dl className="billing-review-details">
      <div>
        <dt>Ngân hàng</dt>
        <dd>{order.bankName}</dd>
      </div>
      <div>
        <dt>Chủ tài khoản</dt>
        <dd>{order.accountName}</dd>
      </div>
      <div>
        <dt>Số tài khoản thử</dt>
        <dd>
          <code>{order.accountNumber}</code>
        </dd>
      </div>
      <div>
        <dt>Nội dung chuyển khoản</dt>
        <dd>
          <code>{order.reference}</code>
        </dd>
      </div>
      <div>
        <dt>Số tiền</dt>
        <dd>{money(order.amountVnd)}</dd>
      </div>
    </dl>
  );
}
function BankForm({ order, done }: { order: Order; done: (paidOrder: Order) => void }) {
  const [recipient, setRecipient] = useState(order.accountNumber);
  const [amount, setAmount] = useState(String(order.amountVnd));
  const [reference, setReference] = useState(order.reference);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      done(
        await api<Order>('/billing/bank/simulate', {
          id: order.id,
          accountNumber: recipient,
          amountVnd: Number(amount),
          reference,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="billing-auth" onSubmit={submit}>
      <h3>Ngân hàng mô phỏng</h3>
      <p>Chuyển thử cho {order.accountName}. Thao tác này chỉ ghi vào sổ giao dịch cục bộ.</p>
      <label className="billing-field">
        Tài khoản nhận
        <input required value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      </label>
      <label className="billing-field">
        Số tiền (VND)
        <input
          required
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label className="billing-field">
        Nội dung chuyển khoản
        <input required value={reference} onChange={(e) => setReference(e.target.value)} />
      </label>
      {error && (
        <p className="billing-alert" role="alert">
          {error}
        </p>
      )}
      <button className="billing-primary" disabled={busy} type="submit">
        Xác nhận chuyển thử
      </button>
    </form>
  );
}
export function BankCheckout({
  selectedPlan,
  onPaid,
}: {
  selectedPlan: Plan;
  onPaid: () => Promise<unknown>;
}) {
  const query = new URLSearchParams(location.search);
  const bankId = query.get('bank');
  const receiptId = query.get('receipt');
  const [config, setConfig] = useState<Quote | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [fujiHash, setFujiHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const orderId = order?.id;
  const quotedPlan = order?.plan ?? selectedPlan;
  const image = useMemo(() => (orderId && !bankId ? qrImage(orderId) : ''), [orderId, bankId]);
  const update = useCallback(
    (updatedOrder: Order) => {
      setOrder(updatedOrder);
      if (updatedOrder.status === 'paid') void onPaid().catch((e) => setError(e.message));
    },
    [onPaid],
  );
  useEffect(() => {
    let alive = true;
    (async () => {
      const settings = await api<Quote>('/billing/bank/config');
      if (!alive) return;
      const initialOrderId = bankId || receiptId;
      try {
        if (settings.available && initialOrderId) {
          const initialOrder = await getOrder(initialOrderId);
          if (alive) update(initialOrder);
        }
      } finally {
        if (alive) setConfig(settings);
      }
    })().catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [update, bankId, receiptId]);
  useEffect(() => {
    if (!orderId || order?.status !== 'pending') return;
    let alive = true,
      inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const updatedOrder = await getOrder(orderId);
        if (alive) update(updatedOrder);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        inFlight = false;
      }
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [orderId, order?.status, update]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function choose(plan: Plan) {
    const updatedOrder = await api<Order>('/billing/bank/order', { plan });
    setProof(null);
    setFujiHash('');
    update(updatedOrder);
    history.replaceState(null, '', '/billing?receipt=' + encodeURIComponent(updatedOrder.id));
  }
  return (
    <section className="bank-checkout">
      {error && (
        <p className="billing-alert" role="alert">
          {error}
        </p>
      )}
      {bankId && error && !order && (
        <a className="billing-switch" href="/billing">
          Trở về Kivuno
        </a>
      )}
      {!config && !error && <p role="status">Đang tải giá gói…</p>}
      {config && !config.available && (
        <p className="billing-alert">Chuyển khoản mô phỏng chỉ mở trong bản demo cục bộ.</p>
      )}
      {config?.available && !bankId && (!order || order.status === 'expired') && (
        <div className="bank-plan-list" role="group" aria-label="Chọn gói">
          <button
            type="button"
            className="billing-secondary bank-plan"
            aria-label={'Tạo mã QR cho gói ' + planName(quotedPlan)}
            disabled={busy}
            onClick={() => void run(() => choose(quotedPlan))}
          >
            <strong>Tạo mã QR cho gói {planName(quotedPlan)}</strong>
            <span>{quotedPlan === 'plus' ? 2 : 6} test USDC / 30 ngày</span>
            <small>{money(quotedPlan === 'plus' ? config.plusVnd : config.maxVnd)} mô phỏng</small>
          </button>
        </div>
      )}
      {order && (
        <section className="billing-review">
          {order.status === 'pending' &&
            (bankId ? (
              <BankForm key={order.id} order={order} done={update} />
            ) : (
              <>
                <h3>Chuyển khoản thử cho gói {planName(order.plan)}</h3>
                <strong className="bank-total">{money(order.amountVnd)}</strong>
                {image && (
                  <img
                    className="bank-qr"
                    src={image}
                    alt="Mã QR mở ngân hàng mô phỏng cho đơn này"
                  />
                )}
                <p>
                  QR mở bản mô phỏng trên máy chạy Kivuno. Bạn có thể mở trực tiếp bằng nút bên
                  dưới.
                </p>
                <a className="billing-primary" href={bankUrl(order.id)}>
                  Mở ngân hàng mô phỏng
                </a>
                <Details order={order} />
                <p>
                  Đơn dùng mức minh họa {money(order.rateVndPerUsdc)} / USDC. Hiệu lực đến{' '}
                  {new Date(order.expiresAt).toLocaleTimeString('vi-VN')}.
                </p>
              </>
            ))}
          {order.status === 'expired' && (
            <p role="status">Đơn đã hết hạn. Hãy chọn gói để tạo đơn mới.</p>
          )}
          {order.status === 'paid' && (
            <>
              <h3>Đã ghi nhận chuyển khoản thử</h3>
              <p>
                {planName(order.plan)} · {money(order.amountVnd)} · {order.reference}
              </p>
              {!bankId && (
                <button
                  type="button"
                  className="billing-secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const receipt = await api<Proof>('/billing/bank/proof', { id: order.id });
                      if (!receipt.verified || receipt.chainId !== 31337)
                        throw Error('Chưa xác minh được biên nhận cục bộ.');
                      setProof(receipt);
                      setFujiHash('');
                      try {
                        const response = await fetch('/kivuno-qr-fuji.json', { cache: 'no-store' });
                        if (!response.ok) return;
                        const published = await response.json();
                        const grant = published.grant;
                        const hash = published.transaction?.hash;
                        if (
                          grant?.chainId === 43113 &&
                          grant.localChainId === receipt.chainId &&
                          grant.localTxHash === receipt.txHash &&
                          grant.localCommitment === receipt.commitment &&
                          grant.plan === order.plan &&
                          grant.paidUntil === order.paidUntil &&
                          /^0x[0-9a-f]{64}$/.test(hash)
                        )
                          setFujiHash(hash);
                      } catch {
                        // A local receipt remains available when the public example cannot be loaded.
                      }
                    })
                  }
                >
                  Kiểm chứng biên nhận
                </button>
              )}
              {proof && (
                <div className="bank-proof" role="status">
                  <strong>Đã kiểm chứng trên EVM cục bộ</strong>
                  <p>
                    Chain {proof.chainId} · Block {proof.blockNumber}
                  </p>
                  <code>{proof.txHash}</code>
                  <p>Mã cam kết</p>
                  <code>{proof.commitment}</code>
                  {fujiHash && (
                    <p>
                      <a
                        href={'https://build.avax.network/explorer/fuji/c-chain/tx/' + fujiHash}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Đối chiếu biên nhận của gói {planName(order.plan)} trên Fuji
                      </a>
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {bankId && (
            <a className="billing-switch" href={'/billing?receipt=' + encodeURIComponent(order.id)}>
              Trở về Kivuno
            </a>
          )}
        </section>
      )}
    </section>
  );
}
