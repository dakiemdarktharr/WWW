import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  Circle,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  Hash,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldCheck,
  Square,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import type {
  CodexSession,
  CodexModel,
  Handoff,
  Member,
  Project,
  RoomMessage,
  SessionEvent,
  WorkspaceState,
} from '../shared/types';
import { api } from './api';
import { openExternal, openPreview } from './desktop';

export type FoundationRequest = <T = unknown>(
  path: string,
  body: unknown,
  method?: string,
) => Promise<T | undefined>;
interface FoundationProps {
  state: WorkspaceState;
  project?: Project;
  busy: boolean;
  request: FoundationRequest;
  selectProject: (id: string) => void;
  addProject: () => void;
  openSessions: () => void;
}
const dateTime = (value: string | number) =>
  new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString();
const clock = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const localInputTime = (value: number) => {
  const date = new Date(value);
  return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const popupSession = (id: string) => {
  window.location.hash = `session=${encodeURIComponent(id)}`;
};

function Face({ member }: { member?: Member }) {
  return (
    <span
      className="mesh-avatar"
      style={{ '--avatar-color': member?.color || '#a0a6b1' } as React.CSSProperties}
    >
      {member ? member.name.slice(0, 1).toUpperCase() : 'Y'}
    </span>
  );
}

export function FoundationDialog({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(
      () => dialog.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus(),
      20,
    );
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose.current();
      if (event.key === 'Tab') {
        const controls = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]',
          ) || []),
        ];
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className={`modal foundation-dialog ${wide ? 'wide' : ''}`}
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="foundation-dialog-title"
      >
        <div className="modal-heading">
          <h2 id="foundation-dialog-title">{title}</h2>
          <button className="icon-button" onClick={close} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function MeshPage({
  state,
  project,
  busy,
  request,
  selectProject,
  addProject,
  openSessions,
}: FoundationProps) {
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<'team' | 'usage' | 'needs' | 'handoffs' | null>(null);
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [mentions, setMentions] = useState<string[]>([]);
  const [claimMember, setClaimMember] = useState('');
  const [handoffForm, setHandoffForm] = useState(false);
  const members = state.members;
  const messages = state.messages
    .filter((message) => message.projectId === project?.id)
    .sort(
      (a, b) => (a.sequence || 0) - (b.sequence || 0) || a.createdAt.localeCompare(b.createdAt),
    );
  const requests = state.humanRequests.filter(
    (item) => item.projectId === project?.id && item.status === 'open',
  );
  const handoffs = state.handoffs.filter((item) => item.projectId === project?.id);
  const projectSessions = state.sessions.filter((session) => session.projectId === project?.id);
  const replyMessage = messages.find((message) => message.id === replyTo);
  const belongsToThread = (message: RoomMessage) => {
    if (!thread) return true;
    const visited = new Set<string>();
    let current: RoomMessage | undefined = message;
    while (current && !visited.has(current.id)) {
      if (current.id === thread) return true;
      visited.add(current.id);
      current = messages.find((item) => item.id === current?.replyTo);
    }
    return false;
  };
  const displayed = messages.filter(
    (message) =>
      belongsToThread(message) &&
      (!search ||
        `${message.content} ${members.find((member) => member.id === message.authorId)?.name || 'You'}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages.length, thread]);
  useEffect(() => {
    setThread(null);
    setReplyTo(null);
    setContent('');
    setMentions([]);
  }, [project?.id]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!content.trim() || !project) return;
    const result = await request<RoomMessage>('/mesh/messages', {
      projectId: project.id,
      content: content.trim(),
      ...(replyTo ? { replyTo } : {}),
      mentions,
    });
    if (result) {
      setContent('');
      setReplyTo(null);
      setMentions([]);
    }
  }
  return (
    <div className={`mesh-layout ${panel ? 'has-context' : ''}`}>
      <aside className="mesh-groups" aria-label="Project groups" data-usage="groups">
        <div className="mesh-groups-heading">
          <strong>Neralu</strong>
          <button className="icon-button" onClick={addProject} aria-label="Connect a project group">
            <Plus size={16} />
          </button>
        </div>
        {state.projects.map((item) => (
          <button
            key={item.id}
            className={`mesh-group ${item.id === project?.id ? 'active' : ''}`}
            onClick={() => selectProject(item.id)}
          >
            <Hash size={15} />
            <span>{item.name}</span>
            {state.humanRequests.some(
              (entry) => entry.projectId === item.id && entry.status === 'open',
            ) && <span className="group-attention" aria-label="Needs your attention" />}
          </button>
        ))}
        {!state.projects.length && (
          <button className="text-button" onClick={addProject}>
            <Plus size={14} />
            Connect project
          </button>
        )}
      </aside>
      <section className="mesh-chat panel">
        <header className="mesh-heading">
          <div>
            <Hash size={18} />
            <h1>{project?.name || 'Neralu'}</h1>
            {thread && (
              <button className="text-button" onClick={() => setThread(null)}>
                Group
                <ArrowRight size={13} />
                Thread
              </button>
            )}
          </div>
          <div className="mesh-heading-actions">
            <button
              className={`icon-button ${panel === 'team' ? 'selected' : ''}`}
              onClick={() => setPanel(panel === 'team' ? null : 'team')}
              aria-label="Group team"
              title="Team"
            >
              <Users size={16} />
            </button>
            <button
              className={`icon-button ${panel === 'usage' ? 'selected' : ''}`}
              onClick={() => setPanel(panel === 'usage' ? null : 'usage')}
              aria-label="Account usage"
              data-usage="mesh-usage"
              title="Usage"
            >
              <Circle size={16} />
            </button>
            <button
              className={`icon-button ${panel === 'needs' ? 'selected' : ''}`}
              onClick={() => setPanel(panel === 'needs' ? null : 'needs')}
              aria-label={`Needs you${requests.length ? ` (${requests.length})` : ''}`}
              title="Needs you"
              data-usage="mesh-needs"
            >
              <Bell size={16} />
              {requests.length > 0 && <span className="mini-count">{requests.length}</span>}
            </button>
            <button
              className={`icon-button ${panel === 'handoffs' ? 'selected' : ''}`}
              onClick={() => setPanel(panel === 'handoffs' ? null : 'handoffs')}
              aria-label="Project handoffs"
              data-usage="mesh-handoff"
              title="Handoffs"
            >
              <GitBranch size={16} />
            </button>
          </div>
        </header>
        <div className="mesh-search">
          <Search size={14} />
          <input
            aria-label="Search group messages"
            placeholder="Search messages"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {thread && (
            <button className="text-button" onClick={() => setThread(null)}>
              All messages
              <X size={12} />
            </button>
          )}
        </div>
        <div
          className="mesh-messages"
          ref={scroll}
          role="log"
          aria-label="Project messages"
          aria-live="polite"
        >
          {displayed.length ? (
            displayed.map((message) => {
              const member = members.find((item) => item.id === message.authorId);
              const parent = messages.find((item) => item.id === message.replyTo);
              const replies = messages.filter((item) => item.replyTo === message.id).length;
              return (
                <article
                  key={message.id}
                  className={`mesh-message message-${message.kind} ${message.humanCommand && message.authorId === null ? 'human-command' : ''}`}
                >
                  <Face member={member} />
                  <div className="mesh-message-body">
                    <div className="mesh-message-meta">
                      <strong>
                        {member?.name || (message.authorId === null ? 'You' : 'Agent')}
                      </strong>
                      {message.authorId === null && (
                        <span className="human-label">
                          <ShieldCheck size={10} />
                          Human
                        </span>
                      )}
                      {message.humanCommand && message.authorId === null && (
                        <span className="command-label">!!</span>
                      )}
                      <span className="message-kind">{message.kind}</span>
                      <time dateTime={message.createdAt} title={dateTime(message.createdAt)}>
                        {clock(message.createdAt)}
                      </time>
                    </div>
                    {parent && (
                      <button
                        className="message-reply-context"
                        onClick={() => setThread(parent.id)}
                      >
                        <Reply size={12} />
                        {parent.content.slice(0, 120)}
                      </button>
                    )}
                    <p>{message.content}</p>
                    {message.mentions?.length ? (
                      <div className="message-mentions">
                        {message.mentions.map((id) => (
                          <span key={id}>
                            @{members.find((item) => item.id === id)?.name || 'agent'}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mesh-message-tools">
                      <button
                        className="text-button"
                        onClick={() => {
                          setReplyTo(message.id);
                          document.getElementById('mesh-composer')?.focus();
                        }}
                      >
                        <Reply size={12} />
                        Reply
                      </button>
                      {replies > 0 && (
                        <button className="text-button" onClick={() => setThread(message.id)}>
                          <MessageSquare size={12} />
                          {replies} {replies === 1 ? 'reply' : 'replies'}
                        </button>
                      )}
                      {message.requestStatus === 'claimed' && (
                        <span className="claimed-label">
                          <Check size={11} />
                          {members.find((item) => item.id === message.claimedBy)?.name ||
                            'Agent'}{' '}
                          claimed
                        </span>
                      )}
                      {message.requestStatus === 'done' && (
                        <span className="claimed-label">
                          <Check size={11} />
                          Done
                        </span>
                      )}
                      {message.requestStatus === 'open' && (
                        <div className="claim-control">
                          <select
                            aria-label={`Assign request ${message.sequence || message.id}`}
                            value={claimMember}
                            onChange={(event) => setClaimMember(event.target.value)}
                          >
                            <option value="">Assign account</option>
                            {members.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="text-button accent"
                            disabled={busy || !claimMember}
                            onClick={() =>
                              void request(`/mesh/messages/${message.id}/claim`, {
                                memberId: claimMember,
                              })
                            }
                          >
                            Claim
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="foundation-empty">
              <MessageSquare size={24} />
              <span>{search ? 'No matching messages' : 'No messages'}</span>
            </div>
          )}
        </div>
        <form className="mesh-composer" onSubmit={send}>
          {replyMessage && (
            <div className="composer-reply">
              <Reply size={13} />
              <span>{replyMessage.content.slice(0, 100)}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
              >
                <X size={13} />
              </button>
            </div>
          )}
          <label className="sr-only" htmlFor="mesh-composer">
            Message the project team
          </label>
          <textarea
            id="mesh-composer"
            data-usage="mesh-input"
            rows={3}
            maxLength={10000}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={
              project ? `Message #${project.name}` : 'Connect a project to message the team'
            }
            disabled={!project}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter')
                event.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="mesh-composer-actions">
            <div className="composer-mentions">
              <select
                aria-label="Mention a teammate"
                value=""
                disabled={!project || !members.length}
                onChange={(event) => {
                  if (event.target.value && !mentions.includes(event.target.value))
                    setMentions([...mentions, event.target.value]);
                }}
              >
                <option value="">@ Mention</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
              {mentions.map((id) => (
                <button
                  type="button"
                  key={id}
                  className="mention-chip"
                  onClick={() => setMentions(mentions.filter((item) => item !== id))}
                >
                  @{members.find((item) => item.id === id)?.name}
                  <X size={10} />
                </button>
              ))}
            </div>
            <button
              className="button primary"
              disabled={!project || !content.trim() || busy}
              type="submit"
            >
              <Send size={14} />
              Send
            </button>
          </div>
        </form>
      </section>
      {panel && (
        <aside className="mesh-context panel">
          <div className="mesh-context-heading">
            <h2>
              {panel === 'needs'
                ? 'Needs you'
                : panel === 'usage'
                  ? 'Account usage'
                  : panel === 'handoffs'
                    ? 'Handoffs'
                    : 'Team'}
            </h2>
            <button
              className="icon-button"
              onClick={() => setPanel(null)}
              aria-label="Close context panel"
            >
              <X size={16} />
            </button>
          </div>
          {panel === 'team' && (
            <div className="mesh-context-content">
              {members.length ? (
                members.map((member) => {
                  const cursor = state.meshCursors.find(
                    (entry) => entry.memberId === member.id && entry.projectId === project?.id,
                  );
                  const unread = messages.filter(
                    (message) => (message.sequence || 0) > (cursor?.readThrough || 0),
                  ).length;
                  const active = projectSessions.filter(
                    (session) =>
                      session.memberId === member.id &&
                      ['running', 'starting'].includes(session.status),
                  );
                  return (
                    <section className="mesh-member" key={member.id}>
                      <div className="mesh-member-heading">
                        <Face member={member} />
                        <strong>{member.name}</strong>
                        <span className={`presence ${member.status}`} title={member.status} />
                      </div>
                      <div className="mesh-member-meta">
                        <span>{member.role}</span>
                        <span>{member.account?.planType || 'Plan unknown'}</span>
                      </div>
                      {member.owner && (
                        <span className="mesh-owner">Owner: {member.owner.login}</span>
                      )}
                      <div className="mesh-member-meta">
                        <span>{active.length} active sessions</span>
                        <span>{unread} unread</span>
                      </div>
                      <div className="mesh-read-cursor">
                        <span>Read {cursor?.readThrough || 0}</span>
                        <span>Acknowledged {cursor?.acknowledgedThrough || 0}</span>
                      </div>
                    </section>
                  );
                })
              ) : (
                <div className="foundation-empty">No accounts</div>
              )}
              <button className="button" onClick={openSessions}>
                <Terminal size={14} />
                Open sessions
              </button>
            </div>
          )}
          {panel === 'usage' && (
            <div className="mesh-context-content">
              {members.map((member) => (
                <QuotaCard
                  key={member.id}
                  member={member}
                  project={project}
                  state={state}
                  busy={busy}
                  request={request}
                />
              ))}
            </div>
          )}
          {panel === 'needs' && (
            <div className="mesh-context-content">
              {requests.length ? (
                requests.map((item) => (
                  <section className="human-request" key={item.id}>
                    <span className="event-type">{item.kind}</span>
                    <h3>{item.title}</h3>
                    <p>{item.content}</p>
                    <time>{dateTime(item.createdAt)}</time>
                    <button
                      className="button compact"
                      disabled={busy}
                      onClick={() => void request(`/requests/${item.id}/resolve`, {})}
                    >
                      <Check size={12} />
                      Resolve
                    </button>
                  </section>
                ))
              ) : (
                <div className="foundation-empty">
                  <Check size={22} />
                  <span>No open requests</span>
                </div>
              )}
            </div>
          )}
          {panel === 'handoffs' && (
            <div className="mesh-context-content">
              <button
                className="button"
                onClick={() => setHandoffForm(true)}
                disabled={!project || !projectSessions.length}
              >
                <Plus size={14} />
                Prepare handoff
              </button>
              {handoffs.length ? (
                [...handoffs]
                  .reverse()
                  .map((item) => (
                    <HandoffCard
                      key={item.id}
                      item={item}
                      state={state}
                      busy={busy}
                      request={request}
                    />
                  ))
              ) : (
                <div className="foundation-empty">
                  <GitBranch size={22} />
                  <span>No handoffs</span>
                </div>
              )}
            </div>
          )}
        </aside>
      )}
      {handoffForm && project && (
        <HandoffForm
          state={state}
          project={project}
          busy={busy}
          request={request}
          close={() => setHandoffForm(false)}
        />
      )}
    </div>
  );
}

