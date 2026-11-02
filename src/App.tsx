import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDot,
  Code2,
  Copy,
  Cpu,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitMerge,
  Layers3,
  LayoutGrid,
  ListTodo,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  Users,
  X,
  Zap,
  AlertTriangle,
  Palette,
  FlaskConical,
  PanelLeftClose,
} from 'lucide-react';
import type {
  Approval,
  LoginResult,
  Member,
  Project,
  Task,
  TaskDiff,
  TaskStatus,
  WorkspaceState,
  Workflow,
} from '../shared/types';
import { api } from './api';
import Workroom from './Workroom';

type View = 'workroom' | 'tasks' | 'team' | 'reviews' | 'settings';
type ModalState =
  | { type: 'member' | 'project' | 'task' | 'search' }
  | { type: 'detail'; taskId: string }
  | { type: 'login'; memberId: string; result: LoginResult }
  | { type: 'setup'; memberId: string; home: string; instructions: string }
  | null;
const nav = [
  { id: 'workroom', label: 'Workroom', icon: LayoutGrid },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'reviews', label: 'Reviews', icon: GitMerge },
] as const;
const roleIcons = {
  engineer: Code2,
  researcher: FlaskConical,
  designer: Palette,
  reviewer: ShieldCheck,
};
const kindIcons = { code: Code2, research: FlaskConical, design: Palette, review: ShieldCheck };
const statusNames: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  running: 'In progress',
  review: 'In review',
  done: 'Done',
  blocked: 'Blocked',
};
const colors = ['#b8ee86', '#a6baff', '#e8b07d', '#bba6e4', '#7ccfc3', '#dc91af'];
const relative = (date: string) => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  return m < 1
    ? 'just now'
    : m < 60
      ? `${m}m ago`
      : m < 1440
        ? `${Math.floor(m / 60)}h ago`
        : `${Math.floor(m / 1440)}d ago`;
};
const shortId = (id: string) =>
  `RLY-${id
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 5)
    .toUpperCase()}`;
