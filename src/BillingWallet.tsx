import { useEffect, useState } from 'react';
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  formatEther,
  formatUnits,
  getAddress,
  type Eip1193Provider,
} from 'ethers';
import { api } from './api';
import { walletForAccount, restoreWallet, backupWallet } from './embedded-wallet';

export const fuji = new JsonRpcProvider('https://api.avax-test.network/ext/bc/C/rpc', 43113);
export type WalletMode = 'embedded' | 'external' | '';

export async function balance(address: string, token: string) {
  const [gas, usdc] = await Promise.all([
    fuji.getBalance(address),
    new Contract(token, ['function balanceOf(address) view returns (uint256)'], fuji).balanceOf(
      address,
    ) as Promise<bigint>,
  ]);
  return { gas, usdc };
}

async function bind(
  account: string,
  target: NonNullable<Awaited<ReturnType<typeof walletForAccount>>>,
  old?: string,
) {
  const proof = await api<{ challengeId: string; message: string; currentWalletMessage?: string }>(
    '/billing/wallet/challenge',
    { address: target.address },
  );
  const lines = proof.message.split('\n');
  if (
    lines[0] !== 'Kivuno wallet authorization' ||
    !lines.includes('Account: ' + account) ||
    !lines.includes('New wallet: ' + target.address)
  )
    throw new Error('Tài khoản đã thay đổi. Tải lại trang.');
  let currentSignature: string | undefined;
  if (proof.currentWalletMessage) {
    if (!old) throw new Error('Tài khoản đã liên kết một ví khác. Tải lại trang.');
    const signer = await legacySigner(old);
    currentSignature = await signer.signMessage(proof.currentWalletMessage);
  } else if (old) throw new Error('Liên kết ví đã thay đổi. Tải lại trang.');
  await api('/billing/wallet/bind', {
    challengeId: proof.challengeId,
    signature: await target.signMessage(proof.message),
    currentSignature,
  });
}

export async function legacySigner(bound: string) {
  const injected = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (!injected) throw new Error('Mở ví cũ đã liên kết để xác nhận địa chỉ này.');
  const provider = new BrowserProvider(injected, 'any');
  const accounts: string[] = await provider.send('eth_requestAccounts', []);
  if (!accounts.some((a) => getAddress(a) === getAddress(bound)))
    throw new Error('Chọn đúng địa chỉ ví cũ đã liên kết.');
  return provider.getSigner(getAddress(bound));
}

type Props = {
  account: string;
  bound: string | null;
  token?: string;
  busy: boolean;
  onMode: (mode: WalletMode) => void;
  refresh: () => Promise<unknown>;
};

export function BillingWallet({ account, bound, token, busy, onMode, refresh }: Props) {
  const [mode, setMode] = useState<WalletMode>('');
  const [working, setWorking] = useState(true);
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  const [funds, setFunds] = useState('');
  const [balanceTick, setBalanceTick] = useState(0);
  useEffect(() => {
    let active = true;
    setWorking(true);
    setError('');
    setMode('');
    onMode('');
    async function setup() {
      const wallet = await walletForAccount(account, bound, !bound);
      if (!active || !wallet) return;
      if (!bound) {
        try {
          await bind(account, wallet);
        } finally {
          if (active) await refresh();
        }
      } else if (active) {
        setMode('embedded');
        onMode('embedded');
      }
    }
    setup()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setWorking(false);
      });
    return () => {
      active = false;
    };
  }, [account, bound, attempt, onMode, refresh]);
  useEffect(() => {
    let active = true;
    setFunds('');
    if (bound && token)
      balance(bound, token)
        .then(({ gas, usdc }) => {
          if (active)
            setFunds(
              formatUnits(usdc, 6) +
                ' test USDC · ' +
                Number(formatEther(gas)).toLocaleString('vi-VN', { maximumFractionDigits: 8 }) +
                ' test AVAX',
            );
        })
        .catch(() => {
          if (active) setFunds('Chưa đọc được số dư Fuji.');
        });
    return () => {
      active = false;
    };
  }, [bound, token, balanceTick, busy]);
  async function act(action: () => Promise<void>) {
    setWorking(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  const locked = working || busy;
  return (
    <section className="billing-wallet-box" aria-label="Ví thanh toán Kivuno">
      <strong>Ví thanh toán Kivuno</strong>
      {working && <p role="status">Đang mở ví…</p>}
      {bound && (
        <>
          <p className="billing-wallet-address">
            <code>{bound}</code>
          </p>
          <p>{funds}</p>
          <button
            className="billing-switch"
            type="button"
            disabled={locked}
            onClick={() => setBalanceTick((n) => n + 1)}
          >
            Cập nhật số dư
          </button>
          {mode === 'embedded' && (
            <details>
              <summary>Nạp token thử và sao lưu ví</summary>
              <p>
                Dùng địa chỉ trên để nhận test USDC và test AVAX trên Avalanche Fuji. Lưu bản sao
                trước khi xóa dữ liệu trình duyệt hoặc đổi máy.
              </p>
              <p>
                <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">
                  Nhận test USDC
                </a>{' '}
                ·{' '}
                <a
                  href="https://build.avax.network/console/primary-network/faucet"
                  target="_blank"
                  rel="noreferrer"
                >
                  Nhận test AVAX
                </a>
              </p>
              <button
                type="button"
                className="billing-secondary"
                disabled={locked}
                onClick={() => void act(() => backupWallet(account, bound))}
              >
                Tải bản sao lưu mã hóa
              </button>
            </details>
          )}
          {!working && !mode && (
            <>
              <p>
                Ví này đã liên kết với tài khoản. Trên thiết bị mới, chọn bản sao lưu để mở lại ví.
              </p>
              <label>
                Khôi phục ví{' '}
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={locked}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file)
                      void act(async () => {
                        await restoreWallet(account, bound, file);
                        retry((n) => n + 1);
                      });
                  }}
                />
              </label>
              <details>
                <summary>Đã dùng ví ngoài trước đây?</summary>
                <button
                  className="billing-secondary"
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    void act(async () => {
                      await legacySigner(bound);
                      setMode('external');
                      onMode('external');
                    })
                  }
                >
                  Dùng ví cũ
                </button>
                <button
                  className="billing-secondary"
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    void act(async () => {
                      const next = await walletForAccount(account, null, true);
                      if (!next) throw Error('Chưa tạo được ví.');
                      await bind(account, next, bound);
                      await refresh();
                    })
                  }
                >
                  Ký bằng ví cũ để đổi sang ví Kivuno
                </button>
                <p>
                  Đổi địa chỉ sau khi kỳ trả phí và các yêu cầu thanh toán đã kết thúc. Số dư ở lại
                  ví cũ.
                </p>
              </details>
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="billing-alert">
          {error}
        </p>
      )}
      {!working && !mode && (
        <button
          type="button"
          className="billing-switch"
          disabled={locked}
          onClick={() => retry((n) => n + 1)}
        >
          Mở lại ví
        </button>
      )}
    </section>
  );
}