export function QuotaCard({
  member,
  project,
  state,
  busy,
  request,
}: {
  member: Member;
  project?: Project;
  state: WorkspaceState;
  busy: boolean;
  request: FoundationRequest;
}) {
  const [grant, setGrant] = useState(false);
  const quota = state.quotas.find((entry) => entry.memberId === member.id);
  const grants = state.quotaGrants.filter(
    (entry) =>
      entry.memberId === member.id &&
      !entry.revokedAt &&
      new Date(entry.expiresAt).getTime() > Date.now(),
  );
  return (
    <section className="quota-card">
      <div className="quota-card-heading">
        <strong>{member.name}</strong>
        <span className={`quota-state ${quota?.status || 'unknown'}`}>
          {quota?.status || 'unknown'}
        </span>
        <button
          className="icon-button"
          disabled={busy}
          aria-label={`Refresh ${member.name} quota`}
          onClick={() => void request(`/members/${member.id}/quota/refresh`, {})}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {quota?.windows.length ? (
        quota.windows.map((window) => (
          <div className="quota-window" key={window.id}>
            <div>
              <span>{window.label}</span>
              <strong>{Math.round(window.remainingPercent)}% left</strong>
            </div>
            <meter
              min={0}
              max={100}
              low={50}
              optimum={100}
              value={window.remainingPercent}
              aria-label={`${member.name} ${window.label} quota remaining`}
            />
            <span className="quota-reset">
              {window.resetsAt ? `Reset ${dateTime(window.resetsAt)}` : 'Reset unknown'}
            </span>
          </div>
        ))
      ) : (
        <span className="quota-unknown">Usage not available</span>
      )}
      {quota?.observedAt && (
        <time className="quota-observed">Read {dateTime(quota.observedAt)}</time>
      )}
      {quota?.error && <p className="error-text">{quota.error}</p>}
      {grants.map((item) => (
        <div className="quota-grant" key={item.id}>
          <span>
            {state.projects.find((p) => p.id === item.projectId)?.name || 'Project'} · floor{' '}
            {item.floor}%<small>Until {dateTime(item.expiresAt)}</small>
          </span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void request(`/quota/grants/${item.id}/revoke`, {})}
          >
            Revoke
          </button>
        </div>
      ))}
      <button className="text-button" disabled={!project} onClick={() => setGrant(!grant)}>
        {grant ? 'Close reserve permission' : 'Allow reserve usage'}
        <ChevronDown size={12} />
      </button>
      {grant && project && (
        <form
          className="quota-grant-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const result = await request(`/members/${member.id}/quota/grants`, {
              projectId: project.id,
              floor: Number(data.get('floor')),
              expiresAt: new Date(String(data.get('until'))).toISOString(),
            });
            if (result) setGrant(false);
          }}
        >
          <label>
            Minimum remaining %
            <input name="floor" type="number" required min={0} max={49} defaultValue={25} />
          </label>
          <label>
            Allow until
            <input
              name="until"
              type="datetime-local"
              required
              min={localInputTime(Date.now() + 60000)}
              defaultValue={localInputTime(Date.now() + 60 * 60 * 1000)}
            />
          </label>
          <span className="grant-project">Only #{project.name}</span>
          <button className="button compact" disabled={busy}>
            Grant permission
          </button>
        </form>
      )}
    </section>
  );
}

