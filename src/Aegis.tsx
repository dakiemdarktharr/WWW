import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  GitMerge,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import type { AegisReceiptBundle, AegisStatus, AegisVerification } from '../shared/aegis';
import type { Project, TaskDiff, WorkspaceState } from '../shared/types';
import { api } from './api';
import { openExternal } from './desktop';
import { FoundationDialog } from './Foundation';
import './aegis.css';

type Machine = { id: string; name: string; online: boolean };
type MergePreview = { taskId: string; sourceDigest: string; payloadDigest: string; diff: TaskDiff };
const recordStatus = {
  approved: 'Đã duyệt',
  consuming: 'Đang sử dụng quyền duyệt',
  consumed: 'Đã sử dụng quyền duyệt',
  uncertain: 'Chờ đối chiếu',
  signed: 'Đã ký',
  anchoring: 'Đang ghi dấu',
  anchored: 'Đã ghi dấu',
};
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const dateTime = (value: number | string) =>
  new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString();

export default function Aegis({ state, project }: { state: WorkspaceState; project?: Project }) {
  const [status, setStatus] = useState<AegisStatus | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [verification, setVerification] = useState<AegisVerification | null>(null);
  const [copied, setCopied] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [next, nodes] = await Promise.all([
        api<AegisStatus>('/aegis'),
        api<Machine[]>('/runners'),
      ]);
      setStatus(next);
      setMachines(nodes);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function mutate(path: string, body: unknown, success: string) {
    setBusy(path);
    setError('');
    setNotice('');
    try {
      await api(path, body);
      setNotice(success);
      await refresh();
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      await refresh();
      return false;
    } finally {
      setBusy('');
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      setError('Hãy chọn địa chỉ và sao chép thủ công.');
    }
  }
  async function external(url: string) {
    try {
      await openExternal(url);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function exportReceipt(id: string) {
    setBusy(`export-${id}`);
    setError('');
    try {
      const bundle = await api<AegisReceiptBundle>(`/aegis/receipts/${id}/export`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `relay-receipt-${id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function verify(file?: File) {
    if (!file) return;
    setBusy('verify');
    setError('');
    setVerification(null);
    try {
      if (file.size > 1024 * 1024) throw new Error('Chọn tệp biên nhận nhỏ hơn 1 MB.');
      const bundle = JSON.parse(await file.text());
      setVerification(await api<AegisVerification>('/aegis/verify', { bundle }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function review(taskId: string) {
    setBusy(`preview-${taskId}`);
    setError('');
    try {
      setPreview(
        await api<MergePreview>(`/aegis/merge-preview?taskId=${encodeURIComponent(taskId)}`),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }
  const deployed = !!status?.contractAddress;
  const policy = status?.projects.find((item) => item.projectId === project?.id);
  const grants = status?.grants.filter((item) => item.projectId === project?.id) || [];
  const actions = status?.actions.filter((item) => item.projectId === project?.id) || [];
  const receipts = status?.receipts.filter((item) => item.projectId === project?.id) || [];
  const reviews = state.tasks.filter(
    (task) => task.projectId === project?.id && task.status === 'review',
  );
  const canTransact = deployed && status?.online && !busy;
  const transaction = (hash?: string | null) =>
    hash && status ? (
      <button
        className="aegis-transaction"
        onClick={() => void external(`${status.explorerUrl}/tx/${hash}`)}
        aria-label={`Xem giao dịch ${hash}`}
      >
        {short(hash)}
        <ExternalLink size={12} />
      </button>
    ) : null;

  return (
    <div className="aegis-page">
      <div className="page-heading">
        <div>
          <h1>
            <ShieldCheck size={23} /> Quyền dự án
          </h1>
          <p className="aegis-hint">
            Chọn máy được chạy tác vụ, duyệt thay đổi mã và kiểm tra bàn giao cho dự án.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button"
            title="Làm mới quyền dự án"
            aria-label="Làm mới quyền dự án"
            disabled={!!busy}
            onClick={() => {
              setError('');
              void refresh();
            }}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="aegis-notice" role="status">
          <Check size={16} />
          {notice}
        </p>
      )}
      {!status ? (
        <section className="panel aegis-loading">
          {error ? (
            'Bấm Làm mới quyền dự án để thử lại.'
          ) : (
            <>
              <Loader2 className="spin" size={20} /> Đang tải quyền dự án…
            </>
          )}
        </section>
      ) : (
        <>
          {project && (
            <section className="panel" data-usage="aegis-policy">
              <div className="aegis-panel-heading">
                <div>
                  <h2>{project.name}</h2>
                  <p className="aegis-hint">
                    {!deployed
                      ? 'Thiết lập sổ quyền bên dưới để có thể bật bảo vệ cho dự án này.'
                      : policy?.enabled
                        ? 'Máy cần có quyền còn hiệu lực. Xem và cấp quyền bên dưới.'
                        : 'Bật bảo vệ để yêu cầu quyền chạy tác vụ và phê duyệt trước khi gộp mã.'}
                  </p>
                  <span className={`aegis-state ${policy?.enabled ? 'positive' : ''}`}>
                    {policy?.enabled ? 'Đang bảo vệ' : 'Chưa bật bảo vệ'}
                  </span>
                </div>
                {deployed && (
                  <button
                    className={`button ${policy?.enabled ? '' : 'primary'}`}
                    disabled={!canTransact}
                    onClick={() => {
                      if (
                        policy?.enabled &&
                        !confirm(
                          `Tắt bảo vệ cho ${project.name}? Dự án sẽ ngừng yêu cầu quyền máy và phê duyệt gộp mã.`,
                        )
                      )
                        return;
                      void mutate(
                        '/aegis/projects',
                        { projectId: project.id, enabled: !policy?.enabled },
                        policy?.enabled
                          ? 'Đã tắt bảo vệ cho dự án.'
                          : 'Đã bật bảo vệ. Kiểm tra quyền của máy trước khi chạy tác vụ.',
                      );
                    }}
                  >
                    {policy?.enabled ? 'Tắt bảo vệ' : 'Bật bảo vệ'}
                  </button>
                )}
              </div>
            </section>
          )}
          <details
            key={deployed ? 'connected' : 'setup'}
            open={
              !deployed || !status.online || Number(status.executorBalance) < 0.002 || undefined
            }
            className="panel aegis-network-panel"
            data-usage="aegis-setup"
          >
            <summary>
              <ShieldCheck size={20} />
              <h2>
                {!status.setup
                  ? 'Thiết lập sổ quyền'
                  : !deployed
                    ? 'Tạo sổ quyền trên Fuji'
                    : status.online
                      ? 'Sổ quyền đã kết nối'
                      : 'Mất kết nối với sổ quyền'}
              </h2>
              <span className={`aegis-state ${status.online && deployed ? 'positive' : ''}`}>
                {!status.setup
                  ? 'Chưa thiết lập'
                  : !deployed
                    ? 'Chưa tạo sổ'
                    : status.online
                      ? 'Fuji'
                      : 'Ngoại tuyến'}
              </span>
            </summary>
            {!status.setup ? (
              <div className="aegis-section-body">
                <p>
                  Tạo khóa trên máy này để thiết lập sổ quyền dùng chung cho các dự án trên mạng thử
                  nghiệm Fuji.
                </p>
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() =>
                    void mutate(
                      '/aegis/setup',
                      {},
                      'Đã tạo khóa. Nhận AVAX thử cho địa chỉ quản trị để tạo sổ quyền.',
                    )
                  }
                >
                  <KeyRound size={15} />
                  {busy ? 'Đang tạo khóa…' : 'Tạo khóa quản trị'}
                </button>
              </div>
            ) : (
              <div className="aegis-section-body">
                <p>
                  {deployed
                    ? 'Sổ quyền ghi lại thao tác cấp quyền và phê duyệt trên Avalanche Fuji.'
                    : 'Sao chép địa chỉ quản trị, nhận AVAX thử miễn phí cho địa chỉ đó, rồi tạo sổ quyền trên Fuji.'}
                </p>
                <details open={!deployed || undefined}>
                  <summary>Địa chỉ và số dư thử nghiệm</summary>
                  <div className="aegis-wallets">
                    {[
                      { title: 'Quản trị', address: status.ownerAddress, balance: status.balance },
                      {
                        title: 'Thực thi',
                        address: status.executorAddress,
                        balance: status.executorBalance,
                      },
                    ]
                      .filter((wallet) => deployed || wallet.address === status.ownerAddress)
                      .map((wallet) => (
                        <div key={wallet.title}>
                          <span>{wallet.title}</span>
                          <code>{wallet.address}</code>
                          <button
                            className="icon-button"
                            aria-label={`Sao chép địa chỉ ${wallet.title}`}
                            onClick={() => wallet.address && void copy(wallet.address)}
                          >
                            {copied === wallet.address ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                          <strong>{wallet.balance} test AVAX</strong>
                        </div>
                      ))}
                  </div>
                </details>
                <div className="aegis-actions">
                  <button className="button" onClick={() => void external(status.faucetUrl)}>
                    Nhận AVAX thử miễn phí <ExternalLink size={14} />
                  </button>
                  {!deployed ? (
                    <button
                      className="button primary"
                      disabled={!!busy || !status.online}
                      onClick={() =>
                        void mutate('/aegis/deploy', {}, 'Đã tạo sổ quyền trên Avalanche Fuji.')
                      }
                    >
                      <ShieldCheck size={15} />
                      {busy === '/aegis/deploy' ? 'Đang tạo sổ…' : 'Tạo sổ quyền'}
                    </button>
                  ) : (
                    <button
                      className="button"
                      onClick={() =>
                        void external(`${status.explorerUrl}/address/${status.contractAddress}`)
                      }
                    >
                      Xem sổ trên Fuji <ExternalLink size={14} />
                    </button>
                  )}
                  {deployed && Number(status.executorBalance) < 0.002 && (
                    <button
                      className="button primary"
                      disabled={!!busy || !status.online}
                      onClick={() =>
                        void mutate('/aegis/deploy', {}, 'Đã cấp AVAX thử cho ví thực thi.')
                      }
                    >
                      {busy === '/aegis/deploy' ? 'Đang hoàn tất…' : 'Cấp AVAX thử cho ví thực thi'}
                    </button>
                  )}
                </div>
                {status.error && (
                  <p className="error-text" role="status">
                    {status.error}
                  </p>
                )}
                <details>
                  <summary>Khóa và khôi phục giao dịch</summary>
                  <p>
                    Hai khóa thử nghiệm nằm trong thư mục riêng của máy điều phối. Người kiểm soát
                    tài khoản hệ điều hành có thể sử dụng cả hai khóa. Nếu giao dịch bị gián đoạn,
                    hãy kiểm tra trạng thái trước khi tiếp tục.
                  </p>
                  <button
                    className="button compact"
                    disabled={!!busy}
                    onClick={() =>
                      void mutate('/aegis/recover', {}, 'Đã đối chiếu giao dịch đang chờ với Fuji.')
                    }
                  >
                    <RefreshCw size={14} />
                    Kiểm tra giao dịch đang chờ
                  </button>
                </details>
              </div>
            )}
          </details>
          {project ? (
            <>
              {(policy?.enabled || grants.length > 0) && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Quyền của máy</h2>
                  </div>
                  <div className="aegis-section-body">
                    <p>
                      Chọn máy, công việc được phép và thời hạn. Bạn có thể thu hồi quyền ngay tại
                      đây.
                    </p>
                    {policy?.enabled && (
                      <form
                        className="aegis-grant-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = new FormData(event.currentTarget);
                          void mutate(
                            '/aegis/grants',
                            {
                              projectId: project.id,
                              machineId: String(data.get('machineId')),
                              permissions: Number(data.get('permissions')),
                              expiresAt:
                                Math.floor(Date.now() / 1000) + Number(data.get('duration')),
                            },
                            'Đã xác nhận quyền của máy trên Fuji.',
                          );
                        }}
                      >
                        <label>
                          Máy
                          <select name="machineId" aria-label="Máy được cấp quyền">
                            <option value="local">Máy này</option>
                            {machines.map((machine) => (
                              <option key={machine.id} value={machine.id}>
                                {machine.name}
                                {machine.online ? '' : ' · ngoại tuyến'}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Quyền
                          <select name="permissions">
                            <option value="1">Chạy tác vụ</option>
                            <option value="3">Chạy tác vụ và gộp mã</option>
                          </select>
                        </label>
                        <label>
                          Thời hạn
                          <select name="duration">
                            <option value="3600">1 giờ</option>
                            <option value="86400">24 giờ</option>
                            <option value="604800">7 ngày</option>
                          </select>
                        </label>
                        <button className="button" disabled={!canTransact || !policy?.enabled}>
                          Cấp quyền
                        </button>
                      </form>
                    )}
                    {grants.length ? (
                      <div className="aegis-records">
                        {grants.map((grant) => (
                          <div className="aegis-record" key={grant.id}>
                            <div>
                              <strong>
                                {grant.machineId === 'local'
                                  ? 'Máy này'
                                  : machines.find((item) => item.id === grant.machineId)?.name ||
                                    grant.machineId}
                              </strong>
                              <span>
                                {grant.permissions === 0
                                  ? 'Đã thu hồi'
                                  : grant.expiresAt <= Date.now() / 1000
                                    ? 'Hết hạn'
                                    : `${grant.permissions === 3 ? 'Chạy và gộp mã' : 'Chạy tác vụ'} · hết hạn ${dateTime(grant.expiresAt)}`}
                              </span>
                            </div>
                            {transaction(grant.transactionHash)}
                            <button
                              className="button compact"
                              disabled={!canTransact || grant.permissions === 0}
                              onClick={() =>
                                void mutate(
                                  '/aegis/revoke',
                                  { projectId: project.id, machineId: grant.machineId },
                                  'Đã thu hồi quyền của máy.',
                                )
                              }
                            >
                              Thu hồi
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="aegis-empty">Chưa có máy được cấp quyền.</p>
                    )}
                  </div>
                </section>
              )}
              {(policy?.enabled || actions.length > 0) && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      <GitMerge size={16} /> Duyệt gộp mã
                    </h2>
                  </div>
                  <div className="aegis-section-body">
                    <p>
                      Xem phần mã đã thay đổi trước khi duyệt. Sau đó mở Reviews để gộp đúng phiên
                      bản vừa duyệt.
                    </p>
                    {reviews.map((task) => (
                      <div className="aegis-record" key={task.id}>
                        <div>
                          <strong>{task.title}</strong>
                          <span>{task.branch || 'Xem thay đổi hiện tại'}</span>
                        </div>
                        <button
                          className="button compact"
                          disabled={!canTransact || !policy?.enabled}
                          onClick={() => void review(task.id)}
                        >
                          Xem và duyệt
                        </button>
                      </div>
                    ))}
                    {actions.map((action) => (
                      <div className="aegis-record" key={action.id}>
                        <div>
                          <strong>
                            {state.tasks.find((task) => task.id === action.taskId)?.title ||
                              action.taskId}
                          </strong>
                          <span>
                            {recordStatus[action.status]} ·{' '}
                            {action.expiresAt <= Date.now() / 1000
                              ? 'hết hạn'
                              : `hết hạn ${dateTime(action.expiresAt)}`}
                          </span>
                          <code>{short(action.sourceDigest)}</code>
                        </div>
                        {transaction(action.consumedTransactionHash || action.transactionHash)}
                      </div>
                    ))}
                    {!reviews.length && !actions.length && (
                      <p className="aegis-empty">Chưa có thay đổi cần duyệt.</p>
                    )}
                  </div>
                </section>
              )}
              {(policy?.enabled || receipts.length > 0) && (
                <section className="panel" data-usage="aegis-receipts">
                  <div className="panel-heading">
                    <h2>
                      <FileCheck2 size={16} /> Biên nhận bàn giao
                    </h2>
                  </div>
                  <div className="aegis-section-body">
                    <p>
                      Ghi dấu bàn giao lên Fuji để người nhận có thể đối chiếu nội dung. Tải biên
                      nhận nếu cần chia sẻ.
                    </p>
                    {receipts.map((receipt) => (
                      <div className="aegis-record" key={receipt.id}>
                        <div>
                          <strong>
                            {state.handoffs.find((item) => item.id === receipt.handoffId)
                              ?.summary || `Handoff ${short(receipt.handoffId)}`}
                          </strong>
                          <span>
                            {recordStatus[receipt.status]} · {dateTime(receipt.createdAt)}
                          </span>
                          <code>{short(receipt.digest)}</code>
                        </div>
                        {transaction(receipt.transactionHash)}
                        <div className="aegis-actions">
                          {receipt.status === 'signed' && (
                            <button
                              className="button compact"
                              disabled={!canTransact}
                              onClick={() =>
                                void mutate(
                                  `/aegis/receipts/${receipt.id}/anchor`,
                                  {},
                                  'Đã ghi dấu biên nhận trên Fuji.',
                                )
                              }
                            >
                              Ghi dấu lên Fuji
                            </button>
                          )}
                          <button
                            className="icon-button"
                            aria-label={`Tải biên nhận ${receipt.id}`}
                            disabled={!!busy}
                            onClick={() => void exportReceipt(receipt.id)}
                          >
                            <Download size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {!receipts.length && <p className="aegis-empty">Chưa có biên nhận bàn giao.</p>}
                  </div>
                </section>
              )}
            </>
          ) : (
            <section className="panel aegis-section-body">
              <p className="aegis-empty">Chọn dự án ở thanh bên để quản lý quyền.</p>
            </section>
          )}
          <details className="panel aegis-network-panel">
            <summary>
              <FileCheck2 size={18} />
              <h2>Kiểm tra tệp biên nhận bàn giao</h2>
            </summary>
            <div className="aegis-section-body">
              <p>Chọn tệp JSON đã xuất để kiểm tra chữ ký, nội dung và dấu xác nhận trên Fuji.</p>
              <label className="aegis-upload">
                <Upload size={17} />
                <span>Chọn tệp biên nhận JSON</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={!!busy}
                  onChange={(event) => {
                    void verify(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </label>
              {verification && (
                <div className="aegis-verification" role="status">
                  {[
                    { label: 'Nội dung nguyên vẹn', value: verification.integrity },
                    { label: 'Chữ ký hợp lệ', value: verification.signature },
                    { label: 'Có dấu xác nhận trên Fuji', value: verification.anchored },
                    { label: 'Đúng sổ quyền', value: verification.trustedRegistry },
                  ].map((item) => (
                    <span key={item.label} className={item.value ? 'valid' : 'invalid'}>
                      {item.value ? <Check size={15} /> : <X size={15} />}
                      {item.label}
                    </span>
                  ))}
                  {verification.error && <p className="error-text">{verification.error}</p>}
                </div>
              )}
              <details className="aegis-recovery">
                <summary>Cách đọc kết quả</summary>
                <p>
                  Biên nhận xác minh nội dung và người ký. Bạn vẫn cần kiểm tra mã và kết quả thử
                  nghiệm khi nhận bàn giao.
                </p>
              </details>
            </div>
          </details>
        </>
      )}
      {preview && (
        <FoundationDialog
          title="Duyệt phiên bản để gộp mã"
          close={() => {
            if (!busy) setPreview(null);
          }}
          wide
        >
          <div className="aegis-merge-preview">
            <strong>{state.tasks.find((task) => task.id === preview.taskId)?.title}</strong>
            <pre>{preview.diff.stat}</pre>
            <pre className="aegis-diff">{preview.diff.diff || 'Chưa có thay đổi.'}</pre>
            {preview.diff.truncated && (
              <p className="error-text">
                Bản xem trước bị cắt ngắn. Hãy kiểm tra toàn bộ thay đổi trong kho mã.
              </p>
            )}
            <code>Source: {preview.sourceDigest}</code>
            <p>
              Quyền duyệt chỉ áp dụng cho phiên bản đang hiển thị. Mở Reviews để gộp mã sau khi
              duyệt.
            </p>
            <button
              className="button primary"
              disabled={!!busy || preview.diff.truncated}
              onClick={() =>
                void mutate(
                  '/aegis/approve-merge',
                  { taskId: preview.taskId, payloadDigest: preview.payloadDigest },
                  'Đã duyệt phiên bản này trên Fuji.',
                ).then((ok) => {
                  if (ok) setPreview(null);
                })
              }
            >
              {busy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}Duyệt phiên
              bản
            </button>
          </div>
        </FoundationDialog>
      )}
    </div>
  );
}
