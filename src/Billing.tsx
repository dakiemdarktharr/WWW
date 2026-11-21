import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { Contract, Signature, keccak256, getAddress, hexlify, randomBytes } from 'ethers';
import { api, ApiError, resetApiSession } from './api';
import { BillingWallet, balance, fuji, legacySigner, type WalletMode } from './BillingWallet';
import { walletForAccount, ensureAccountWallet } from './embedded-wallet';
import { SponsoredCheckout } from './SponsoredCheckout';
import { BankCheckout } from './BankCheckout';
import { PortalThemeProvider, PortalThemeToggle } from './PortalTheme';
import { PlanBanners, type PlanTier } from './PlanBanners';
import './billing.css';

type Plan = 'plus' | 'max';
type Tier = 'free' | Plan;
type AuthUser = { id: string; name: string; email: string };
type BillingProfile = {
  reservationId: string;
  profileId: string;
  deviceId: string;
  name: string;
  provider: string;
  selected: boolean;
};
type BillingProfiles = { limit: number | null; tier: Tier; profiles: BillingProfile[] };
type WalletConfig = {
  mode?: 'sponsored-demo' | 'usdc';
  chainId?: number;
  chainName?: string;
  tokenAddress?: string;
  tokenName?: string;
  tokenVersion?: string;
  contractAddress?: string;
  sponsoredContractAddress?: string;
  treasuryAddress?: string;
  available?: boolean;
};
type BillingSummary = {
  trial?: { eligible: boolean; active: boolean; tier: Plan | null; endsAt: string | null };
  account?: AuthUser;
  wallet?: string | null;
  walletBinding?: { address?: string | null } | null;
  tier?: Tier;
  plan?: Tier;
  currentPlan?: Tier;
  paidUntil?: string | null;
  activeUntil?: string | null;
  entitlement?: {
    tier?: Tier;
    plan?: Tier;
    paidUntil?: string | null;
    activeUntil?: string | null;
  };
  config?: WalletConfig;
  chainId?: number;
  tokenAddress?: string;
  contractAddress?: string;
  available?: boolean;
  paymentAvailable?: boolean;
  [key: string]: unknown;
};
type PaymentIntent = {
  id: string;
  plan: Plan;
  amount: string;
  payer: string;
  token: string;
  contract: string;
  chainId: number;
  expiresAt: string;
};
const FIJI_CHAIN_ID = 43113;
const PAYMENT_ABI = [
  'function pay(bytes32 intentId,uint8 planId,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s) external',
];
const EIP3009_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};
const planPrice = { plus: '2', max: '6' };

function walletAddress(summary: BillingSummary | null) {
  return summary?.wallet || summary?.walletBinding?.address || null;
}

function currentTier(summary: BillingSummary | null): Tier {
  const candidate =
    summary?.tier ||
    summary?.plan ||
    summary?.currentPlan ||
    summary?.entitlement?.tier ||
    summary?.entitlement?.plan;
  return candidate === 'plus' || candidate === 'max' ? candidate : 'free';
}

function endDate(summary: BillingSummary | null) {
  return (
    summary?.paidUntil ||
    summary?.activeUntil ||
    summary?.entitlement?.paidUntil ||
    summary?.entitlement?.activeUntil ||
    null
  );
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function responseMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object') {
    const value = body as Record<string, unknown>;
    if (typeof value.error === 'string') return value.error;
    if (typeof value.message === 'string') return value.message;
  }
  return fallback;
}

async function readJson(response: Response) {
  const value: unknown = await response.json().catch(() => ({}));
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const apiPath = path.startsWith('/api/') ? path.slice(4) : path;
  return api<T>(apiPath, body);
}

function activeConfig(summary: BillingSummary | null) {
  const config = (summary?.config || summary) as WalletConfig | undefined;
  const contract = config?.contractAddress;
  const token = config?.tokenAddress;
  return Boolean(
    config?.available !== false &&
    summary?.available !== false &&
    summary?.paymentAvailable !== false &&
    Number(config?.chainId ?? FIJI_CHAIN_ID) === FIJI_CHAIN_ID &&
    contract &&
    token,
  );
}

function pendingKey(accountId: string) {
  return 'kivuno:fuji:pending:' + accountId;
}

function rejected(error: unknown) {
  const inspect = (value: unknown, depth: number): boolean => {
    if (!value || typeof value !== 'object' || depth > 3) return false;
    const candidate = value as {
      code?: unknown;
      message?: unknown;
      shortMessage?: unknown;
      info?: unknown;
      error?: unknown;
    };
    const text = `${candidate.message || ''} ${candidate.shortMessage || ''}`;
    return (
      candidate.code === 4001 ||
      candidate.code === 'ACTION_REJECTED' ||
      /user (denied|rejected)|rejected by user/i.test(text) ||
      inspect(candidate.info, depth + 1) ||
      inspect(candidate.error, depth + 1)
    );
  };
  return inspect(error, 0);
}

export default function Billing({ rail = 'fuji' }: { rail?: 'bank' | 'fuji' }) {
  return (
    <PortalThemeProvider>
      <BillingContent rail={rail} />
    </PortalThemeProvider>
  );
}