function HandoffCard({
  item,
  state,
  busy,
  request,
}: {
  item: Handoff;
  state: WorkspaceState;
  busy: boolean;
  request: FoundationRequest;
}) {
  const source = state.sessions.find((session) => session.id === item.fromSessionId);
  return (
    <section className="handoff-card">
      <div className="handoff-heading">
        <strong>
          {state.members.find((member) => member.id === source?.memberId)?.name || 'Session'}
          <ArrowRight size={12} />
          {state.members.find((member) => member.id === item.toMemberId)?.name || 'Recipient'}
        </strong>
        <span className={`quota-state ${item.status}`}>{item.status.replaceAll('_', ' ')}</span>
      </div>
      <p>{item.summary}</p>
      {item.branch && (
        <span className="handoff-commit">
          <GitBranch size={12} />
          {item.branch}
        </span>
      )}
      {item.commitSha && (
        <span className="handoff-commit">
          <GitCommitHorizontal size={12} />
          {item.commitSha}
        </span>
      )}
      <details>
        <summary>
          Next steps & evidence
          <ChevronDown size={12} />
        </summary>
        <h4>Next steps</h4>
        <p>{item.nextSteps}</p>
        <h4>Tests</h4>
        <p>{item.testEvidence}</p>
        <h4>Quota at checkpoint</h4>
        <p>
          {item.quota?.windows
            .map(
              (window) =>
                `${window.label}: ${Math.round(window.remainingPercent)}% left${window.resetsAt ? `, reset ${dateTime(window.resetsAt)}` : ', reset unknown'}`,
            )
            .join('\n') || 'Unknown'}
        </p>
      </details>
      {item.error && <p className="error-text">{item.error}</p>}
      <div className="handoff-actions">
        {['blocked', 'awaiting_ack'].includes(item.status) && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Cancel this handoff and keep the work with the source account?'))
                void request(`/handoffs/${item.id}/cancel`, {});
            }}
          >
            Cancel handoff
          </button>
        )}
        {item.status === 'blocked' && (
          <button
            className="button compact"
            disabled={busy}
            onClick={() => void request(`/handoffs/${item.id}/retry`, {})}
          >
            <RefreshCw size={12} />
            Retry checkpoint
          </button>
        )}
        {item.status === 'awaiting_ack' && (
          <button
            className="button compact primary"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'Acknowledge this checkpoint for the recipient? The recipient session will remain paused until you resume it.',
                )
              )
                void request(`/handoffs/${item.id}/accept`, {});
            }}
          >
            <Check size={12} />
            Acknowledge & accept
          </button>
        )}
        {item.toSessionId && (
          <button className="text-button" onClick={() => popupSession(item.toSessionId!)}>
            <Terminal size={12} />
            Open recipient
            <ExternalLink size={11} />
          </button>
        )}
      </div>
    </section>
  );
}

