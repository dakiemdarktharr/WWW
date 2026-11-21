import { useEffect, useState } from 'react';
import { api } from './api';
import { backupWallet } from './embedded-wallet';

type Receipt = {
  id: string;
  plan: 'plus' | 'max';
  status: 'quoted' | 'pending' | 'confirmed' | 'failed';
  actualUsdc: number;
  simulatedUsdc: number;
  txHash: string | null;
  paidUntil: string | null;
};
export function SponsoredCheckout({
  account,
  wallet,
  plan,
  refresh,
}: {
  account: string;
  wallet: string | null;
  plan: 'plus' | 'max';
  refresh: () => Promise<unknown>;
}) {
  const [order, setOrder] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(true);
  const storageKey = 'kivuno:sponsored:' + account;
  useEffect(() => {
    let active = true;
    const restore = async () => {
      const id = localStorage.getItem(storageKey);
      if (!id) return;
      const restored = await api<Receipt>('/billing/demo/status?id=' + encodeURIComponent(id));
      if (active) {
        if (restored.status !== 'pending' && restored.plan !== plan) {
          localStorage.removeItem(storageKey);
          return;
        }
        setOrder(restored);
        if (restored.status === 'confirmed') await refresh();
      }
    };
    void restore()
      .catch(() => {
        if (active)
          setError('Chưa tải được biên nhận trước. Bấm xác nhận để tiếp tục đơn của tài khoản.');
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [storageKey, refresh, plan]);
  useEffect(() => {
    if (order?.status !== 'pending') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const check = async () => {
      try {
        const receipt = await api<Receipt>(
          '/billing/demo/status?id=' + encodeURIComponent(order.id),
        );
        if (!active) return;
        setOrder(receipt);
        if (receipt.status === 'confirmed') await refresh();
        if (receipt.status !== 'pending') return;
      } catch {
        /* Manual retry remains available. */
      }
      if (active && ++attempts < 15) timer = setTimeout(check, 4000);
    };
    timer = setTimeout(check, 4000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [order?.id, order?.status, refresh]);
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const quote = order || (await api<Receipt>('/billing/demo/order', { plan }));
      setOrder(quote);
      // Persistence is optional: the server also deduplicates open orders per account.
      try {
        localStorage.setItem(storageKey, quote.id);
      } catch {
        /* Private browsing. */
      }
      const result =
        quote.status === 'pending'
          ? await api<Receipt>('/billing/demo/status?id=' + encodeURIComponent(quote.id))
          : await api<Receipt>('/billing/demo/confirm', { id: quote.id });
      setOrder(result);
      if (result.status === 'confirmed') await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const confirmed = order?.status === 'confirmed';
  const pending = order?.status === 'pending';
  return (
    <section aria-label="Thanh toán demo miễn phí">
      <a
        className="billing-switch"
        href="/billing"
        onClick={() => {
          if (order?.status === 'confirmed' || order?.status === 'failed') {
            try {
              localStorage.removeItem(storageKey);
            } catch {
              /* No storage. */
            }
          }
        }}
      >
        Quay lại danh sách gói
      </a>
      <h2 tabIndex={-1}>
        {confirmed
          ? 'Đã ghi biên nhận Fuji'
          : 'Xác nhận gói ' + ((order?.plan || plan) === 'plus' ? 'Plus' : 'Max')}
      </h2>
      <p>
        Demo cuộc thi · Không thu tiền. Gói có hiệu lực 30 ngày sau khi Fuji xác nhận biên nhận.
      </p>
      <div className="billing-wallet-box">
        <p>
          Giá mô phỏng:{' '}
          <strong>{order?.simulatedUsdc ?? (plan === 'plus' ? 2 : 6)} USDC / 30 ngày</strong>
        </p>
        <h3>Thực trả: 0 USDC</h3>
        <p>Phí mạng do Kivuno trả. Bạn không cần nạp USDC hoặc AVAX.</p>
      </div>
      <details className="billing-wallet-box">
        <summary>Ví riêng của tài khoản</summary>
        <p>Ví được tạo khi đăng ký hoặc đăng nhập, dùng để gắn biên nhận với tài khoản của bạn.</p>
        <code className="billing-wallet-address">
          {wallet || 'Ví tài khoản chưa sẵn sàng. Hãy đăng nhập lại.'}
        </code>
        <p>
          Khóa ví được mã hóa trên trình duyệt tạo ví. Bạn có thể tải bản sao lưu tại trình duyệt
          đó.
        </p>
        {wallet && (
          <button
            className="billing-secondary"
            disabled={busy}
            onClick={() => void backupWallet(account, wallet).catch((e) => setError(e.message))}
          >
            Tải bản sao lưu mã hóa
          </button>
        )}
      </details>
      {error && (
        <p role="alert" className="billing-alert">
          {error}
        </p>
      )}
      {pending && (
        <p role="status">
          Biên nhận đã gửi, đang chờ Fuji xác nhận. Kiểm tra lại để đồng bộ gói; thao tác này không
          tạo giao dịch mới.
        </p>
      )}
      {confirmed && (
        <p role="status" className="billing-notice">
          Gói đã được cập nhật. Hết hạn {new Date(order.paidUntil!).toLocaleString('vi-VN')}.
        </p>
      )}
      {order?.txHash && (
        <p>
          <a
            href={'https://testnet.snowtrace.io/tx/' + order.txHash}
            target="_blank"
            rel="noreferrer"
          >
            Xem giao dịch thật trên Fuji ↗
          </a>
        </p>
      )}
      {order?.status === 'failed' && (
        <p role="alert">Giao dịch thất bại. Chưa cấp gói. Quay lại danh sách gói để thử đơn mới.</p>
      )}
      {!confirmed && order?.status !== 'failed' && (
        <button
          className="billing-primary"
          disabled={busy || restoring || !wallet}
          onClick={() => void confirm()}
        >
          {busy || restoring ? 'Đang xử lý…' : pending ? 'Kiểm tra biên nhận' : 'Xác nhận · 0 USDC'}
        </button>
      )}
      {(confirmed || order?.status === 'failed') && (
        <button
          className="billing-secondary"
          onClick={() => {
            try {
              localStorage.removeItem(storageKey);
            } catch {
              /* No storage. */
            }
            setOrder(null);
            window.location.assign('/billing');
          }}
        >
          Về danh sách gói
        </button>
      )}
      <p>
        Không tự gia hạn. Gia hạn cùng gói nối thêm 30 ngày; đổi gói bắt đầu kỳ mới ngay. Giá 2 và 6
        USDC chỉ để minh họa.
      </p>
    </section>
  );
}
