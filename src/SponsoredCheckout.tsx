import { useEffect, useState } from 'react';
import { api } from './api';
import { backupWallet, restoreWallet, walletForAccount } from './embedded-wallet';
import {
  AUTHORIZATION_TYPES,
  SPONSORED_PROTOCOL,
  purchaseAuthorization,
} from '../shared/sponsored-authorization';
import { getAddress } from 'ethers';

type Receipt = {
  id: string;
  plan: 'plus' | 'max';
  status: 'quoted' | 'pending' | 'confirmed' | 'failed';
  actualUsdc: number;
  simulatedUsdc: number;
  txHash: string | null;
  paidUntil: string | null;
  protocol: string;
  wallet: string;
  token: string | null;
  treasury: string | null;
  contract: string | null;
  previousPlan: number;
  previousPaidUntil: number;
  createdAt: number;
};
export function SponsoredCheckout({
  account,
  wallet,
  plan,
  refresh,
  token,
  treasury,
  contract,
}: {
  account: string;
  wallet: string | null;
  plan: 'plus' | 'max';
  refresh: () => Promise<unknown>;
  token: string | undefined;
  treasury: string | undefined;
  contract: string | undefined;
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
        if (
          (restored.status !== 'pending' &&
            (restored.plan !== plan || restored.protocol !== SPONSORED_PROTOCOL)) ||
          (restored.status === 'quoted' &&
            (restored.protocol !== SPONSORED_PROTOCOL ||
              Date.now() - restored.createdAt >= 900_000))
        ) {
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
      const quote =
        (order?.status === 'quoted' && Date.now() - order.createdAt >= 900_000 ? null : order) ||
        (await api<Receipt>('/billing/demo/order', { plan }));
      setOrder(quote);
      // Persistence is optional: the server also deduplicates open orders per account.
      try {
        localStorage.setItem(storageKey, quote.id);
      } catch {
        /* Private browsing. */
      }
      let signature: string | undefined;
      if (quote.status === 'quoted') {
        if (
          !wallet ||
          !token ||
          !treasury ||
          !contract ||
          !quote.contract ||
          getAddress(quote.contract) !== getAddress(contract) ||
          ![0, 1, 2].includes(quote.previousPlan) ||
          !Number.isSafeInteger(quote.previousPaidUntil) ||
          quote.previousPaidUntil < 0 ||
          (quote.previousPlan === 0) !== (quote.previousPaidUntil === 0) ||
          quote.protocol !== SPONSORED_PROTOCOL ||
          quote.plan !== plan ||
          quote.actualUsdc !== 0 ||
          quote.simulatedUsdc !== (plan === 'plus' ? 2 : 6) ||
          getAddress(quote.wallet) !== getAddress(wallet) ||
          !quote.token ||
          getAddress(quote.token) !== getAddress(token) ||
          !quote.treasury ||
          getAddress(quote.treasury) !== getAddress(treasury) ||
          !Number.isSafeInteger(quote.createdAt) ||
          quote.createdAt > Date.now() + 60_000 ||
          Date.now() - quote.createdAt >= 900_000
        )
          throw new Error(
            'Nội dung mua gói hoặc ví nhận không khớp. Chưa ký. Tải lại trang để kiểm tra.',
          );
        const signer = await walletForAccount(account, wallet, false);
        if (!signer)
          throw new Error(
            'Trình duyệt này chưa có khóa ví của bạn. Dùng trình duyệt đã tạo ví hoặc khôi phục bản sao lưu bên dưới; không tạo ví thay thế.',
          );
        const auth = purchaseAuthorization({
          ...quote,
          token: quote.token,
          treasury: quote.treasury,
          contract: quote.contract,
        });
        signature = await signer.signTypedData(auth.domain, AUTHORIZATION_TYPES, auth.message);
      }
      const result =
        quote.status === 'pending'
          ? await api<Receipt>('/billing/demo/status?id=' + encodeURIComponent(quote.id))
          : await api<Receipt>('/billing/demo/confirm', { id: quote.id, signature });
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
    <section className="billing-sponsored" aria-label="Thanh toán demo miễn phí">
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
        <p>
          Phí mạng do Kivuno trả bằng test AVAX miễn phí trên Fuji. Bạn không cần nạp USDC hoặc
          AVAX.
        </p>
        <p>
          Ví của bạn ký mua gói qua hợp đồng KivunoPlans. Hợp đồng chuyển tiếp 0 USDC về ví chủ;
          Kivuno trả test gas.
        </p>
        <dl className="billing-transfer-parties">
          <dt>Ví của bạn</dt>
          <dd>
            <code>{wallet}</code>
          </dd>
          <dt>Ví chủ nhận 0 USDC</dt>
          <dd>
            <code>{treasury}</code>
          </dd>
        </dl>
        {contract && (
          <a
            href={'https://testnet.snowtrace.io/address/' + contract}
            target="_blank"
            rel="noreferrer"
          >
            Xem hợp đồng mua gói KivunoPlans ↗
          </a>
        )}
      </div>
      <details className="billing-wallet-box">
        <summary>Ví riêng của tài khoản</summary>
        <p>Ví được tạo khi đăng ký hoặc đăng nhập. Chỉ ví này ký yêu cầu mua gói của tài khoản.</p>
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
        {wallet && (
          <label className="billing-restore">
            Khôi phục ví từ bản sao lưu
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file)
                  void restoreWallet(account, wallet, file)
                    .then(() => setError('Đã khôi phục ví. Bấm ký mua gói để tiếp tục.'))
                    .catch((e) => setError(e.message));
              }}
            />
          </label>
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
          {busy || restoring
            ? 'Đang xử lý…'
            : pending
              ? 'Kiểm tra biên nhận'
              : 'Ký mua gói · 0 USDC'}
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
        Trên Explorer, ví trả gas gọi KivunoPlans. Hai sự kiện Transfer ghi ví của bạn → hợp đồng →
        ví chủ, đều 0 USDC. PlanPaid ghi gói và hạn dùng do hợp đồng xác nhận.
      </p>
      <p>
        Không tự gia hạn. Gia hạn cùng gói nối thêm 30 ngày; đổi gói bắt đầu kỳ mới ngay. Giá 2 và 6
        USDC chỉ để minh họa.
      </p>
    </section>
  );
}