export function HandoffForm({
  state,
  project,
  busy,
  request,
  close,
  sessionId,
}: {
  state: WorkspaceState;
  project: Project;
  busy: boolean;
  request: FoundationRequest;
  close: () => void;
  sessionId?: string;
}) {
  const sessions = state.sessions.filter(
    (session) =>
      session.projectId === project.id &&
      !session.readOnly &&
      !['stopped', 'handoff'].includes(session.status),
  );
  const [source, setSource] = useState(sessionId || sessions[0]?.id || '');
  const selected = sessions.find((session) => session.id === source);
  return (
    <FoundationDialog title="Prepare handoff" close={close}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const result = await request<Handoff>('/handoffs', {
            sessionId: source,
            toMemberId: data.get('recipient'),
            summary: data.get('summary'),
            nextSteps: data.get('nextSteps'),
            testEvidence: data.get('testEvidence'),
          });
          if (result) close();
        }}
      >
        <label>
          Source session
          <select value={source} onChange={(event) => setSource(event.target.value)} required>
            <option value="">Choose session</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title} ·{' '}
                {state.members.find((member) => member.id === session.memberId)?.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Recipient account
          <select name="recipient" required defaultValue="">
            <option value="">Choose account</option>
            {state.members
              .filter((member) => member.id !== selected?.memberId)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Progress summary
          <textarea name="summary" required maxLength={6000} rows={3} />
        </label>
        <label>
          Next steps
          <textarea name="nextSteps" required maxLength={10000} rows={4} />
        </label>
        <label>
          Test evidence
          <textarea
            name="testEvidence"
            required
            maxLength={10000}
            rows={3}
            placeholder="Commands, results and known failures"
          />
        </label>
        <div className="foundation-notice">
          <GitBranch size={14} />
          Stops the source, commits progress and verifies the push before transfer.
        </div>
        <button className="button primary" disabled={busy || !source}>
          Checkpoint & hand off
          <ArrowRight size={14} />
        </button>
      </form>
    </FoundationDialog>
  );
}