function BillingContent({ rail }: { rail: 'bank' | 'fuji' }) {
  const bank = rail === 'bank';
  const [user, setUser] = useState<AuthUser | null>(null);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [billingProfiles, setBillingProfiles] = useState<BillingProfiles | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [walletMode, setWalletMode] = useState<WalletMode>('');
  const [pending, setPending] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan>('plus');
  const [txHash, setTxHash] = useState('');
  const [intentId, setIntentId] = useState('');
  const [preparedIntent, setPreparedIntent] = useState<PaymentIntent | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(Date.now());
  const [selectedBanner, setSelectedBanner] = useState<PlanTier | null>(() => {
    const query = new URLSearchParams(window.location.search);
    const plan = query.get('plan');
    if (bank && (query.has('bank') || query.has('receipt'))) return null;
    return plan === 'free' || plan === 'plus' || plan === 'max' ? plan : null;
  });
  const [checkout, setCheckout] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    return bank && (query.has('bank') || query.has('receipt'));
  });
  const panel = useRef<HTMLDivElement>(null);

  const choosePlan = (plan: PlanTier) => {
    setSelectedBanner(plan);
    if (plan === selectedBanner) panel.current?.scrollIntoView({ block: 'nearest' });
    if (plan !== 'free') setSelectedPlan(plan);
    setCheckout(false);
    setError('');
    setNotice('');
  };

  useEffect(() => {
    if ((!selectedBanner && !checkout && !showSignIn) || loading) return;
    if (selectedBanner && selectedBanner !== 'free') setSelectedPlan(selectedBanner);
    const frame = requestAnimationFrame(() => {
      panel.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      panel.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedBanner, loading, checkout, user?.id, showSignIn]);

  const tier = currentTier(summary);
  const boundWallet = walletAddress(summary);
  const config = (summary?.config || summary || undefined) as WalletConfig | undefined;
  const paymentReady = activeConfig(summary);
  const paidUntil = endDate(summary);
  const expires = paidUntil ? Date.parse(paidUntil) : NaN;
  const activePaidPlan = tier !== 'free' && Number.isFinite(expires) && expires > now;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshSummary = useCallback(async () => {
    const value = await api<BillingSummary>(
      bank ? '/billing/summary?rail=bank' : '/billing/summary',
    );
    setSummary(value);
    if (value.account) setUser(value.account);
    try {
      setBillingProfiles(await api<BillingProfiles>('/billing/profiles'));
    } catch {
      // The billing summary remains useful when profile records are temporarily unavailable.
    }
    return value;
  }, [bank]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await fetch('/api/auth/get-session', { credentials: 'same-origin' });
        const body = await readJson(response);
        if (response.status === 429)
          throw new Error(
            'Có nhiều yêu cầu đăng nhập từ máy này. Chờ một phút rồi tải lại trang để tiếp tục với đơn hiện tại.',
          );
        if (!response.ok) throw new Error('Dịch vụ đăng nhập chưa sẵn sàng. Hãy thử lại.');
        const account = body.user as AuthUser | null | undefined;
        if (!mounted) return;
        if (account && typeof account.id === 'string') {
          await ensureAccountWallet(account.id, account.email);
          setUser(account);
          await refreshSummary();
        }
      } catch (cause) {
        if (mounted) setError((cause as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [refreshSummary]);

  useEffect(() => {
    setWalletMode('');
    setPreparedIntent(null);
    setPending(false);
    setIntentId('');
    setTxHash('');
    if (bank || !user?.id) return;
    try {
      const saved = JSON.parse(localStorage.getItem(pendingKey(user.id)) || 'null');
      const validHash = /^0x[0-9a-f]{64}$/i;
      if (saved && validHash.test(saved.id) && validHash.test(saved.hash)) {
        setIntentId(saved.id);
        setTxHash(saved.hash);
        setPending(true);
        setCheckout(true);
      }
    } catch {
      /* The browser may have disabled local storage. */
    }
  }, [user?.id, bank]);

  const beginAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('auth');
    setError('');
    setNotice('');
    try {
      const isSignup = authMode === 'signup';
      const response = await fetch(`/api/auth/${isSignup ? 'sign-up' : 'sign-in'}/email`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          ...(isSignup ? { name: name.trim() } : {}),
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        if (response.status === 429) throw new Error('Bạn đã thử nhiều lần. Hãy đợi một phút.');
        if (response.status === 401) throw new Error('Email hoặc mật khẩu không đúng.');
        throw new Error(
          responseMessage(body, 'Chưa đăng nhập được. Kiểm tra thông tin và thử lại.'),
        );
      }
      if (!body.user || typeof (body.user as AuthUser).id !== 'string')
        throw new Error('Chưa xác nhận được phiên đăng nhập. Hãy đăng nhập lại.');
      resetApiSession();
      await ensureAccountWallet((body.user as AuthUser).id, (body.user as AuthUser).email);
      setUser(body.user as AuthUser);
      setShowSignIn(false);
      setPassword('');
      await refreshSummary();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  };

  const preparePayment = async (plan: Plan) => {
    if (!boundWallet) return setError('Liên kết ví với tài khoản Kivuno trước khi thanh toán.');
    if (!paymentReady) return setError('Hợp đồng thanh toán Fuji chưa được cấu hình.');
    if (!walletMode || pending) return;
    setBusy('prepare');
    setSelectedPlan(plan);
    setError('');
    setNotice('');
    setTxHash('');
    setIntentId('');
    setPreparedIntent(null);
    try {
      const intent = await postJson<PaymentIntent>('/api/billing/intent', { plan });
      if (intent.plan !== plan)
        throw new Error('Máy chủ trả về gói khác với lựa chọn. Tạo yêu cầu mới.');
      if (
        Number(config?.chainId ?? FIJI_CHAIN_ID) !== FIJI_CHAIN_ID ||
        intent.chainId !== FIJI_CHAIN_ID
      )
        throw new Error('Yêu cầu thanh toán có chain ID không đúng. Không gửi giao dịch.');
      if (!/^0x[0-9a-fA-F]{64}$/.test(intent.id) || /^0x0{64}$/i.test(intent.id))
        throw new Error('Mã yêu cầu thanh toán không đúng định dạng bytes32. Không gửi giao dịch.');
      if (!/^\d+$/.test(intent.amount))
        throw new Error('Máy chủ trả về số tiền USDC không hợp lệ. Không gửi giao dịch.');
      if (BigInt(intent.amount) !== BigInt(plan === 'plus' ? '2000000' : '6000000'))
        throw new Error('Máy chủ trả về số USDC không đúng với gói. Không gửi giao dịch.');
      if (getAddress(intent.payer) !== getAddress(boundWallet))
        throw new Error('Ví thanh toán khác ví đã liên kết. Không gửi giao dịch.');
      if (!config?.tokenAddress || getAddress(intent.token) !== getAddress(config.tokenAddress))
        throw new Error('Token trong yêu cầu không khớp với token Fuji đã cấu hình.');
      if (
        !config?.contractAddress ||
        getAddress(intent.contract) !== getAddress(config.contractAddress)
      )
        throw new Error('Hợp đồng trong yêu cầu không khớp với cấu hình Fuji.');
      const nowSeconds = Math.floor(Date.now() / 1000);
      const expiresAt = Date.parse(intent.expiresAt);
      const validBefore = Math.floor(expiresAt / 1000);
      if (!Number.isFinite(expiresAt) || validBefore <= nowSeconds + 60)
        throw new Error('Yêu cầu thanh toán đã hết hạn hoặc sắp hết hạn. Tạo yêu cầu mới.');
      if (validBefore > nowSeconds + 3600)
        throw new Error('Thời hạn yêu cầu dài hơn mức hợp đồng Fuji cho phép. Tạo yêu cầu mới.');
      setIntentId(intent.id);
      setPreparedIntent(intent);
      setNotice('Kiểm tra gói và số tiền trước khi xác nhận.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  };

  const toggleProfileSelection = async (profile: BillingProfile, checked: boolean) => {
    if (!billingProfiles) return;
    const selected = billingProfiles.profiles
      .filter((entry) => entry.selected)
      .map((entry) => entry.reservationId);
    const next = new Set(selected);
    if (checked) next.add(profile.reservationId);
    else next.delete(profile.reservationId);
    if (billingProfiles.limit !== null && next.size > billingProfiles.limit) {
      setError(
        `Gói ${billingProfiles.tier === 'plus' ? 'Plus' : 'Free'} hỗ trợ tối đa ${billingProfiles.limit} profile đang hoạt động.`,
      );
      return;
    }
    setBusy('profiles');
    setError('');
    setNotice('');
    try {
      const updated = await postJson<BillingProfiles>('/api/billing/profiles/select', {
        reservationIds: [...next],
      });
      setBillingProfiles(updated);
      setNotice('Đã lưu lựa chọn profile. Desktop sẽ đồng bộ trạng thái khóa khi kết nối lại.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  };

  function finishPending() {
    setPending(false);
    if (user) localStorage.removeItem(pendingKey(user.id));
  }

  const confirmPayment = async () => {
    if (!user) return;
    try {
      await navigator.locks.request(
        'kivuno:fuji:pay:' + user.id,
        { ifAvailable: true },
        async (lock) => {
          if (!lock || localStorage.getItem(pendingKey(user.id)))
            throw new Error('Một giao dịch đang chờ xác minh. Tải lại trang để kiểm tra.');
          await sendPayment();
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sendPayment = async () => {
    const intent = preparedIntent;
    if (!intent || !user || !walletMode || pending) return;
    if (!boundWallet || getAddress(boundWallet) !== getAddress(intent.payer)) {
      setPreparedIntent(null);
      return setError('Ví liên kết đã thay đổi. Tạo yêu cầu thanh toán mới.');
    }
    if (!paymentReady) return setError('Hợp đồng thanh toán Fuji hiện chưa sẵn sàng.');
    setBusy('pay');
    setError('');
    setNotice('Đang kiểm tra số dư trên Avalanche Fuji…');
    try {
      if (Number((await fuji.getNetwork()).chainId) !== FIJI_CHAIN_ID)
        throw new Error('Mạng thanh toán không phải Avalanche Fuji.');
      const funds = await balance(intent.payer, intent.token);
      if (funds.usdc < BigInt(intent.amount))
        throw new Error(
          'Ví cần ít nhất ' +
            planPrice[intent.plan] +
            ' test USDC. Mở “Nạp token thử và sao lưu ví” để nhận token trên Fuji.',
        );
      if (funds.gas === 0n) throw new Error('Ví cần test AVAX để trả phí giao dịch trên Fuji.');
      let signer;
      if (walletMode === 'embedded') {
        const wallet = await walletForAccount(user.id, boundWallet, false);
        if (!wallet) throw new Error('Mở lại ví Kivuno để tiếp tục.');
        signer = wallet.connect(fuji);
      } else {
        const old = await legacySigner(boundWallet);
        await old.provider.send('wallet_switchEthereumChain', [{ chainId: '0xa869' }]);
        if (Number((await old.provider.getNetwork()).chainId) !== FIJI_CHAIN_ID)
          throw new Error('Ví cũ chưa chuyển sang Fuji.');
        signer = old;
      }
      if (getAddress(await signer.getAddress()) !== getAddress(intent.payer))
        throw new Error('Ví đang mở khác ví trả tiền. Mở lại ví đã liên kết.');
      const currentTime = Math.floor(Date.now() / 1000);
      const validAfter = currentTime - 60;
      const validBefore = Math.floor(Date.parse(intent.expiresAt) / 1000);
      if (!Number.isFinite(validBefore) || validBefore <= currentTime + 30)
        throw new Error('Yêu cầu thanh toán đã hết hạn. Tạo yêu cầu mới.');
      if (validBefore > currentTime + 3600)
        throw new Error('Thời hạn yêu cầu dài hơn mức hợp đồng Fuji cho phép. Tạo yêu cầu mới.');
      const nonce = hexlify(randomBytes(32));
      const signature = await signer.signTypedData(
        {
          name: config?.tokenName || 'USD Coin',
          version: config?.tokenVersion || '2',
          chainId: intent.chainId,
          verifyingContract: getAddress(intent.token),
        },
        EIP3009_TYPES,
        {
          from: getAddress(intent.payer),
          to: getAddress(intent.contract),
          value: BigInt(intent.amount),
          validAfter,
          validBefore,
          nonce,
        },
      );
      const parsed = Signature.from(signature);
      setNotice('Đang gửi giao dịch đã xác nhận lên Fuji…');
      const payment = new Contract(intent.contract, PAYMENT_ABI, signer);
      const call = await payment.pay.populateTransaction(
        intent.id,
        intent.plan === 'plus' ? 1 : 2,
        validAfter,
        validBefore,
        nonce,
        parsed.v,
        parsed.r,
        parsed.s,
      );
      const [gasLimit, fees] = await Promise.all([signer.estimateGas(call), fuji.getFeeData()]);
      const maxFee = fees.maxFeePerGas ?? fees.gasPrice;
      if (!maxFee || gasLimit * maxFee > funds.gas)
        throw new Error('Ví chưa đủ test AVAX cho phí giao dịch trên Fuji.');
      const remember = (hash: string) => {
        localStorage.setItem(pendingKey(user.id), JSON.stringify({ id: intent.id, hash }));
        setTxHash(hash);
        setPending(true);
        setPreparedIntent(null);
      };
      let hash: string;
      if (walletMode === 'embedded') {
        const transaction = await signer.populateTransaction({
          ...call,
          gasLimit,
          chainId: FIJI_CHAIN_ID,
        });
        const raw = await signer.signTransaction(transaction);
        hash = keccak256(raw);
        remember(hash);
        await fuji.broadcastTransaction(raw);
      } else {
        const tx = await signer.sendTransaction({ ...call, gasLimit, chainId: FIJI_CHAIN_ID });
        hash = tx.hash;
        remember(hash);
      }
      setNotice('Đã gửi giao dịch. Đang đợi xác nhận trên Avalanche Fuji…');
      const receipt = await fuji.waitForTransaction(hash, 1, 60_000);
      if (receipt?.status === 0) {
        finishPending();
        throw new Error('Giao dịch không thành công. Kivuno chưa cấp quyền.');
      }
      const verification = await postJson<Record<string, unknown>>('/api/billing/verify', {
        intentId: intent.id,
        txHash: hash,
      });
      const state = String(verification.status || verification.state || '').toLowerCase();
      if (verification.verified === true || state === 'verified' || state === 'paid') {
        finishPending();
        setCheckout(false);
        setSelectedBanner(null);
        setNotice('Thanh toán đã được xác minh. Đang cập nhật quyền Kivuno…');
        await refreshSummary();
        setNotice('Gói Kivuno đã được cập nhật sau khi xác minh giao dịch Fuji.');
      } else {
        setNotice('Receipt đã có. Máy chủ đang xác minh; kiểm tra lại sau ít phút.');
      }
    } catch (cause) {
      const message = rejected(cause)
        ? 'Bạn đã từ chối chữ ký hoặc giao dịch. Kivuno chưa ghi nhận thanh toán.'
        : (cause as Error).message;
      setError(message);
    } finally {
      setBusy('');
    }
  };

  const cancelPayment = () => {
    setPreparedIntent(null);
    setIntentId('');
    setNotice('Đã hủy yêu cầu thanh toán. Chưa có giao dịch nào được gửi.');
    setError('');
  };

  const verifyPending = async () => {
    if (!intentId || !txHash) return;
    setBusy('verify');
    setError('');
    setNotice('Đang xác minh transaction trên RPC Fuji…');
    try {
      const verification = await postJson<Record<string, unknown>>('/api/billing/verify', {
        intentId,
        txHash,
      });
      const state = String(verification.status || verification.state || '').toLowerCase();
      if (verification.verified === true || state === 'verified' || state === 'paid') {
        finishPending();
        setCheckout(false);
        setSelectedBanner(null);
        await refreshSummary();
        setNotice('Thanh toán đã được xác minh và quyền Kivuno đã được cập nhật.');
      } else setNotice('Transaction vẫn đang chờ xác minh. Bạn có thể thử lại.');
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        (cause.code === 'PAYMENT_EXPIRED' || cause.code === 'PAYMENT_REVERTED')
      )
        finishPending();
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  };

  const signOut = async () => {
    setBusy('signout');
    setError('');
    try {
      await postJson<unknown>('/api/auth/sign-out', {});
      resetApiSession();
      setShowSignIn(false);
      setUser(null);
      setSummary(null);
      setPending(false);
      setBillingProfiles(null);
      setWalletMode('');
      setNotice('');
      setTxHash('');
      setIntentId('');
      setPreparedIntent(null);
      setSelectedBanner(null);
      setCheckout(false);
      setAuthMode('signin');
      setName('');
      setEmail('');
      setPassword('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  };

  const startTrial = async () => {
    if (!user || !selectedBanner || selectedBanner === 'free') return;
    setBusy('trial');
    setError('');
    setNotice('');
    try {
      await postJson('/api/billing/trial', { plan: selectedBanner });
      await refreshSummary();
      setNotice(
        `Đã kích hoạt ${selectedBanner === 'plus' ? 'Plus' : 'Max'} trong 30 ngày. Không tự gia hạn.`,
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  };

  const selectedName = selectedPlan === 'plus' ? 'Plus' : 'Max';
  const actionFor = (plan: PlanTier) => {
    if (!user || !summary)
      return plan === 'free' ? 'Xem gói miễn phí' : 'Xem gói ' + (plan === 'plus' ? 'Plus' : 'Max');
    if (plan === 'free') return activePaidPlan ? 'Xem gói Free' : 'Gói đang dùng';
    const name = plan === 'plus' ? 'Plus' : 'Max';
    if (activePaidPlan && tier === plan)
      return summary.trial?.active ? 'Mua gói ' + name : 'Gia hạn ' + name;
    return activePaidPlan && tier === 'max' ? 'Đổi sang ' + name : 'Nâng cấp lên ' + name;
  };
  const activePlanTitle = useMemo(
    () => (activePaidPlan ? (tier === 'plus' ? 'Plus' : 'Max') : 'Free'),
    [activePaidPlan, tier],
  );

  return (
    <main className="billing-page">
      <header className="billing-header">
        <a className="billing-brand" href="/" aria-label="Kivuno — về trang chủ">
          <img src="/kivuno.svg" alt="" width="36" height="36" />
          <span>Kivuno</span>
        </a>
        <div className="billing-header-actions">
          <PortalThemeToggle />
          <a className="billing-back" href="/">
            <ArrowLeft size={16} /> Trang chủ
          </a>
        </div>
      </header>

      <section className="billing-shell" aria-labelledby="billing-title">
        <div className="billing-intro">
          <h1 id="billing-title">Gói &amp; thanh toán</h1>
          <p>
            {user
              ? 'Quản lý gói cho tài khoản Kivuno của bạn.'
              : 'Chọn gói để xem chi tiết. Đăng nhập bằng tài khoản dùng trong Kivuno để mua hoặc gia hạn.'}
          </p>
        </div>
        {!user && !loading && !selectedBanner && !showSignIn && !checkout && (
          <button
            className="billing-secondary"
            type="button"
            onClick={() => {
              setAuthMode('signin');
              setShowSignIn(true);
            }}
          >
            Đăng nhập để xem gói của tôi
          </button>
        )}
        {loading && <p role="status">Đang tải thông tin tài khoản…</p>}
        {user && (
          <div className="billing-current billing-account-summary">
            <div>
              <span>Gói hiện tại</span>
              <strong>
                {summary ? activePlanTitle : 'Đang chờ thông tin gói'}
                {activePaidPlan && summary?.trial?.active ? ' · Dùng thử' : ''}
              </strong>
              <span>{user.email}</span>
            </div>
            {activePaidPlan && paidUntil && (
              <time dateTime={paidUntil}>
                Hết hạn{' '}
                {new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(
                  new Date(paidUntil),
                )}
              </time>
            )}
            <button
              type="button"
              className="billing-switch"
              disabled={busy !== ''}
              onClick={() => void signOut()}
            >
              Đăng xuất
            </button>
          </div>
        )}
        {!checkout && (
          <PlanBanners
            actionLabel={actionFor}
            selected={selectedBanner}
            onSelect={choosePlan}
            disabled={busy !== '' || pending || !!preparedIntent}
          />
        )}

        {(showSignIn ||
          selectedBanner ||
          checkout ||
          (user &&
            (error ||
              notice ||
              billingProfiles?.profiles.some((profile) => !profile.selected)))) && (
          <div className="billing-panel" ref={panel}>
            {loading ? (
              <div className="billing-loading" role="status">
                <LoaderCircle className="billing-spin" size={20} /> Đang tải tài khoản…
              </div>
            ) : !user ? (
              <form className="billing-auth" onSubmit={(event) => void beginAuth(event)}>
                <div className="billing-panel-heading">
                  <h2 tabIndex={-1}>{authMode === 'signup' ? 'Tạo tài khoản' : 'Đăng nhập'}</h2>
                  <button
                    className="billing-switch"
                    type="button"
                    onClick={() => {
                      if (checkout) {
                        window.location.assign('/billing');
                        return;
                      }
                      setSelectedBanner(null);
                      setShowSignIn(false);
                    }}
                    disabled={busy !== ''}
                  >
                    Đóng
                  </button>
                </div>
                {authMode === 'signup' && (
                  <label className="billing-field">
                    Tên của bạn
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                      minLength={2}
                      maxLength={80}
                      required
                      disabled={busy !== ''}
                    />
                  </label>
                )}
                <label className="billing-field">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    maxLength={254}
                    required
                    disabled={busy !== ''}
                  />
                </label>
                <label className="billing-field">
                  Mật khẩu
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                    minLength={authMode === 'signup' ? 12 : undefined}
                    maxLength={128}
                    required
                    disabled={busy !== ''}
                  />
                  {authMode === 'signup' && <small>Tối thiểu 12 ký tự.</small>}
                </label>
                {authMode === 'signin' && (
                  <a className="billing-switch billing-forgot" href="/forgot-password">
                    Quên mật khẩu?
                  </a>
                )}
                {error && (
                  <p className="billing-alert" role="alert">
                    <CircleAlert size={16} /> {error}
                  </p>
                )}
                <button className="billing-primary" type="submit" disabled={busy !== ''}>
                  {busy === 'auth' ? (
                    <LoaderCircle className="billing-spin" size={17} />
                  ) : (
                    <ArrowUpRight size={17} />
                  )}
                  {authMode === 'signup' ? 'Tạo tài khoản' : 'Đăng nhập'}
                </button>
                <button
                  className="billing-switch"
                  type="button"
                  onClick={() => {
                    setAuthMode(authMode === 'signup' ? 'signin' : 'signup');
                    setError('');
                  }}
                  disabled={busy !== ''}
                >
                  {authMode === 'signup'
                    ? 'Đã có tài khoản? Đăng nhập'
                    : 'Chưa có tài khoản? Đăng ký'}
                </button>
              </form>
            ) : (
              <>
                {!checkout && (
                  <div className="billing-plan-actions">
                    {selectedBanner && (
                      <h2 tabIndex={-1}>
                        {selectedBanner === 'free' ? 'Gói Free' : actionFor(selectedBanner)}
                      </h2>
                    )}
                    {selectedBanner === 'free' && (
                      <p>
                        Gói Free gồm 3 hồ sơ nhà cung cấp và tối đa 3 người mỗi nhóm. Gói này miễn
                        phí.
                      </p>
                    )}
                    {selectedBanner && selectedBanner !== 'free' && (
                      <p>
                        {activePaidPlan && !summary?.trial?.active
                          ? tier === selectedBanner
                            ? 'Gia hạn cùng gói sẽ nối thêm 30 ngày. Bạn xác nhận trước khi thanh toán.'
                            : 'Đổi gói bắt đầu kỳ mới ngay. Thời gian còn lại của gói cũ sẽ không được cộng hoặc hoàn lại.'
                          : 'Mỗi lần mua có hiệu lực 30 ngày. Bạn tự quyết định khi nào gia hạn.'}
                      </p>
                    )}
                    {selectedBanner && selectedBanner !== 'free' && summary?.trial?.eligible && (
                      <button
                        className="billing-primary"
                        type="button"
                        disabled={busy !== ''}
                        onClick={() => void startTrial()}
                      >
                        {busy === 'trial' ? (
                          <LoaderCircle className="billing-spin" size={17} />
                        ) : (
                          <ArrowUpRight size={17} />
                        )}
                        Dùng thử 30 ngày · {selectedBanner === 'plus' ? 'Plus' : 'Max'}
                      </button>
                    )}
                    {selectedBanner && selectedBanner !== 'free' && (
                      <button
                        className="billing-secondary"
                        type="button"
                        disabled={busy !== ''}
                        onClick={() => setCheckout(true)}
                      >
                        {bank ? 'Xem báo giá QR mô phỏng' : 'Tiếp tục thanh toán'} · {selectedName}
                      </button>
                    )}
                    {selectedBanner === 'free' && (
                      <a className="billing-download" href="/?download">
                        <ArrowUpRight size={17} /> Tải Kivuno
                      </a>
                    )}
                    {error && (
                      <p className="billing-alert" role="alert">
                        <CircleAlert size={16} /> {error}
                      </p>
                    )}
                    {notice && (
                      <p className="billing-notice" role="status">
                        {notice}
                      </p>
                    )}
                  </div>
                )}
                {!checkout &&
                  billingProfiles &&
                  billingProfiles.profiles.length > 0 &&
                  billingProfiles.profiles.some((profile) => !profile.selected) && (
                    <section
                      className="billing-profile-limits"
                      aria-labelledby="billing-profiles-title"
                    >
                      <div className="billing-profile-heading">
                        <div>
                          <span className="billing-step">Profile theo gói</span>
                          <h3 id="billing-profiles-title">Chọn profile đang hoạt động</h3>
                        </div>
                        <span className="billing-profile-count">
                          {billingProfiles.profiles.filter((profile) => profile.selected).length} /{' '}
                          {billingProfiles.limit === null ? '∞' : billingProfiles.limit}
                        </span>
                      </div>
                      <p>
                        Profile vượt giới hạn vẫn được giữ lại nhưng tạm khóa. Bỏ chọn một profile
                        đang hoạt động trước, rồi chọn profile muốn mở; desktop đồng bộ khi kết nối
                        lại.
                      </p>
                      <div className="billing-profile-list">
                        {billingProfiles.profiles.map((profile) => (
                          <label
                            className={`billing-profile-option ${profile.selected ? 'is-selected' : 'is-locked'}`}
                            key={profile.reservationId}
                          >
                            <input
                              type="checkbox"
                              checked={profile.selected}
                              onChange={(event) =>
                                void toggleProfileSelection(profile, event.currentTarget.checked)
                              }
                              disabled={busy !== ''}
                            />
                            <span className="billing-profile-copy">
                              <strong>{profile.name}</strong>
                              <small>
                                {profile.provider} · thiết bị …{profile.deviceId.slice(-4)}
                              </small>
                            </span>
                            <span className="billing-profile-state">
                              {profile.selected ? 'Đang mở' : 'Đang khóa'}
                            </span>
                          </label>
                        ))}
                      </div>
                    </section>
                  )}

                {checkout && !bank && config?.mode === 'sponsored-demo' && (
                  <SponsoredCheckout
                    account={user.id}
                    wallet={boundWallet}
                    plan={selectedPlan}
                    refresh={refreshSummary}
                    token={config.tokenAddress || undefined}
                    treasury={config.treasuryAddress || undefined}
                    contract={config.sponsoredContractAddress || undefined}
                  />
                )}
                {checkout && (bank || config?.mode !== 'sponsored-demo') && (
                  <>
                    {!busy && !pending && !preparedIntent && (
                      <a className="billing-switch" href="/billing">
                        Quay lại danh sách gói
                      </a>
                    )}
                    <h2 tabIndex={-1}>
                      {bank
                        ? 'Thanh toán QR mô phỏng'
                        : pending
                          ? 'Đối chiếu giao dịch Fuji'
                          : 'Thanh toán gói ' + selectedName}
                    </h2>
                    <p>
                      {bank
                        ? 'Kiểm tra báo giá VND trước khi tạo đơn thử.'
                        : pending
                          ? 'Kiểm tra trạng thái giao dịch đã gửi và quyền sử dụng gói.'
                          : 'Kiểm tra ví và số dư Fuji, sau đó xem lại yêu cầu trước khi ký.'}
                    </p>
                    {summary?.account?.id === user.id && (
                      <BillingWallet
                        key={user.id}
                        account={user.id}
                        bound={boundWallet}
                        bankCheckout={bank}
                        token={bank ? undefined : config?.tokenAddress}
                        busy={busy !== ''}
                        onMode={setWalletMode}
                        refresh={refreshSummary}
                      />
                    )}

                    {bank && summary?.account?.id === user.id && (
                      <BankCheckout
                        key={user.id}
                        selectedPlan={selectedPlan}
                        onPaid={refreshSummary}
                      />
                    )}
                    {bank && error && (
                      <p className="billing-alert" role="alert">
                        {error}
                      </p>
                    )}
                    {!bank && (
                      <>
                        {!paymentReady && (
                          <p className="billing-config-note" role="status">
                            <CircleAlert size={16} />
                            {Number(config?.chainId ?? FIJI_CHAIN_ID) !== FIJI_CHAIN_ID
                              ? 'Cấu hình thanh toán không trỏ tới Fuji. Giao dịch đã bị khóa để tránh gửi nhầm mạng.'
                              : 'Thanh toán Fuji đang chờ địa chỉ token và hợp đồng. Bạn có thể liên kết ví; chưa thể tạo giao dịch.'}
                          </p>
                        )}
                        {preparedIntent && (
                          <section
                            className="billing-review"
                            aria-labelledby="billing-review-title"
                          >
                            <div className="billing-review-heading">
                              <div>
                                <span className="billing-step">Xác nhận trước khi ký</span>
                                <h3 id="billing-review-title">Kiểm tra yêu cầu thanh toán</h3>
                              </div>
                              <span className="billing-review-chain">Fuji · 43113</span>
                            </div>
                            <div className="billing-review-price">
                              <strong>{planPrice[preparedIntent.plan]} test USDC</strong>
                              <span>
                                {preparedIntent.plan === 'plus' ? 'Plus' : 'Max'} · 30 ngày
                              </span>
                            </div>
                            <dl className="billing-review-details">
                              {' '}
                              <div>
                                <dt>Yêu cầu hết hạn</dt>
                                <dd>
                                  <time dateTime={preparedIntent.expiresAt}>
                                    {new Intl.DateTimeFormat('vi-VN', {
                                      dateStyle: 'medium',
                                      timeStyle: 'short',
                                    }).format(new Date(preparedIntent.expiresAt))}
                                  </time>
                                </dd>
                              </div>
                            </dl>
                            <details className="billing-transaction-details">
                              <summary>Địa chỉ ví và hợp đồng</summary>
                              <dl className="billing-review-details">
                                <div>
                                  <dt>Ví trả tiền</dt>
                                  <dd>
                                    <code>{getAddress(preparedIntent.payer)}</code>
                                  </dd>
                                </div>
                                <div>
                                  <dt>Token USDC</dt>
                                  <dd>
                                    <code>{getAddress(preparedIntent.token)}</code>
                                  </dd>
                                </div>
                                <div>
                                  <dt>Hợp đồng nhận giao dịch</dt>
                                  <dd>
                                    <code>{getAddress(preparedIntent.contract)}</code>
                                  </dd>
                                </div>
                                {config?.treasuryAddress && (
                                  <div>
                                    <dt>Kho nhận USDC</dt>
                                    <dd>
                                      <code>{getAddress(config.treasuryAddress)}</code>
                                    </dd>
                                  </div>
                                )}
                              </dl>
                            </details>
                            <p className="billing-review-note">
                              Hợp đồng nhận chữ ký USDC đúng số tiền này rồi chuyển vào kho nhận.
                              Giao dịch cần thêm test AVAX để trả gas; không có gia hạn tự động.
                            </p>
                            <div className="billing-review-actions">
                              <button
                                className="billing-primary"
                                type="button"
                                onClick={() => void confirmPayment()}
                                disabled={busy !== ''}
                              >
                                {busy === 'pay' ? (
                                  <LoaderCircle className="billing-spin" size={17} />
                                ) : (
                                  <ShieldCheck size={17} />
                                )}
                                Thanh toán {planPrice[preparedIntent.plan]} test USDC
                              </button>
                              <button
                                className="billing-secondary"
                                type="button"
                                onClick={cancelPayment}
                                disabled={busy !== ''}
                              >
                                Hủy yêu cầu
                              </button>
                            </div>
                          </section>
                        )}
                        {error && (
                          <p className="billing-alert" role="alert">
                            <CircleAlert size={16} /> {error}
                          </p>
                        )}
                        {notice && (
                          <p className="billing-notice" role="status">
                            {notice}
                          </p>
                        )}
                        {txHash && (
                          <div className="billing-tx-row">
                            <span>Transaction</span>
                            <a
                              href={`https://build.avax.network/explorer/fuji/c-chain/tx/${encodeURIComponent(txHash)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {shortAddress(txHash)} <ExternalLink size={14} />
                            </a>
                            <button
                              type="button"
                              onClick={() => void verifyPending()}
                              disabled={busy !== ''}
                            >
                              {busy === 'verify' ? (
                                <LoaderCircle className="billing-spin" size={14} />
                              ) : (
                                <ArrowUpRight size={14} />
                              )}
                              Kiểm tra quyền
                            </button>
                          </div>
                        )}
                        {!preparedIntent && (
                          <button
                            className="billing-primary billing-buy"
                            type="button"
                            onClick={() => void preparePayment(selectedPlan)}
                            disabled={
                              !boundWallet || !walletMode || pending || busy !== '' || !paymentReady
                            }
                          >
                            {busy === 'prepare' ? (
                              <LoaderCircle className="billing-spin" size={17} />
                            ) : (
                              <ArrowUpRight size={17} />
                            )}
                            Tiếp tục với {planPrice[selectedPlan]} test USDC
                          </button>
                        )}
                        <div className="billing-terms">
                          <p>
                            <ShieldCheck size={15} /> Mỗi lần mua cần bạn xác nhận. Người mua trả
                            gas bằng test AVAX.
                          </p>
                          <p>
                            Không tự gia hạn. Gia hạn cùng gói sớm sẽ nối thêm 30 ngày; đổi tier bắt
                            đầu kỳ mới ngay, thời gian cũ không được cộng hoặc hoàn lại.
                          </p>
                          <p>
                            Fuji USDC chỉ dùng để thử nghiệm, không có giá trị tiền thật. Hãy sao
                            lưu ví trước khi đổi thiết bị.
                          </p>
                        </div>
                        <div className="billing-config-foot">
                          <span>
                            <LockKeyhole size={13} /> Ví thanh toán Fuji
                          </span>
                          <span>Avalanche Fuji · chain {config?.chainId ?? FIJI_CHAIN_ID}</span>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
        {!showSignIn && !checkout && !selectedBanner && !user && error && (
          <p className="billing-alert" role="alert">
            {error}
          </p>
        )}
      </section>

      <footer className="billing-footer">
        <span>© {new Date().getFullYear()} Kivuno</span>
        <a href="https://build.avax.network" target="_blank" rel="noreferrer">
          Avalanche <ExternalLink size={13} />
        </a>
      </footer>
    </main>
  );
}