const validAuthUrl = (url?: string) => {
  try {
    const parsed = new URL(url || '');
    return parsed.protocol === 'https:' &&
      (parsed.hostname === 'openai.com' || parsed.hostname.endsWith('.openai.com'))
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
};

function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? 'small' : ''}`}>
      <img src="/relay.svg" alt="" />
      <span>
        relay<span className="brand-period">.</span>
      </span>
    </span>
  );
}
function Avatar({ member, size = '' }: { member?: Member; size?: string }) {
  const Icon = member ? roleIcons[member.role] : Cpu;
  return (
    <span
      className={`avatar ${size}`}
      style={member ? ({ '--avatar-color': member.color } as React.CSSProperties) : undefined}
    >
      <Icon size={size === 'large' ? 24 : 16} />
    </span>
  );
}
function Badge({ status }: { status: TaskStatus | Member['status'] }) {
  return (
    <span className={`badge ${status}`}>
      <span />
      {status in statusNames
        ? statusNames[status as TaskStatus]
        : status === 'ready'
          ? 'Connected'
          : status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}
function Empty({
  icon: Icon,
  title,
  action,
}: {
  icon: typeof Users;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={22} />
      </span>
      <h3>{title}</h3>
      {action}
    </div>
  );
}
function Button({
  children,
  onClick,
  disabled,
  primary = false,
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`button ${primary ? 'primary' : ''} ${className}`}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focus = () =>
      ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const timer = window.setTimeout(focus, 20);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const elements = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ) || []),
        ];
        const first = elements[0],
          last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', keyboard);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <div>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button className="icon-button" aria-label="Close dialog" onClick={close}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const initialView = window.location.hash.slice(1);
  const [view, setView] = useState<View>(
    ['workroom', 'tasks', 'team', 'reviews', 'settings'].includes(initialView)
      ? (initialView as View)
      : 'workroom',
  );
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [selectedProject, setSelectedProject] = useState('');
  const [loadError, setLoadError] = useState('');
  const [connected, setConnected] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const [taskFilter, setTaskFilter] = useState('all');
  const [taskSearch, setTaskSearch] = useState('');
  const [detailMember, setDetailMember] = useState('');
  const [diff, setDiff] = useState<TaskDiff | null>(null);
  const [diffError, setDiffError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [quickSearch, setQuickSearch] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await api<WorkspaceState>('/state');
      setState(data);
      setLoadError('');
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);
  const closeModal = useCallback(() => {
    setModal(null);
    setDiff(null);
    setDiffError('');
    setFeedback('');
  }, []);
  const navigate = useCallback((next: View) => {
    setView(next);
    window.location.hash = next;
    setSidebar(false);
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 12000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!state) return;
    const events = new EventSource('/api/events', { withCredentials: true });
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.addEventListener('change', refresh);
    return () => events.close();
  }, [!!state, refresh]);
  useEffect(() => {
    const updateView = () => {
      const next = window.location.hash.slice(1);
      if (['workroom', 'tasks', 'team', 'reviews', 'settings'].includes(next))
        setView(next as View);
    };
    window.addEventListener('hashchange', updateView);
    return () => window.removeEventListener('hashchange', updateView);
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(null), toast.error ? 8000 : 4500);
      return () => window.clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setModal({ type: 'search' });
        setQuickSearch('');
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    if (modal?.type !== 'detail') return;
    setDiff(null);
    setDiffError('');
    setDetailMember('');
    const task = state?.tasks.find((t) => t.id === modal.taskId);
    if (task?.worktree)
      api<TaskDiff>(`/tasks/${task.id}/diff`)
        .then(setDiff)
        .catch((err) => setDiffError(err.message));
  }, [modal?.type === 'detail' ? modal.taskId : null]);

  async function perform<T>(
    key: string,
    path: string,
    body: unknown,
    success?: string,
    method = 'POST',
  ): Promise<T | undefined> {
    setBusy(key);
    try {
      const result = await api<T>(path, body, method);
      await refresh();
      if (success) setToast({ text: success });
      return result;
    } catch (err) {
      setToast({ text: (err as Error).message, error: true });
      return undefined;
    } finally {
      setBusy('');
    }
  }
  const project = state?.projects.find((p) => p.id === selectedProject) || state?.projects[0];
  const tasks = state?.tasks.filter((t) => t.projectId === project?.id) || [];
  const members = state?.members || [];
  const reviews = tasks.filter((t) => t.status === 'review');
  const approvals = state?.approvals.filter((a) => tasks.some((t) => t.id === a.taskId)) || [];
  const selectedTask =
    modal?.type === 'detail' ? state?.tasks.find((t) => t.id === modal.taskId) : undefined;
  const pending = !!busy;
  const createTask = () => (project ? setModal({ type: 'task' }) : setModal({ type: 'project' }));
  const openDetail = (task: Task) => {
    setDiff(null);
    setModal({ type: 'detail', taskId: task.id });
  };

  async function dispatch() {
    if (!project) return;
    const result = await perform<{
      started: string[];
      skipped: { taskId: string; reason: string }[];
    }>('dispatch', `/projects/${project.id}/dispatch`, {});
    if (result)
      setToast({
        text: result.started.length
          ? `${result.started.length} task${result.started.length === 1 ? '' : 's'} dispatched to your team.`
          : result.skipped[0]?.reason || 'No ready tasks and available agents to dispatch.',
      });
  }
  async function login(member: Member, method: 'browser' | 'device') {
    const result = await perform<LoginResult>(`login-${member.id}`, `/members/${member.id}/login`, {
      method,
    });
    if (result) setModal({ type: 'login', memberId: member.id, result });
  }
  async function openSetup(member: Member) {
    try {
      const result = await api<{ home: string; instructions: string }>(
        `/members/${member.id}/setup`,
      );
      setModal({ type: 'setup', memberId: member.id, ...result });
    } catch (err) {
      setToast({ text: (err as Error).message, error: true });
    }
  }
  async function acceptTask(task: Task) {
    if (
      !window.confirm(
        `Integrate “${task.title}” into the project's current branch as a squash commit? RELAY integrates the reviewed changes only if the main working tree is clean.`,
      )
    )
      return;
    const result = await perform(
      'accept',
      `/tasks/${task.id}/accept`,
      {},
      'Changes integrated. Task complete.',
    );
    if (result) closeModal();
  }

  const pageTitle = view === 'workroom' ? 'Workroom' : view[0].toUpperCase() + view.slice(1);
  const taskRow = (task: Task) => {
    const Icon = kindIcons[task.kind];
    const owner = members.find((m) => m.id === task.assignedTo);
    return (
      <button key={task.id} className="task-row" onClick={() => openDetail(task)}>
        <span className={`task-state state-${task.status}`}>
          {task.status === 'done' ? (
            <CircleCheck size={16} />
          ) : task.status === 'running' ? (
            <CircleDot size={16} />
          ) : (
            <Circle size={16} />
          )}
        </span>
        <div className="task-row-title">
          <strong>{task.title}</strong>
          <span>
            <span className="mono">{shortId(task.id)}</span>
            <span>·</span>
            <Icon size={12} />
            {task.kind}
          </span>
        </div>
        <Badge status={task.status} />
        {owner ? (
          <Avatar member={owner} />
        ) : (
          <span className="unassigned-avatar">
            <Users size={13} />
          </span>
        )}
        <ChevronRight size={15} className="muted" />
      </button>
    );
  };

  return (
    <div className={`app ${sidebar ? 'sidebar-open' : ''}`}>
      {sidebar && (
        <button
          className="sidebar-scrim"
          onClick={() => setSidebar(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setSidebar(false)}
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
        <div className="workspace-picker">
          <span className="workspace-glyph">
            <FolderGit2 size={17} />
          </span>
          <div>
            <label className="sr-only" htmlFor="workspace-choice">
              Project
            </label>
            <select
              id="workspace-choice"
              value={project?.id || ''}
              onChange={(e) => setSelectedProject(e.target.value)}
            >
              {state?.projects.length ? (
                state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              ) : (
                <option value="">Select project</option>
              )}
            </select>
          </div>
          <ChevronDown size={13} />
        </div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === 'team' && members.length > 0 && (
                <span className="nav-count">{members.length}</span>
              )}
              {item.id === 'reviews' && reviews.length + approvals.length > 0 && (
                <span className="nav-count highlight">{reviews.length + approvals.length}</span>
              )}
            </button>
          ))}
        </nav>
        <button className="sidebar-invite" onClick={() => setModal({ type: 'project' })}>
          <Plus size={14} /> Connect project
        </button>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
          <span className="local-status">
            <LockKeyhole size={13} />
            Local workspace
          </span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              onClick={() => setSidebar(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-project">{project?.name || 'Workspace'}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`connection-label ${connected ? 'online' : ''}`}>
              <span />
              {connected ? 'Live' : state ? 'Reconnecting' : 'Connecting'}
            </span>
            <button
              className="search-trigger"
              onClick={() => {
                setQuickSearch('');
                setModal({ type: 'search' });
              }}
              aria-label="Search workspace"
            >
              <Search size={15} />
              <kbd>Ctrl K</kbd>
            </button>
          </div>
        </header>

        <main className={`main-content view-${view}`}>
          {loadError && (
            <div className="error-banner">
              <AlertTriangle size={17} />
              <span>{loadError}</span>
              <button onClick={() => void refresh()}>Retry</button>
            </div>
          )}
          {!state && !loadError && (
            <div className="initial-loading">
              <Loader2 className="spin" size={24} />
              <p>Opening your workspace…</p>
            </div>
          )}
          {state?.runtime.recoveryRequired && (
            <div className="warning-banner">
              <AlertTriangle size={18} />
              <div>
                <strong>Interrupted work needs your attention.</strong>
                <span>Previous tasks remain locked until their processes have stopped.</span>
              </div>
              <Button onClick={() => navigate('settings')}>
                Review recovery
                <ArrowRight size={14} />
              </Button>
            </div>
          )}

          {view === 'workroom' && (
            <Workroom
              key={project?.id || 'empty'}
              state={state}
              project={project}
              busy={pending}
              openTask={openDetail}
              addProject={() => setModal({ type: 'project' })}
              addMember={() => setModal({ type: 'member' })}
              manageTeam={() => navigate('team')}
              review={() => navigate('reviews')}
              start={async (prompt) =>
                project
                  ? perform<Workflow>('workflow', `/projects/${project.id}/workflows`, { prompt })
                  : undefined
              }
              control={(workflow, action) =>
                perform('workflow-control', `/workflows/${workflow.id}/${action}`, {})
              }
              send={(content) =>
                perform('message', '/messages', { projectId: project?.id, content })
              }
            />
          )}

          {view === 'team' && (
            <>
              <section className="page-heading">
                <div>
                  <h1>Team</h1>
                </div>
                <Button primary onClick={() => setModal({ type: 'member' })}>
                  <Plus size={16} /> Add account
                </Button>
              </section>
              <div className="team-grid">
                {members.map((member) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    task={tasks.find(
                      (t) => t.assignedTo === member.id && ['running', 'review'].includes(t.status),
                    )}
                    busy={pending}
                    login={(method) => void login(member, method)}
                    refresh={() =>
                      void perform(
                        `refresh-${member.id}`,
                        `/members/${member.id}/refresh`,
                        {},
                        'Account status refreshed.',
                      )
                    }
                    logout={() =>
                      void perform(
                        `logout-${member.id}`,
                        `/members/${member.id}/logout`,
                        {},
                        'Account signed out.',
                      )
                    }
                    importSkills={() =>
                      void perform(
                        `skills-${member.id}`,
                        `/members/${member.id}/skills/import`,
                        {},
                        'Local skills imported. Refreshing capabilities.',
                      )
                    }
                    openTask={openDetail}
                    setup={() => void openSetup(member)}
                  />
                ))}
                {!members.length && (
                  <div className="panel compact-empty">
                    <Users size={22} />
                    <span>No accounts</span>
                    <Button onClick={() => setModal({ type: 'member' })}>
                      <Plus size={14} />
                      Add account
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}

          {view === 'tasks' && (
            <>
              <section className="page-heading">
                <div>
                  <h1>Tasks</h1>
                </div>
                <div className="heading-actions">
                  <Button onClick={dispatch} disabled={!project || pending}>
                    <Zap size={15} /> Dispatch
                  </Button>
                  <Button primary onClick={createTask}>
                    <Plus size={15} /> New task
                  </Button>
                </div>
              </section>
              <div className="task-toolbar">
                <div className="tabs" role="tablist" aria-label="Task filter">
                  {[
                    ['all', 'All tasks'],
                    ['running', 'In progress'],
                    ['ready', 'Ready'],
                    ['review', 'In review'],
                    ['done', 'Done'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      role="tab"
                      aria-selected={taskFilter === value}
                      className={taskFilter === value ? 'active' : ''}
                      onClick={() => setTaskFilter(value)}
                    >
                      {label}
                      <span>
                        {value === 'all'
                          ? tasks.length
                          : tasks.filter((t) => t.status === value).length}
                      </span>
                    </button>
                  ))}
                </div>
                <label className="input-search">
                  <Search size={15} />
                  <input
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                    placeholder="Filter tasks…"
                    aria-label="Filter tasks"
                  />
                </label>
              </div>
              {tasks.length ? (
                <section className="panel full-task-list">
                  <div className="list-head">
                    <span>TASK</span>
                    <span>STATUS / OWNER</span>
                  </div>
                  {tasks
                    .filter(
                      (t) =>
                        (taskFilter === 'all' || t.status === taskFilter) &&
                        `${t.title} ${t.description}`
                          .toLowerCase()
                          .includes(taskSearch.toLowerCase()),
                    )
                    .map(taskRow)}
                  {!tasks.some(
                    (t) =>
                      (taskFilter === 'all' || t.status === taskFilter) &&
                      `${t.title} ${t.description}`
                        .toLowerCase()
                        .includes(taskSearch.toLowerCase()),
                  ) && (
                    <Empty
                      icon={Search}
                      title="No tasks in view"
                      text="Try a different filter or create a new task."
                    />
                  )}
                </section>
              ) : (
                <section className="panel compact-empty">
                  <ListTodo size={22} />
                  <span>No tasks</span>
                  <Button onClick={createTask}>
                    <Plus size={14} />
                    New task
                  </Button>
                </section>
              )}
            </>
          )}

          {view === 'reviews' && (
            <>
              <section className="page-heading">
                <div>
                  <h1>Reviews</h1>
                </div>
                <span className="heading-stat">
                  {reviews.length + approvals.length}
                  <span>NEEDS ATTENTION</span>
                </span>
              </section>
              {approvals.length > 0 && (
                <section className="panel approval-panel">
                  <div className="panel-heading">
                    <h2>
                      <ShieldCheck size={17} /> Permission requests
                      <span className="count-bubble">{approvals.length}</span>
                    </h2>
                  </div>
                  {approvals.map((a) => (
                    <ApprovalCard
                      key={a.id}
                      approval={a}
                      member={members.find((m) => m.id === a.memberId)}
                      disabled={pending}
                      decide={(decision) =>
                        void perform(
                          `approval-${a.id}`,
                          `/approvals/${a.id}`,
                          { decision },
                          decision === 'accept'
                            ? 'Permission granted for this request.'
                            : 'Request declined.',
                        )
                      }
                    />
                  ))}
                </section>
              )}
              {reviews.length ? (
                <div className="review-grid">
                  {reviews.map((task) => (
                    <div className="panel review-card" key={task.id}>
                      <div className="review-card-top">
                        <span className="review-symbol">
                          <GitMerge size={21} />
                        </span>
                        <Badge status="review" />
                      </div>
                      <span className="mono muted">{shortId(task.id)}</span>
                      <h3>{task.title}</h3>
                      <p>{task.summary || task.description}</p>
                      <div className="review-branch">
                        <GitBranch size={13} />
                        <span>{task.branch || 'Isolated worktree'}</span>
                      </div>
                      <div className="review-card-bottom">
                        <span>
                          <Avatar member={members.find((m) => m.id === task.assignedTo)} />
                          {members.find((m) => m.id === task.assignedTo)?.name || 'Unassigned'}
                        </span>
                        <Button onClick={() => openDetail(task)}>
                          Review changes
                          <ArrowRight size={14} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <section className="panel compact-empty">
                  <GitMerge size={22} />
                  <span>No tasks awaiting review</span>
                </section>
              )}
            </>
          )}

          {view === 'settings' && (
            <>
              <section className="page-heading">
                <div>
                  <h1>Settings</h1>
                </div>
              </section>
              <div className="settings-grid">
                <section className="panel settings-panel">
                  <div className="panel-heading">
                    <h2>
                      <FolderGit2 size={17} /> Projects
                    </h2>
                    <Button onClick={() => setModal({ type: 'project' })}>
                      <Plus size={14} /> Add project
                    </Button>
                  </div>
                  {state?.projects.length ? (
                    state.projects.map((p) => (
                      <ProjectSettings
                        key={p.id}
                        project={p}
                        busy={pending}
                        save={async (values) => {
                          await perform(
                            `project-${p.id}`,
                            `/projects/${p.id}`,
                            values,
                            'Project updated.',
                            'PATCH',
                          );
                        }}
                      />
                    ))
                  ) : (
                    <Empty
                      icon={FolderGit2}
                      title="No projects"
                      text="Connect an existing local Git repository. Each task gets its own worktree."
                      action={
                        <Button onClick={() => setModal({ type: 'project' })}>
                          <Plus size={14} /> Add project
                        </Button>
                      }
                    />
                  )}
                </section>
                <section className="panel settings-panel">
                  <div className="panel-heading">
                    <h2>
                      <Terminal size={17} /> Local runtime
                    </h2>
                    <span
                      className={`presence ${state?.runtime.codexAvailable ? 'ready' : 'error'}`}
                    />
                  </div>
                  <dl className="runtime-list">
                    <div>
                      <dt>Codex CLI</dt>
                      <dd>
                        {state?.runtime.codexAvailable ? (
                          <span className="success-text">Available</span>
                        ) : (
                          'Not detected'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>CLI version</dt>
                      <dd className="mono">{state?.runtime.codexVersion || 'Unknown'}</dd>
                    </div>
                    <div>
                      <dt>RELAY</dt>
                      <dd className="mono">v{state?.runtime.version || '0.1.0'}</dd>
                    </div>
                    <div>
                      <dt>Platform</dt>
                      <dd>{state?.runtime.platform || '—'}</dd>
                    </div>
                    <div className="runtime-path">
                      <dt>Local data</dt>
                      <dd className="mono">{state?.runtime.dataDir || '—'}</dd>
                    </div>
                  </dl>
                  {!state?.runtime.codexAvailable && (
                    <div className="install-hint">
                      <p>Install the official Codex CLI, then restart RELAY.</p>
                      <code>npm install -g @openai/codex</code>
                    </div>
                  )}
                </section>
              </div>
              {state?.runtime.recoveryRequired && (
                <section className="panel recovery-panel">
                  <AlertTriangle size={24} />
                  <div>
                    <h3>Recover interrupted tasks</h3>
                    <p>
                      Stop any orphan Codex processes from the previous RELAY session before
                      releasing their locks. Releasing a lock while an old worker is still running
                      can create conflicting work.
                    </p>
                    <Button
                      disabled={pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            'I have verified that Codex processes from the interrupted RELAY session have stopped. Release their stale task locks?',
                          )
                        )
                          void perform(
                            'recover',
                            '/recovery/acknowledge',
                            {},
                            'Stale locks released. Review interrupted tasks before restarting.',
                          );
                      }}
                    >
                      I have stopped the old processes
                    </Button>
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>

      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} role="status" aria-live="polite">
          {toast.error ? <AlertTriangle size={18} /> : <CircleCheck size={18} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {modal?.type === 'member' && (
        <Modal title="Add account" close={closeModal}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const result = await perform(
                'create-member',
                '/members',
                { name: data.get('name'), role: data.get('role'), color: data.get('color') },
                'Profile created. Sign in to connect this agent.',
              );
              if (result) {
                closeModal();
                navigate('team');
              }
            }}
          >
            <label>
              Agent name
              <input
                name="name"
                required
                maxLength={50}
                placeholder="e.g. Atlas"
                autoComplete="off"
              />
            </label>
            <label>
              Specialty
              <select name="role" defaultValue="engineer">
                <option value="engineer">Engineer</option>
                <option value="researcher">Researcher</option>
                <option value="designer">Designer</option>
                <option value="reviewer">Reviewer</option>
              </select>
            </label>
            <fieldset className="color-field">
              <legend>Agent color</legend>
              {colors.map((color, i) => (
                <label key={color} style={{ '--swatch': color } as React.CSSProperties}>
                  <input
                    type="radio"
                    name="color"
                    aria-label={`Agent color ${i + 1}`}
                    value={color}
                    defaultChecked={i === members.length % colors.length}
                  />
                  <span>
                    <Check size={14} />
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="modal-footer">
              <Button onClick={closeModal}>Cancel</Button>
              <Button primary type="submit" disabled={pending}>
                {pending ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} Create
                profile
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {modal?.type === 'project' && (
        <Modal title="Connect project" close={closeModal}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const result = await perform<Project>(
                'create-project',
                '/projects',
                { name: data.get('name'), path: data.get('path'), goal: data.get('goal') },
                'Project connected. Your room is ready.',
              );
              if (result) {
                setSelectedProject(result.id);
                closeModal();
              }
            }}
          >
            <label>
              Project name
              <input name="name" required maxLength={80} placeholder="Project name" />
            </label>
            <label>
              Repository path
              <input name="path" required placeholder="D:\projects\your-project" className="mono" />
            </label>
            <label>
              Shared goal
              <textarea
                name="goal"
                rows={3}
                required
                placeholder="What are we building, and what does success look like?"
                maxLength={5000}
              />
            </label>
            <div className="modal-footer">
              <Button onClick={closeModal}>Cancel</Button>
              <Button primary type="submit" disabled={pending}>
                <FolderGit2 size={15} /> Connect project
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {modal?.type === 'task' && (
        <Modal title="New task" close={closeModal} wide>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const result = await perform<Task>(
                'create-task',
                '/tasks',
                {
                  projectId: project?.id,
                  title: data.get('title'),
                  description: data.get('description'),
                  kind: data.get('kind'),
                  priority: data.get('priority'),
                  assignedTo: data.get('assignedTo') || null,
                  status: data.get('status'),
                  scope: String(data.get('scope'))
                    .split(/[,\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                  dependsOn: data.getAll('dependsOn'),
                  acceptance: data.get('acceptance'),
                },
                'Task added to the board.',
              );
              if (result) {
                closeModal();
                navigate('tasks');
              }
            }}
          >
            <label>
              Task title
              <input
                name="title"
                required
                maxLength={180}
                placeholder="A focused outcome, in a few words"
              />
            </label>
            <label>
              The brief
              <textarea
                name="description"
                required
                rows={4}
                maxLength={20000}
                placeholder="Give the agent the context, constraints, and expected deliverable."
              />
            </label>
            <div className="form-grid three">
              <label>
                Type
                <select name="kind">
                  <option value="code">Code</option>
                  <option value="research">Research</option>
                  <option value="design">Design</option>
                  <option value="review">Review</option>
                </select>
              </label>
              <label>
                Priority
                <select name="priority" defaultValue="medium">
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label>
                Starting status
                <select name="status" defaultValue="ready">
                  <option value="ready">Ready to run</option>
                  <option value="backlog">Backlog</option>
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>
                Owner
                <select name="assignedTo">
                  <option value="">Assign when dispatched</option>
                  {members.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name} · {m.role}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                File scope
                <input
                  name="scope"
                  required
                  defaultValue="*"
                  placeholder="src/components, src/styles"
                />
                <small>Comma-separated paths. * reserves the whole project.</small>
              </label>
            </div>
            <label>
              Acceptance criteria
              <textarea
                name="acceptance"
                required
                rows={2}
                placeholder="How should the result be checked?"
                maxLength={5000}
              />
            </label>
            {tasks.length > 0 && (
              <fieldset className="dependency-field">
                <legend>
                  Dependencies <span>Optional · must finish before this task runs</span>
                </legend>
                <div>
                  {tasks
                    .filter((t) => t.status !== 'done')
                    .map((t) => (
                      <label key={t.id}>
                        <input type="checkbox" name="dependsOn" value={t.id} />
                        <span>{t.title}</span>
                        <Badge status={t.status} />
                      </label>
                    ))}
                </div>
              </fieldset>
            )}
            <div className="modal-footer">
              <Button onClick={closeModal}>Cancel</Button>
              <Button primary type="submit" disabled={pending}>
                <Plus size={15} /> Create task
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {modal?.type === 'login' && (
        <Modal
          title="Sign in"
          eyebrow={members.find((m) => m.id === modal.memberId)?.name || 'ACCOUNT SIGN-IN'}
          close={closeModal}
        >
          <div className="login-content">
            <span className="login-symbol">
              <LockKeyhole size={30} />
            </span>
            <p>
              Complete sign-in on OpenAI, then return to this room. Choose the account you want this
              agent to use.
            </p>
            {modal.result.userCode && (
              <div className="device-code">
                <span>YOUR ONE-TIME CODE</span>
                <code>{modal.result.userCode}</code>
                <button
                  className="text-button"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(modal.result.userCode || '')
                      .then(() => setToast({ text: 'Code copied.' }))
                      .catch(() =>
                        setToast({ text: 'Select and copy the code above.', error: true }),
                      )
                  }
                >
                  <Copy size={13} /> Copy code
                </button>
              </div>
            )}
            {validAuthUrl(modal.result.authUrl || modal.result.verificationUrl) ? (
              <a
                className="button primary"
                href={validAuthUrl(modal.result.authUrl || modal.result.verificationUrl)}
                target="_blank"
                rel="noreferrer"
              >
                Continue to OpenAI
                <ExternalLink size={15} />
              </a>
            ) : (
              <p className="error-text">
                No valid OpenAI sign-in URL was returned. Close this dialog and try again.
              </p>
            )}
            <p className="login-help">
              Signing in another account? Switch accounts on the OpenAI page before continuing.
            </p>
            <div className="modal-footer">
              <Button
                onClick={async () => {
                  if (modal.result.loginId)
                    await perform('cancel-login', `/members/${modal.memberId}/login/cancel`, {
                      loginId: modal.result.loginId,
                    });
                  closeModal();
                }}
              >
                Cancel sign-in
              </Button>
              <Button
                onClick={async () => {
                  const result = await perform<Member>(
                    'login-refresh',
                    `/members/${modal.memberId}/refresh`,
                    {},
                  );
                  if (result?.account) {
                    closeModal();
                    setToast({ text: 'Account connected. Welcome to the room.' });
                  } else if (result)
                    setToast({
                      text: 'Sign-in is not complete yet. Finish on OpenAI and check again.',
                    });
                }}
                disabled={pending}
              >
                <RefreshCw size={14} /> Check sign-in
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {modal?.type === 'setup' && (
        <Modal title="Skills & plugins" close={closeModal}>
          <div className="setup-content">
            <p>
              Skills, plugins, and MCP configuration belong to this Codex profile. They do not
              automatically follow a ChatGPT subscription.
            </p>
            <h3>PROFILE HOME</h3>
            <div className="setup-path">
              <code>{modal.home}</code>
              <button
                className="icon-button"
                aria-label="Copy profile path"
                onClick={() =>
                  navigator.clipboard
                    .writeText(modal.home)
                    .then(() => setToast({ text: 'Profile path copied.' }))
                    .catch(() =>
                      setToast({ text: 'Select and copy the profile path.', error: true }),
                    )
                }
              >
                <Copy size={15} />
              </button>
            </div>
            <h3>
              {state?.runtime.platform === 'win32' ? 'OPEN IN POWERSHELL' : 'OPEN IN YOUR TERMINAL'}
            </h3>
            <pre>
              {state?.runtime.platform === 'win32'
                ? `$env:CODEX_HOME = '${modal.home.replace(/'/g, "''")}'\ncodex`
                : `CODEX_HOME='${modal.home.replace(/'/g, "'\\''")}' codex`}
            </pre>
            <p className="setup-instructions">{modal.instructions}</p>
            <div className="modal-footer">
              <Button onClick={closeModal}>Done</Button>
            </div>
          </div>
        </Modal>
      )}

      {modal?.type === 'detail' && selectedTask && (
        <Modal
          title={selectedTask.title}
          eyebrow={shortId(selectedTask.id)}
          close={closeModal}
          wide
        >
          <div className="task-detail">
            <div className="detail-meta">
              <Badge status={selectedTask.status} />
              <span>
                <PriorityDot priority={selectedTask.priority} />
                {selectedTask.priority} priority
              </span>
              <span>{selectedTask.kind}</span>
              <span>{relative(selectedTask.createdAt)}</span>
            </div>
            {selectedTask.error && (
              <div className="detail-error">
                <AlertTriangle size={16} />
                <p>{selectedTask.error}</p>
              </div>
            )}
            <div className="detail-section">
              <h3>THE BRIEF</h3>
              <p className="preserve-lines">{selectedTask.description}</p>
            </div>
            <div className="detail-section">
              <h3>ACCEPTANCE CRITERIA</h3>
              <p className="preserve-lines">
                {selectedTask.acceptance || 'No additional criteria.'}
              </p>
            </div>
            <div className="detail-pair">
              <div>
                <h3>OWNER</h3>
                <span className="detail-owner">
                  <Avatar member={members.find((m) => m.id === selectedTask.assignedTo)} />
                  {members.find((m) => m.id === selectedTask.assignedTo)?.name || 'Unassigned'}
                </span>
              </div>
              <div>
                <h3>RESERVED SCOPE</h3>
                <div className="chips">
                  {selectedTask.scope.map((s) => (
                    <code key={s}>{s}</code>
                  ))}
                </div>
              </div>
            </div>
            {selectedTask.dependsOn.length > 0 && (
              <div className="detail-section">
                <h3>DEPENDS ON</h3>
                {selectedTask.dependsOn.map((id) => {
                  const task = tasks.find((t) => t.id === id);
                  return task ? (
                    <button className="dependency-link" key={id} onClick={() => openDetail(task)}>
                      <ListTodo size={13} />
                      {task.title}
                      <Badge status={task.status} />
                    </button>
                  ) : null;
                })}
              </div>
            )}
            {selectedTask.branch && (
              <div className="branch-bar">
                <GitBranch size={14} />
                <code>{selectedTask.branch}</code>
              </div>
            )}
            {selectedTask.summary && (
              <div className="detail-section">
                <h3>AGENT HANDOFF</h3>
                <p className="preserve-lines summary-box">{selectedTask.summary}</p>
              </div>
            )}
            {selectedTask.worktree && (
              <div className="detail-section">
                <h3>
                  CHANGES <span>{diff?.files.length || 0} files</span>
                </h3>
                {diffError ? (
                  <p className="error-text">{diffError}</p>
                ) : !diff ? (
                  <div className="diff-loading">
                    <Loader2 size={17} className="spin" /> Loading changes…
                  </div>
                ) : (
                  <>
                    <pre className="diff-stat">{diff.stat || 'No file changes yet.'}</pre>
                    {diff.diff && (
                      <pre className="diff-view">
                        {diff.diff.split('\n').map((line, i) => (
                          <span
                            className={
                              line.startsWith('+') && !line.startsWith('+++')
                                ? 'diff-add'
                                : line.startsWith('-') && !line.startsWith('---')
                                  ? 'diff-remove'
                                  : line.startsWith('@@')
                                    ? 'diff-hunk'
                                    : ''
                            }
                            key={i}
                          >
                            {line || ' '}
                            <br />
                          </span>
                        ))}
                      </pre>
                    )}
                    {diff.truncated && (
                      <p className="subtle-note">
                        Large diff truncated. Inspect the worktree locally before merging.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            {selectedTask.status === 'review' && (
              <label className="detail-feedback">
                Request changes
                <textarea
                  rows={2}
                  placeholder="Describe what should be improved before merging…"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
              </label>
            )}
            <div className="modal-footer detail-footer">
              <Button onClick={closeModal}>Close</Button>
              <div>
                {selectedTask.status === 'running' && (
                  <Button
                    disabled={pending}
                    onClick={() =>
                      void perform(
                        'stop',
                        `/tasks/${selectedTask.id}/stop`,
                        {},
                        'Task stopped. Its worktree is preserved.',
                      )
                    }
                  >
                    <Square size={14} /> Stop task
                  </Button>
                )}
                {!selectedTask.workflowId &&
                  ['ready', 'backlog', 'blocked'].includes(selectedTask.status) && (
                    <>
                      <select
                        aria-label="Agent to run this task"
                        value={detailMember || selectedTask.assignedTo || ''}
                        onChange={(e) => setDetailMember(e.target.value)}
                      >
                        <option value="">Choose an agent</option>
                        {members
                          .filter(
                            (m) =>
                              m.status === 'ready' &&
                              !tasks.some(
                                (t) =>
                                  t.assignedTo === m.id && ['running', 'review'].includes(t.status),
                              ),
                          )
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                              {m.status !== 'ready' ? ' (not ready)' : ''}
                            </option>
                          ))}
                      </select>
                      <Button
                        primary
                        disabled={pending || !(detailMember || selectedTask.assignedTo)}
                        onClick={async () => {
                          const result = await perform(
                            'run',
                            `/tasks/${selectedTask.id}/run`,
                            { memberId: detailMember || selectedTask.assignedTo },
                            'Agent started. Follow progress in the room.',
                          );
                          if (result) closeModal();
                        }}
                      >
                        <Zap size={14} /> Run task
                      </Button>
                    </>
                  )}
                {selectedTask.status === 'review' && (
                  <>
                    <Button
                      disabled={pending || !feedback.trim()}
                      onClick={async () => {
                        const result = await perform(
                          'revise',
                          `/tasks/${selectedTask.id}/revise`,
                          { feedback },
                          'Feedback saved. Task returned to the queue.',
                        );
                        if (result) closeModal();
                      }}
                    >
                      Request changes
                    </Button>
                    <Button
                      primary
                      disabled={pending || !diff || !!diffError}
                      onClick={() => void acceptTask(selectedTask)}
                    >
                      <GitMerge size={15} /> Accept & integrate
                    </Button>
                  </>
                )}
                {selectedTask.status === 'done' && (
                  <span className="completed-label">
                    <CircleCheck size={16} /> Complete
                  </span>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {modal?.type === 'search' && (
        <Modal title="Search" close={closeModal}>
          <div className="quick-search">
            <label>
              <Search size={19} />
              <input
                autoFocus
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                placeholder="Search tasks or jump to a page…"
              />
            </label>
            <div className="quick-results">
              {nav
                .filter((n) => n.label.toLowerCase().includes(quickSearch.toLowerCase()))
                .map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      navigate(n.id);
                      closeModal();
                    }}
                  >
                    <n.icon size={17} />
                    <span>{n.label}</span>
                    <ArrowRight size={14} />
                  </button>
                ))}
              {tasks
                .filter((t) => t.title.toLowerCase().includes(quickSearch.toLowerCase()))
                .slice(0, 8)
                .map((t) => (
                  <button key={t.id} onClick={() => openDetail(t)}>
                    <ListTodo size={16} />
                    <span>{t.title}</span>
                    <Badge status={t.status} />
                  </button>
                ))}
            </div>
            <div className="quick-hint">
              <kbd>esc</kbd> to close
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  return <span className={`priority-dot ${priority}`} />;
}

function MemberCard({
  member,
  task,
  busy,
  login,
  refresh,
  logout,
  importSkills,
  openTask,
  setup,
}: {
  member: Member;
  task?: Task;
  busy: boolean;
  login: (method: 'browser' | 'device') => void;
  refresh: () => void;
  logout: () => void;
  importSkills: () => void;
  openTask: (task: Task) => void;
  setup: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const limits = parseLimits(member.rateLimits);
  return (
    <section className="panel member-card">
      <div className="member-top">
        <Avatar member={member} size="large" />
        <Badge status={member.status} />
      </div>
      <h2>{member.name}</h2>
      <span className="role-label">{member.role}</span>
      <div className="member-account">
        <span>{member.account?.email || 'Not connected'}</span>
        {member.account?.planType && <span className="plan-tag">{member.account.planType}</span>}
      </div>
      {member.error && (
        <p className="member-error">
          <AlertTriangle size={13} />
          {member.error}
        </p>
      )}
      {task && (
        <button className="member-current-task" onClick={() => openTask(task)}>
          <span className="live-dot" />
          <span>{task.title}</span>
          <ArrowUpRight size={14} />
        </button>
      )}
      <div className="member-usage">
        <div>
          <span>Plan usage</span>
          <span>{limits.length ? `${Math.round(limits[0].used)}% used` : '—'}</span>
        </div>
        {limits.length ? (
          limits.map((limit, i) => (
            <div className="usage-window" key={i}>
              <div className="usage-track">
                <span style={{ width: `${Math.max(0, Math.min(100, limit.used))}%` }} />
              </div>
              <small>
                {limit.label}
                {limit.reset ? ` · resets ${new Date(limit.reset * 1000).toLocaleString()}` : ''}
              </small>
            </div>
          ))
        ) : (
          <div className="usage-track unknown">
            <span />
          </div>
        )}
      </div>
      <button
        className="capability-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span>
          <Layers3 size={14} />
          {member.skills.length} skills<span className="divider-dot">·</span>
          {member.plugins.length} plugins
        </span>
        <ChevronDown size={14} className={expanded ? 'rotated' : ''} />
      </button>
      {expanded && (
        <div className="capability-list">
          <h4>AVAILABLE SKILLS</h4>
          {member.skills.length ? (
            <div className="chips">
              {member.skills.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          ) : (
            <p>No skills</p>
          )}
          <h4>INSTALLED PLUGINS</h4>
          {member.plugins.length ? (
            <div className="chips">
              {member.plugins.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          ) : (
            <p>No plugins</p>
          )}
          {member.capabilitiesError && <p className="error-text">{member.capabilitiesError}</p>}
          <button className="text-button accent" onClick={importSkills} disabled={busy}>
            <ArrowDownLeft size={14} /> Import local skills
          </button>
          <button className="text-button capability-setup" onClick={setup}>
            <Terminal size={14} /> Configure skills & plugins
          </button>
        </div>
      )}
      <div className="member-actions">
        {member.account ? (
          <>
            <Button onClick={refresh} disabled={busy}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <button
              className="icon-button"
              disabled={busy || member.status === 'working'}
              aria-label={`Sign ${member.name} out`}
              title="Sign out"
              onClick={() => {
                if (window.confirm(`Sign ${member.name} out of its Codex account?`)) logout();
              }}
            >
              <LogOut size={16} />
            </button>
          </>
        ) : (
          <>
            <Button primary onClick={() => login('browser')} disabled={busy}>
              <ArrowUpRight size={15} /> Sign in with OpenAI
            </Button>
            <button className="text-button" disabled={busy} onClick={() => login('device')}>
              Use a code
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function parseLimits(input: unknown): { used: number; label: string; reset?: number }[] {
  if (!input || typeof input !== 'object') return [];
  const root = input as Record<string, any>;
  const limits = root.rateLimits || root;
  return ['primary', 'secondary'].flatMap((key, i) => {
    const window = limits[key];
    if (!window || typeof window.usedPercent !== 'number') return [];
    return [
      {
        used: window.usedPercent,
        label: window.windowDurationMins
          ? `${window.windowDurationMins < 1440 ? `${Math.round(window.windowDurationMins / 60)} hour` : `${Math.round(window.windowDurationMins / 1440)} day`} window`
          : i === 0
            ? 'Primary window'
            : 'Secondary window',
        reset: window.resetsAt,
      },
    ];
  });
}

function ApprovalCard({
  approval,
  member,
  disabled,
  decide,
}: {
  approval: Approval;
  member?: Member;
  disabled: boolean;
  decide: (decision: 'accept' | 'decline') => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="approval-card">
      <div>
        <Avatar member={member} />
        <div>
          <strong>{member?.name || 'Agent'} needs permission</strong>
          <p>{approval.description}</p>
          <button className="text-button" onClick={() => setShow(!show)}>
            {show ? 'Hide' : 'View'} request details
            <ChevronDown size={13} />
          </button>
          {show && <pre>{JSON.stringify(approval.details, null, 2)}</pre>}
        </div>
      </div>
      <div className="approval-actions">
        <Button disabled={disabled} onClick={() => decide('decline')}>
          Decline
        </Button>
        <Button primary disabled={disabled} onClick={() => decide('accept')}>
          <Check size={14} /> Allow once
        </Button>
      </div>
    </div>
  );
}

function ProjectSettings({
  project,
  busy,
  save,
}: {
  project: Project;
  busy: boolean;
  save: (values: { name: string; goal: string }) => Promise<void>;
}) {
  return (
    <form
      className="form project-form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        void save({ name: String(data.get('name')), goal: String(data.get('goal')) });
      }}
    >
      <label>
        Project name
        <input name="name" required defaultValue={project.name} maxLength={80} />
      </label>
      <label>
        Repository
        <span className="path-display">
          <FolderGit2 size={14} />
          <code>{project.path}</code>
        </span>
      </label>
      <label>
        Shared mission
        <textarea name="goal" rows={3} defaultValue={project.goal} required maxLength={5000} />
      </label>
      <Button type="submit" disabled={busy}>
        Save changes
        <Check size={14} />
      </Button>
    </form>
  );
}