export function AccountSettings({
  member,
  busy,
  request,
}: {
  member: Member;
  busy: boolean;
  request: FoundationRequest;
}) {
  const [open, setOpen] = useState(false);
  const [ownerLogin, setOwnerLogin] = useState(member.owner?.login || '');
  return (
    <div className="account-foundation-settings">
      <button className="text-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Users size={13} />
        Owner & session limits
        <ChevronDown size={12} />
      </button>
      {open && (
        <form
          className="form compact-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const login = String(data.get('login') || '').trim();
            const owner = login
              ? {
                  login,
                  name: String(data.get('ownerName') || '').trim(),
                  email: String(data.get('email') || '').trim(),
                }
              : undefined;
            const result = await request(
              `/members/${member.id}`,
              { maxSessions: Number(data.get('maxSessions')), ...(owner ? { owner } : {}) },
              'PATCH',
            );
            if (result) setOpen(false);
          }}
        >
          <label>
            Concurrent sessions
            <input
              name="maxSessions"
              type="number"
              min={1}
              max={8}
              required
              defaultValue={member.maxSessions || 2}
            />
          </label>
          <label>
            GitHub owner
            <input
              name="login"
              maxLength={39}
              pattern="[a-zA-Z0-9][a-zA-Z0-9-]{0,38}"
              value={ownerLogin}
              onChange={(event) => setOwnerLogin(event.target.value)}
              placeholder="GitHub login"
            />
          </label>
          <label>
            Commit author name
            <input
              name="ownerName"
              maxLength={100}
              required={!!ownerLogin.trim()}
              defaultValue={member.owner?.name || ''}
            />
          </label>
          <label>
            Author email / GitHub noreply
            <input
              name="email"
              type="email"
              maxLength={200}
              required={!!ownerLogin.trim()}
              defaultValue={member.owner?.email || ''}
            />
          </label>
          <button className="button compact" disabled={busy}>
            Save account settings
          </button>
        </form>
      )}
    </div>
  );
}

