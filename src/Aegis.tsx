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
      setError('Cannot copy automatically. Select the address and copy it manually.');
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
      if (file.size > 1024 * 1024) throw new Error('Receipt bundle must be smaller than 1 MB.');
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
        aria-label={`View transaction ${hash}`}
      >
        {short(hash)}
        <ExternalLink size={12} />
      </button>
    ) : null;

  return (
    <div className="aegis-page">
      <div className="page-heading">
        <h1>
          <ShieldCheck size={23} /> AEGIS
        </h1>
        <div className="heading-actions">
          <span className="aegis-network">Avalanche Fuji</span>
          <button
            className="icon-button"
            aria-label="Refresh AEGIS"
            disabled={!!busy}
            onClick={() => void refresh()}
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
          <Loader2 className="spin" size={20} />
          Reading AEGIS…
        </section>
      ) : (
        <>
          <section className="panel aegis-network-panel" data-usage="aegis-setup">
            <header>
              <ShieldCheck size={20} />
              <h2>
                {!status.setup
                  ? 'Set up AEGIS'
                  : !deployed
                    ? 'Deploy your Fuji registry'
                    : status.online
                      ? 'Registry connected'
                      : 'Registry unavailable'}
              </h2>
              <span className={`aegis-state ${status.online && deployed ? 'positive' : ''}`}>
                {!status.setup
                  ? 'Not configured'
                  : !deployed
                    ? 'Not deployed'
                    : status.online
                      ? 'Fuji'
                      : 'Offline'}
              </span>
            </header>
            {!status.setup ? (
              <div className="aegis-section-body">
                <p>Create dedicated keys for the Fuji testnet. No mainnet transactions.</p>
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() =>
                    void mutate(
                      '/aegis/setup',
                      {},
                      'Fuji keys created. Add free test AVAX to the owner address to deploy.',
                    )
                  }
                >
                  <KeyRound size={15} />
                  {busy ? 'Setting up…' : 'Create Fuji keys'}
                </button>
              </div>
            ) : (
              <div className="aegis-section-body">
                <div className="aegis-wallets">
                  {[
                    { title: 'Owner', address: status.ownerAddress, balance: status.balance },
                    {
                      title: 'Executor',
                      address: status.executorAddress,
                      balance: status.executorBalance,
                    },
                  ].map((wallet) => (
                    <div key={wallet.title}>
                      <span>{wallet.title}</span>
                      <code>{wallet.address}</code>
                      <button
                        className="icon-button"
                        aria-label={`Copy ${wallet.title.toLowerCase()} address`}
                        onClick={() => wallet.address && void copy(wallet.address)}
                      >
                        {copied === wallet.address ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <strong>{wallet.balance} test AVAX</strong>
                    </div>
                  ))}
                </div>
                <div className="aegis-actions">
                  <button className="button" onClick={() => void external(status.faucetUrl)}>
                    Get free test AVAX <ExternalLink size={14} />
                  </button>
                  {!deployed ? (
                    <button
                      className="button primary"
                      disabled={!!busy || !status.online}
                      onClick={() =>
                        void mutate('/aegis/deploy', {}, 'Registry deployed on Avalanche Fuji.')
                      }
                    >
                      <ShieldCheck size={15} />
                      {busy === '/aegis/deploy' ? 'Deploying…' : 'Deploy on Fuji'}
                    </button>
                  ) : (
                    <button
                      className="button"
                      onClick={() =>
                        void external(`${status.explorerUrl}/address/${status.contractAddress}`)
                      }
                    >
                      View registry <ExternalLink size={14} />
                    </button>
                  )}
                  {deployed && Number(status.executorBalance) < 0.002 && (
                    <button
                      className="button primary"
                      disabled={!!busy || !status.online}
                      onClick={() =>
                        void mutate('/aegis/deploy', {}, 'Executor funded with Fuji test AVAX.')
                      }
                    >
                      {busy === '/aegis/deploy'
                        ? 'Finishing setup…'
                        : 'Finish setup: fund executor'}
                    </button>
                  )}
                </div>
                {status.error && (
                  <p className="error-text" role="status">
                    {status.error}
                  </p>
                )}
                <details>
                  <summary>Key custody and recovery</summary>
                  <p>
                    This alpha stores both testnet keys in the coordinator’s private directory.
                    Anyone controlling that operating-system account can control these keys. AEGIS
                    does not replace machine isolation or recover your Codex account.
                  </p>
                  <button
                    className="button compact"
                    disabled={!!busy}
                    onClick={() =>
                      void mutate(
                        '/aegis/recover',
                        {},
                        'Pending transactions checked against Fuji.',
                      )
                    }
                  >
                    <RefreshCw size={14} />
                    Check pending transactions
                  </button>
                </details>
              </div>
            )}
          </section>
          {project ? (
            <>
              <section className="panel" data-usage="aegis-policy">
                <div className="aegis-panel-heading">
                  <div>
                    <h2>{project.name}</h2>
                    <span className={`aegis-state ${policy?.enabled ? 'positive' : ''}`}>
                      {policy?.enabled ? 'Policy enforced' : 'AEGIS not enabled for this project'}
                    </span>
                  </div>
                  <button
                    className={`button ${policy?.enabled ? '' : 'primary'}`}
                    disabled={!canTransact}
                    onClick={() => {
                      if (
                        policy?.enabled &&
                        !confirm(
                          `Disable AEGIS policy for ${project.name}? Machine grants and merge approvals will no longer be required by this policy.`,
                        )
                      )
                        return;
                      void mutate(
                        '/aegis/projects',
                        { projectId: project.id, enabled: !policy?.enabled },
                        policy?.enabled
                          ? 'Project policy disabled.'
                          : 'Project policy enabled. Grant execution permission before running tasks.',
                      );
                    }}
                  >
                    {policy?.enabled ? 'Disable policy' : 'Enable policy'}
                  </button>
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Machine permissions</h2>
                </div>
                <div className="aegis-section-body">
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
                          expiresAt: Math.floor(Date.now() / 1000) + Number(data.get('duration')),
                        },
                        'Machine permission confirmed on Fuji.',
                      );
                    }}
                  >
                    <label>
                      Machine
                      <select name="machineId" aria-label="Grant machine">
                        <option value="local">This computer</option>
                        {machines.map((machine) => (
                          <option key={machine.id} value={machine.id}>
                            {machine.name}
                            {machine.online ? '' : ' · offline'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Permission
                      <select name="permissions">
                        <option value="1">Run tasks</option>
                        <option value="3">Run tasks and merge</option>
                      </select>
                    </label>
                    <label>
                      Duration
                      <select name="duration">
                        <option value="3600">1 hour</option>
                        <option value="86400">24 hours</option>
                        <option value="604800">7 days</option>
                      </select>
                    </label>
                    <button className="button" disabled={!canTransact || !policy?.enabled}>
                      Grant permission
                    </button>
                  </form>
                  {grants.length ? (
                    <div className="aegis-records">
                      {grants.map((grant) => (
                        <div className="aegis-record" key={grant.id}>
                          <div>
                            <strong>
                              {grant.machineId === 'local'
                                ? 'This computer'
                                : machines.find((item) => item.id === grant.machineId)?.name ||
                                  grant.machineId}
                            </strong>
                            <span>
                              {grant.permissions === 0
                                ? 'Revoked'
                                : grant.expiresAt <= Date.now() / 1000
                                  ? 'Expired'
                                  : `${grant.permissions === 3 ? 'Run + merge' : 'Run'} · expires ${dateTime(grant.expiresAt)}`}
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
                                'Machine permission revoked on Fuji.',
                              )
                            }
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="aegis-empty">No machine permissions.</p>
                  )}
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    <GitMerge size={16} /> Merge approvals
                  </h2>
                </div>
                <div className="aegis-section-body">
                  {reviews.map((task) => (
                    <div className="aegis-record" key={task.id}>
                      <div>
                        <strong>{task.title}</strong>
                        <span>{task.branch || 'Review current changes'}</span>
                      </div>
                      <button
                        className="button compact"
                        disabled={!canTransact || !policy?.enabled}
                        onClick={() => void review(task.id)}
                      >
                        Review & approve
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
                          {action.status} ·{' '}
                          {action.expiresAt <= Date.now() / 1000
                            ? 'expired'
                            : `expires ${dateTime(action.expiresAt)}`}
                        </span>
                        <code>{short(action.sourceDigest)}</code>
                      </div>
                      {transaction(action.consumedTransactionHash || action.transactionHash)}
                    </div>
                  ))}
                  {!reviews.length && !actions.length && (
                    <p className="aegis-empty">No merge approvals.</p>
                  )}
                </div>
              </section>
              <section className="panel" data-usage="aegis-receipts">
                <div className="panel-heading">
                  <h2>
                    <FileCheck2 size={16} /> Handoff receipts
                  </h2>
                </div>
                <div className="aegis-section-body">
                  {receipts.map((receipt) => (
                    <div className="aegis-record" key={receipt.id}>
                      <div>
                        <strong>
                          {state.handoffs.find((item) => item.id === receipt.handoffId)?.summary ||
                            `Handoff ${short(receipt.handoffId)}`}
                        </strong>
                        <span>
                          {receipt.status} · {dateTime(receipt.createdAt)}
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
                                'Receipt anchored on Fuji.',
                              )
                            }
                          >
                            Anchor
                          </button>
                        )}
                        <button
                          className="icon-button"
                          aria-label={`Export receipt ${receipt.id}`}
                          disabled={!!busy}
                          onClick={() => void exportReceipt(receipt.id)}
                        >
                          <Download size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {!receipts.length && (
                    <p className="aegis-empty">
                      Receipts appear after a handoff checkpoint is recorded.
                    </p>
                  )}
                </div>
              </section>
            </>
          ) : (
            <section className="panel aegis-section-body">
              <p className="aegis-empty">
                Select a project to manage its policy, permissions and receipts.
              </p>
            </section>
          )}
          <section className="panel">
            <div className="panel-heading">
              <h2>Verify a receipt</h2>
            </div>
            <div className="aegis-section-body">
              <label className="aegis-upload">
                <Upload size={17} />
                <span>Choose receipt JSON</span>
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
                    { label: 'Content unchanged', value: verification.integrity },
                    { label: 'Valid signature', value: verification.signature },
                    { label: 'Found on Fuji', value: verification.anchored },
                    { label: 'Trusted registry', value: verification.trustedRegistry },
                  ].map((item) => (
                    <span key={item.label} className={item.value ? 'valid' : 'invalid'}>
                      {item.value ? <Check size={15} /> : <X size={15} />}
                      {item.label}
                    </span>
                  ))}
                  {verification.error && <p className="error-text">{verification.error}</p>}
                </div>
              )}
              <p className="aegis-footnote">
                A receipt verifies the recorded content and signer. It does not prove the code is
                correct or that a reported test actually ran.
              </p>
            </div>
          </section>
        </>
      )}
      {preview && (
        <FoundationDialog
          title="Approve this merge on Fuji"
          close={() => {
            if (!busy) setPreview(null);
          }}
          wide
        >
          <div className="aegis-merge-preview">
            <strong>{state.tasks.find((task) => task.id === preview.taskId)?.title}</strong>
            <pre>{preview.diff.stat}</pre>
            <pre className="aegis-diff">{preview.diff.diff || 'No changes.'}</pre>
            {preview.diff.truncated && (
              <p className="error-text">
                Diff is truncated. Review the full changes in the repository before approving.
              </p>
            )}
            <code>Source: {preview.sourceDigest}</code>
            <p>
              This authorizes the displayed revision only. Integration still happens from Reviews.
            </p>
            <button
              className="button primary"
              disabled={!!busy || preview.diff.truncated}
              onClick={() =>
                void mutate(
                  '/aegis/approve-merge',
                  { taskId: preview.taskId, payloadDigest: preview.payloadDigest },
                  'Exact revision approved on Fuji.',
                ).then((ok) => {
                  if (ok) setPreview(null);
                })
              }
            >
              {busy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}Approve
              revision
            </button>
          </div>
        </FoundationDialog>
      )}
    </div>
  );
}