export function SessionsPage({
  state,
  project,
  busy,
  request,
  addProject,
  focusedId,
}: Omit<FoundationProps, 'selectProject' | 'openSessions'> & { focusedId?: string }) {
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('all');
  const [handoffSession, setHandoffSession] = useState<string | null>(null);
  const [demo, setDemo] = useState('');
  const [demoEdit, setDemoEdit] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const sessions = state.sessions.filter((session) =>
    focusedId
      ? session.id === focusedId
      : session.projectId === project?.id && (filter === 'all' || session.memberId === filter),
  );
  const focusedProject = focusedId
    ? state.projects.find((item) => item.id === sessions[0]?.projectId)
    : project;
  useEffect(() => {
    setPreviewUrl('');
    try {
      setDemo(localStorage.getItem(`relay-demo-${focusedProject?.id}`) || '');
    } catch {
      setDemo('');
    }
  }, [focusedProject?.id]);
  const openDemo = () => {
    try {
      const url = new URL(demo);
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      const allowed =
        url.protocol === 'https:' ||
        (state.runtime.deployment !== 'cloud' && local && url.protocol === 'http:' && !!url.port);
      if (
        !allowed ||
        url.username ||
        url.password ||
        url.origin === location.origin ||
        (local && [Number(location.port), 4317, 4321, 5173].includes(Number(url.port)))
      )
        throw new Error('Use an HTTPS demo or a local development server on a separate port.');
      if (focusedProject) localStorage.setItem(`relay-demo-${focusedProject.id}`, url.href);
      setPreviewUrl(url.href);
      setDemoError('');
      setDemoEdit(false);
    } catch (error) {
      setDemoError((error as Error).message || 'Enter a valid local demo URL.');
      setDemoEdit(true);
    }
  };
  return (
    <div className={`sessions-layout ${focusedId ? 'focused-session' : ''}`}>
      <div className="page-heading">
        <h1>{focusedId ? sessions[0]?.title || 'Session' : 'Sessions'}</h1>
        <div className="heading-actions">
          {focusedId && (
            <button
              className="button"
              onClick={() => {
                location.hash = 'sessions';
              }}
            >
              All sessions
            </button>
          )}
          <button
            className="button"
            onClick={() => (demo ? openDemo() : setDemoEdit(true))}
            data-usage="demo"
            disabled={!focusedProject}
          >
            <ExternalLink size={14} />
            Demo
          </button>
          <button
            className="icon-button"
            onClick={() => setDemoEdit(!demoEdit)}
            aria-label="Configure demo URL"
            disabled={!focusedProject}
          >
            <MoreHorizontal size={16} />
          </button>
          {!focusedId && (
            <button
              className="button primary"
              disabled={!project || busy || !state.members.length}
              onClick={() => setCreating(true)}
              data-usage="new-session"
            >
              <Plus size={14} />
              New session
            </button>
          )}
        </div>
      </div>
      {demoEdit && (
        <form
          className="demo-url-form panel"
          onSubmit={(event) => {
            event.preventDefault();
            openDemo();
          }}
        >
          <label htmlFor="local-demo-url">Demo URL</label>
          <input
            id="local-demo-url"
            type="url"
            value={demo}
            onChange={(event) => setDemo(event.target.value)}
            required
            placeholder="http://127.0.0.1:3000"
          />
          <button className="button compact">
            Open demo
            <ExternalLink size={12} />
          </button>
          {demoError && (
            <span className="error-text" role="alert">
              {demoError}
            </span>
          )}
        </form>
      )}
      {previewUrl && (
        <section className="panel session-preview" aria-label="Project demo">
          <header>
            <strong>Preview</strong>
            <span>{previewUrl}</span>
            <button
              className="icon-button"
              aria-label="Reload preview"
              onClick={() => {
                const url = previewUrl;
                setPreviewUrl('');
                setTimeout(() => setPreviewUrl(url), 0);
              }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="icon-button"
              aria-label="Open demo in browser"
              onClick={() =>
                void openPreview(previewUrl).catch((error) => setDemoError(error.message))
              }
            >
              <ExternalLink size={14} />
            </button>
            <button
              className="icon-button"
              aria-label="Close preview"
              onClick={() => setPreviewUrl('')}
            >
              <X size={14} />
            </button>
          </header>
          <iframe
            title="Project preview"
            src={previewUrl}
            sandbox="allow-scripts allow-forms allow-same-origin"
            referrerPolicy="no-referrer"
          />
          <footer>Site refusing to display? Open it in your browser using the arrow above.</footer>
        </section>
      )}
      {!focusedId && (
        <div className="session-filter">
          <select
            aria-label="Filter sessions by account"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All accounts</option>
            {state.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <span>{sessions.length} sessions</span>
        </div>
      )}
      {sessions.length ? (
        <div className="session-grid" data-usage="session-grid">
          {sessions.map((session) => (
            <SessionConsole
              key={session.id}
              session={session}
              state={state}
              busy={busy}
              request={request}
              focused={!!focusedId}
              handoff={() => setHandoffSession(session.id)}
            />
          ))}
        </div>
      ) : (
        <section className="panel foundation-empty session-empty">
          <Terminal size={28} />
          <span>{focusedId ? 'Session not found' : 'No sessions'}</span>
          {!focusedId && (
            <button
              className="button"
              onClick={project ? () => setCreating(true) : addProject}
              disabled={!!project && !state.members.length}
            >
              <Plus size={14} />
              {project ? 'New session' : 'Connect project'}
            </button>
          )}
        </section>
      )}
      {creating && project && (
        <CreateSession
          state={state}
          project={project}
          busy={busy}
          request={request}
          close={() => setCreating(false)}
        />
      )}
      {handoffSession && focusedProject && (
        <HandoffForm
          state={state}
          project={focusedProject}
          busy={busy}
          request={request}
          close={() => setHandoffSession(null)}
          sessionId={handoffSession}
        />
      )}
    </div>
  );
}

function CreateSession({
  state,
  project,
  busy,
  request,
  close,
}: {
  state: WorkspaceState;
  project: Project;
  busy: boolean;
  request: FoundationRequest;
  close: () => void;
}) {
  const [readOnly, setReadOnly] = useState(true);
  const [taskId, setTaskId] = useState('');
  const [memberId, setMemberId] = useState(project.ownerMemberId || '');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [automatic, setAutomatic] = useState(true);
  return (
    <FoundationDialog title="New Codex session" close={close}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const result = await request<CodexSession>('/sessions', {
            memberId: data.get('memberId'),
            projectId: project.id,
            title: data.get('title'),
            readOnly,
            prompt: data.get('prompt'),
            model: model || null,
            reasoningEffort: effort || null,
            modelPolicy: automatic ? 'auto' : 'manual',
            ...(taskId
              ? { taskId }
              : {
                  scope: String(data.get('scope') || '.')
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                }),
          });
          if (result) close();
        }}
      >
        <label>
          Account
          <select
            name="memberId"
            required
            value={memberId}
            onChange={(event) => {
              setMemberId(event.target.value);
              setModel('');
              setEffort('');
            }}
          >
            <option value="">Choose Codex account</option>
            {state.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.account ? '' : ' · reconnect required'}
              </option>
            ))}
          </select>
        </label>
        <label className="foundation-checkbox">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(event) => setAutomatic(event.target.checked)}
          />
          Automatic model and reasoning
        </label>
        {!automatic && (
          <ModelFields
            memberId={memberId}
            model={model}
            effort={effort}
            change={(m, e) => {
              setModel(m);
              setEffort(e);
            }}
          />
        )}
        <label>
          Session title
          <input
            name="title"
            maxLength={200}
            required
            placeholder="Research, implementation, review…"
          />
        </label>
        <label>
          Task
          <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
            <option value="">Create a session task</option>
            {state.tasks
              .filter(
                (task) =>
                  task.projectId === project.id &&
                  ['ready', 'backlog'].includes(task.status) &&
                  !task.workflowId,
              )
              .map((task) => (
                <option value={task.id} key={task.id}>
                  {task.title}
                </option>
              ))}
          </select>
        </label>
        <label className="foundation-checkbox">
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(event) => setReadOnly(event.target.checked)}
          />
          Read-only repository access
        </label>
        {!readOnly && !taskId && (
          <label>
            Owned scopes
            <input
              name="scope"
              required
              maxLength={3000}
              placeholder="src/ui, tests/ui"
              defaultValue="."
            />
          </label>
        )}
        <label>
          Prompt
          <textarea
            name="prompt"
            maxLength={16000}
            rows={5}
            placeholder="Optional — send a prompt when ready"
          />
        </label>
        <div className="foundation-notice">
          <Terminal size={14} />
          Uses this account's Codex usage.
        </div>
        <button className="button primary" disabled={busy}>
          <Play size={14} />
          Create session
        </button>
      </form>
    </FoundationDialog>
  );
}

function ModelFields({
  memberId,
  model,
  effort,
  change,
}: {
  memberId: string;
  model: string;
  effort: string;
  change: (model: string, effort: string) => void;
}) {
  const [models, setModels] = useState<CodexModel[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setError('');
    if (!memberId) return;
    setLoading(true);
    api<CodexModel[]>(`/members/${memberId}/models`)
      .then((data) => {
        if (!cancelled) setModels(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [memberId]);
  const selected =
    models.find((item) => item.model === model) || models.find((item) => item.isDefault);
  return (
    <>
      <label>
        Model
        <select
          value={model}
          disabled={loading || !models.length}
          onChange={(event) => change(event.target.value, '')}
        >
          <option value="">Account default</option>
          {model && !models.some((item) => item.model === model) && (
            <option value={model}>{model}</option>
          )}
          {models.map((item) => (
            <option key={item.id} value={item.model}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reasoning
        <select
          value={effort}
          disabled={loading || !selected}
          onChange={(event) => change(model, event.target.value)}
        >
          <option value="">Model default</option>
          {selected?.supportedReasoningEfforts.map((item) => (
            <option key={item.reasoningEffort} value={item.reasoningEffort}>
              {item.reasoningEffort}
            </option>
          ))}
        </select>
      </label>
      {loading && <p role="status">Loading account models…</p>}
      {error && (
        <p className="error-text" role="status">
          {error}
        </p>
      )}
    </>
  );
}

function SessionSettings({
  session,
  request,
  close,
}: {
  session: CodexSession;
  request: FoundationRequest;
  close: () => void;
}) {
  const [model, setModel] = useState(session.model || '');
  const [effort, setEffort] = useState(session.reasoningEffort || '');
  const [automatic, setAutomatic] = useState(session.modelPolicy === 'auto');
  const [saving, setSaving] = useState(false);
  return (
    <FoundationDialog title="Conversation settings" close={close}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try {
            if (
              await request(
                `/sessions/${session.id}/config`,
                {
                  model: automatic ? null : model || null,
                  reasoningEffort: automatic ? null : effort || null,
                  modelPolicy: automatic ? 'auto' : 'manual',
                },
                'PATCH',
              )
            )
              close();
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="foundation-checkbox">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(event) => setAutomatic(event.target.checked)}
          />
          Automatic model and reasoning
        </label>
        {!automatic && (
          <ModelFields
            memberId={session.memberId}
            model={model}
            effort={effort}
            change={(m, e) => {
              setModel(m);
              setEffort(e);
            }}
          />
        )}
        <button className="button primary" disabled={saving}>
          Save settings
        </button>
      </form>
    </FoundationDialog>
  );
}

function SessionConsole({
  session,
  state,
  busy,
  request,
  focused,
  handoff,
}: {
  session: CodexSession;
  state: WorkspaceState;
  busy: boolean;
  request: FoundationRequest;
  focused: boolean;
  handoff: () => void;
}) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [eventError, setEventError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [confirmedStopped, setConfirmedStopped] = useState(false);
  const [settings, setSettings] = useState(false);
  const output = useRef<HTMLDivElement>(null);
  const member = state.members.find((item) => item.id === session.memberId);
  const task = state.tasks.find((item) => item.id === session.taskId);
  const approvals = state.approvals.filter((item) => item.taskId === session.taskId);
  const running = ['running', 'starting'].includes(session.status);
  const pendingHandoff = state.handoffs.find(
    (handoff) =>
      handoff.taskId === session.taskId &&
      ['checkpointing', 'blocked', 'awaiting_ack'].includes(handoff.status),
  );
  const canSend =
    !pendingHandoff && ['idle', 'paused', 'review', 'running'].includes(session.status);
  const needsRecovery = session.status === 'interrupted';
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const data = await api<SessionEvent[]>(`/sessions/${session.id}/events`);
        if (!cancelled) {
          setEvents(data);
          setEventError('');
        }
      } catch (error) {
        if (!cancelled) setEventError((error as Error).message);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session.id]);
  useEffect(() => {
    output.current?.scrollTo({ top: output.current.scrollHeight });
  }, [events.length, events.at(-1)?.text]);
  return (
    <section className={`session-console panel ${running ? 'is-running' : ''}`}>
      <header className="session-console-heading">
        <Terminal size={15} />
        <h2>{session.title}</h2>
        <span className={`session-status ${session.status}`}>{session.status}</span>
        {!focused && (
          <button
            className="icon-button"
            aria-label={`Focus ${session.title}`}
            title="Focus session"
            onClick={() => popupSession(session.id)}
          >
            <Maximize2 size={13} />
          </button>
        )}
      </header>
      <div className="session-runtime">
        <Face member={member} />
        <strong>{member?.name || 'Account'}</strong>
        <span>{session.readOnly ? 'Read only' : 'Workspace write'}</span>
        <span>
          {session.model || 'Account default'}
          {session.reasoningEffort ? ` · ${session.reasoningEffort}` : ''}
        </span>
        {['idle', 'paused', 'review'].includes(session.status) && (
          <button className="text-button" onClick={() => setSettings(true)}>
            Model settings
          </button>
        )}
        {session.pid && <span>PID {session.pid}</span>}
        <details>
          <summary>
            Details
            <ChevronDown size={11} />
          </summary>
          <dl>
            {session.selectionReason && (
              <>
                <dt>Model choice</dt>
                <dd>{session.selectionReason}</dd>
              </>
            )}
            <dt>Thread</dt>
            <dd>{session.threadId || 'Not started'}</dd>
            <dt>Task</dt>
            <dd>{task?.title || session.taskId}</dd>
            <dt>Worktree</dt>
            <dd>{task?.worktree || 'Read-only repository'}</dd>
            <dt>Scopes</dt>
            <dd>{task?.scope.join(', ') || 'Read only'}</dd>
          </dl>
        </details>
      </div>
      {settings && (
        <SessionSettings session={session} request={request} close={() => setSettings(false)} />
      )}
      <div
        className="session-output"
        ref={output}
        role="log"
        aria-label={`${session.title} output`}
        aria-live="off"
      >
        {events.length ? (
          events.map((event) => (
            <article className={`session-event output-${event.kind}`} key={event.id}>
              <div>
                <span>
                  {event.kind === 'user'
                    ? 'You'
                    : event.kind === 'agent'
                      ? member?.name || 'Codex'
                      : event.kind}
                </span>
                <time title={dateTime(event.createdAt)}>{clock(event.createdAt)}</time>
              </div>
              <pre>{event.text}</pre>
            </article>
          ))
        ) : (
          <div className="session-output-empty">
            {running ? 'Waiting for Codex events…' : 'No recorded output'}
          </div>
        )}
      </div>
      {(session.error || eventError) && (
        <div className="session-error" role="alert">
          {session.error || eventError}
        </div>
      )}
      {pendingHandoff && (
        <div className="session-handoff-status">
          <GitBranch size={13} />
          Handoff {pendingHandoff.status.replaceAll('_', ' ')} · source scope remains reserved
        </div>
      )}
      {approvals.map((approval) => (
        <div className="session-approval" key={approval.id}>
          <ShieldCheck size={15} />
          <span>{approval.description}</span>
          <button
            className="button compact"
            disabled={busy}
            onClick={() => void request(`/approvals/${approval.id}`, { decision: 'decline' })}
          >
            Decline
          </button>
          <button
            className="button compact primary"
            disabled={busy}
            onClick={() => void request(`/approvals/${approval.id}`, { decision: 'accept' })}
          >
            Approve
          </button>
        </div>
      ))}
      {needsRecovery && (
        <div className="session-recovery">
          <label className="foundation-checkbox">
            <input
              type="checkbox"
              checked={confirmedStopped}
              onChange={(event) => setConfirmedStopped(event.target.checked)}
            />
            I verified the previous worker has stopped.
          </label>
          <button
            className="button compact"
            disabled={busy || !confirmedStopped}
            onClick={() =>
              void request(`/sessions/${session.id}/recover`, { confirmedStopped: true })
            }
          >
            <RefreshCw size={12} />
            Recover session
          </button>
        </div>
      )}
      <form
        className="session-input"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!prompt.trim()) return;
          const result = await request<CodexSession>(`/sessions/${session.id}/send`, {
            prompt: prompt.trim(),
          });
          if (result) setPrompt('');
        }}
      >
        <label className="sr-only" htmlFor={`session-input-${session.id}`}>
          Message {session.title}
        </label>
        <textarea
          id={`session-input-${session.id}`}
          data-usage="session-input"
          rows={2}
          value={prompt}
          maxLength={16000}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={
            session.status === 'running'
              ? 'Steer the current Codex turn…'
              : canSend
                ? 'Continue this session…'
                : 'Resume or recover this session to continue'
          }
          disabled={busy || !canSend}
        />
        <div className="session-input-actions">
          <div>
            {running && (
              <button
                className="button compact"
                disabled={busy || !!pendingHandoff}
                type="button"
                onClick={() => void request(`/sessions/${session.id}/pause`, {})}
              >
                <Pause size={12} />
                Pause
              </button>
            )}
            {running && (
              <button
                className="button compact"
                disabled={busy}
                type="button"
                onClick={() => void request(`/sessions/${session.id}/stop`, {})}
              >
                <Square size={12} />
                Stop
              </button>
            )}
            {!pendingHandoff && ['paused', 'stopped', 'error'].includes(session.status) && (
              <button
                className="button compact"
                disabled={busy}
                type="button"
                onClick={() => void request(`/sessions/${session.id}/resume`, {})}
              >
                <Play size={12} />
                Resume
              </button>
            )}
            {!pendingHandoff &&
              !session.readOnly &&
              !['stopped', 'handoff'].includes(session.status) && (
                <button className="text-button" disabled={busy} type="button" onClick={handoff}>
                  <GitBranch size={12} />
                  Handoff
                </button>
              )}
          </div>
          <button className="button compact primary" disabled={busy || !canSend || !prompt.trim()}>
            <Send size={13} />
            {session.status === 'running' ? 'Steer' : 'Send'}
          </button>
        </div>
      </form>
    </section>
  );
}
