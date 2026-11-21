import { openExternal } from './desktop';
import ProviderSignIn from './ProviderSignIn';
import SharedGroups, { SharedGroupEntryDialog, SharedGroupListExtras } from './SharedGroups';
import ChatHome, { useChatGroups, type ChatSelection } from './ChatHome';
import { useWorkspaceTheme, WorkspaceThemeProvider } from './WorkspaceTheme';
import SadeDeckChat, { useSadeDeckChat } from './SadeDeckChat';
import { isExternalProvider, isExternalMember } from '../shared/providers';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
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
  CreditCard,
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
  Moon,
  Sun,
  MessageSquare,
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
  Trash2,
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
  ProviderId,
  AccountQuota,
} from '../shared/types';
import { api } from './api';
import Workroom from './Workroom';
import Machines from './Machines';
import UsageGuide from './UsageGuide';
import Aegis from './Aegis';
import DeadlineField from './DeadlineField';
import HelpDetails from './HelpDetails';
import TeamModelPicker from './TeamModelPicker';
import { deadlineFromForm } from './deadline';
import ProviderConnect, {
  ExternalConnection,
  ProviderPicker,
  ProviderTurnAllowance,
  providerLabels,
  providerOf,
} from './ProviderConnect';
import {
  beginClaudeAccount,
  saveClaudeClient,
  useClaudeAccount,
  useClaudeCodeAccount,
  type ClaudeClient,
} from './ClaudeAccount';
import {
  AccountSettings,
  MeshPage,
  QuotaCard,
  SessionsPage,
  type FoundationRequest,
} from './Foundation';

type View = 'mesh' | 'sessions' | 'workroom' | 'tasks' | 'team' | 'reviews' | 'settings' | 'aegis';
type ModalState =
  | { type: 'member' | 'project' | 'task' | 'search' | 'connect' }
  | { type: 'group-entry'; mode: 'create' | 'join' }
  | { type: 'external'; memberId: string; claudeClient?: ClaudeClient }
  | { type: 'detail'; taskId: string }
  | { type: 'login'; memberId: string; result: LoginResult }
  | { type: 'setup'; memberId: string; home: string; instructions: string }
  | null;
const nav = [
  { id: 'mesh', label: 'Chat', icon: MessageSquare },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'reviews', label: 'Reviews', icon: GitMerge },
] as const;
const advancedNav = [
  { id: 'sessions', label: 'Sessions', icon: Terminal },
  { id: 'workroom', label: 'Workroom', icon: LayoutGrid },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'aegis', label: 'Quyền dự án', icon: ShieldCheck },
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
const colors = ['#8ce8cf', '#a6baff', '#e8b07d', '#bba6e4', '#7ccfc3', '#dc91af'];
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
  `KIV-${id
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
      <img src="/kivuno.svg" alt="" />
      <span>Kivuno</span>
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
  guide,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  guide?: string;
  title?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`button ${primary ? 'primary' : ''} ${className}`}
      data-usage={guide}
      title={title}
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
    if (!ref.current?.contains(document.activeElement))
      ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const elements = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'summary,a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ) || []),
        ].filter((element) => element.getClientRects().length > 0);
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

export default function App({ cloud = false }: { cloud?: boolean }) {
  return (
    <WorkspaceThemeProvider>
      <WorkspaceApp cloud={cloud} />
    </WorkspaceThemeProvider>
  );
}

function WorkspaceApp({ cloud }: { cloud: boolean }) {
  const initialView = window.location.hash.slice(1);
  const [focusedSessionId, setFocusedSessionId] = useState(
    initialView.startsWith('session=') ? initialView.slice(8) : '',
  );
  const [view, setView] = useState<View>(
    initialView.startsWith('session=')
      ? 'sessions'
      : ['mesh', 'sessions', 'workroom', 'tasks', 'team', 'reviews', 'settings', 'aegis'].includes(
            initialView,
          )
        ? (initialView as View)
        : 'mesh',
  );
  const [state, setState] = useState<WorkspaceState | null>(null);
  const deckChatEnabled = Boolean(state && window.relayDesktop?.sadeDecks);
  const deckChat = useSadeDeckChat(deckChatEnabled);
  const [selectedChat, setSelectedChat] = useState<ChatSelection | null>(null);
  const [showChatDetail, setShowChatDetail] = useState(false);
  const [chatGroupsRevision, setChatGroupsRevision] = useState(0);
  const chatRail = useRef<HTMLElement>(null);
  const chatConversation = useRef<HTMLElement>(null);
  const canShareGroups = Boolean(window.relayDesktop?.groups);
  const chatGroups = useChatGroups(view === 'mesh' && Boolean(state), chatGroupsRevision);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedMachine, setSelectedMachine] = useState('');
  const [loadError, setLoadError] = useState('');
  const [connected, setConnected] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const { theme, toggleTheme } = useWorkspaceTheme();
  const [taskFilter, setTaskFilter] = useState('all');
  const [taskSearch, setTaskSearch] = useState('');
  const [detailMember, setDetailMember] = useState('');
  const [diff, setDiff] = useState<TaskDiff | null>(null);
  const [reviewRefresh, setReviewRefresh] = useState(0);
  const [diffError, setDiffError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [quickSearch, setQuickSearch] = useState('');
  const [repositoryPath, setRepositoryPath] = useState('');
  const [projectMode, setProjectMode] = useState<'existing' | 'initialize' | 'hackathon'>(
    cloud ? 'hackathon' : 'initialize',
  );
  const [profileProvider, setProfileProvider] = useState<ProviderId>('codex');
  const profileSyncQueue = useRef<Promise<void>>(Promise.resolve());
  const profileSyncSequence = useRef(0);
  const pendingProfileSync = useRef('');

  const syncProfileEntitlements = useCallback((profiles: Member[]) => {
    const desktop = window.relayDesktop;
    if (!desktop) return;
    const payload = profiles.map((member) => ({
      profileId: member.id,
      name: member.name,
      provider: member.provider || 'codex',
    }));
    const signature = JSON.stringify(payload);
    if (pendingProfileSync.current === signature) return;
    pendingProfileSync.current = signature;
    const sequence = ++profileSyncSequence.current;
    profileSyncQueue.current = profileSyncQueue.current
      .catch(() => {})
      .then(async () => {
        if (sequence !== profileSyncSequence.current) return;
        try {
          const result = await desktop.profiles<{ lockedIds: string[] }>({
            action: 'sync',
            profiles: payload,
          });
          if (sequence !== profileSyncSequence.current) return;
          const locked = new Set(result.lockedIds);
          setState((current) =>
            current
              ? {
                  ...current,
                  members: current.members.map((member) => ({
                    ...member,
                    entitlementLocked: locked.has(member.id),
                  })),
                }
              : current,
          );
        } catch {
          // Keep the last server-provided lock state when the cloud is temporarily unavailable.
        } finally {
          if (sequence === profileSyncSequence.current) pendingProfileSync.current = '';
        }
      });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api<WorkspaceState>('/state');
      setState({
        ...data,
        sessions: data.sessions || [],
        quotas: data.quotas || [],
        quotaGrants: data.quotaGrants || [],
        meshCursors: data.meshCursors || [],
        humanRequests: data.humanRequests || [],
        handoffs: data.handoffs || [],
      });
      setLoadError('');
      syncProfileEntitlements(data.members);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [syncProfileEntitlements]);
  const closeModal = useCallback(() => {
    setModal(null);
    setDiff(null);
    setDiffError('');
    setFeedback('');
  }, []);
  const navigate = useCallback((next: View) => {
    if (next === 'mesh') setShowChatDetail(false);
    setView(next);
    window.location.hash = next;
    setSidebar(false);
  }, []);
  const openChat = (chat: ChatSelection) => {
    if (chat.kind === 'project') setSelectedProject(chat.id);
    setSelectedChat(chat);
    setShowChatDetail(true);
    if (window.matchMedia('(max-width: 880px)').matches)
      requestAnimationFrame(() => chatConversation.current?.focus({ preventScroll: true }));
  };
  const backToChatList = () => {
    setShowChatDetail(false);
    requestAnimationFrame(() =>
      (
        chatRail.current?.querySelector<HTMLButtonElement>('[aria-current="page"]') ??
        chatRail.current
      )?.focus({ preventScroll: true }),
    );
  };
  const refreshChatGroups = useCallback(
    () => setChatGroupsRevision((revision) => revision + 1),
    [],
  );
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!state) return;
    const events = new EventSource('/api/events', { withCredentials: true });
    let scheduled = 0;
    const scheduleRefresh = () => {
      if (document.hidden || scheduled) return;
      scheduled = window.setTimeout(() => {
        scheduled = 0;
        void refresh();
      }, 400);
    };
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.addEventListener('change', scheduleRefresh);
    document.addEventListener('visibilitychange', scheduleRefresh);
    return () => {
      events.close();
      window.clearTimeout(scheduled);
      document.removeEventListener('visibilitychange', scheduleRefresh);
    };
  }, [!!state, refresh]);
  useEffect(() => {
    const updateView = () => {
      const next = window.location.hash.slice(1);
      if (next.startsWith('session=')) {
        setFocusedSessionId(next.slice(8));
        setView('sessions');
        return;
      }
      setFocusedSessionId('');
      if (
        ['mesh', 'sessions', 'workroom', 'tasks', 'team', 'reviews', 'settings', 'aegis'].includes(
          next,
        )
      )
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
    if (!task?.worktree) return;
    let closed = false;
    let awaiting = false;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const next = await api<TaskDiff>(`/tasks/${task.id}/diff`);
        if (closed) return;
        awaiting = !!next.machineChecks?.attempts.some(
          (check) =>
            check.current && (check.status === 'awaiting result' || check.status === 'preparing'),
        );
        setDiff(next);
        setDiffError('');
      } catch (err) {
        if (!closed) setDiffError((err as Error).message);
      } finally {
        if (!closed && awaiting) timer = setTimeout(load, 2000);
      }
    };
    void load();
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, [modal?.type === 'detail' ? modal.taskId : null, reviewRefresh]);

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
      await refresh();
      setToast({ text: (err as Error).message, error: true });
      return undefined;
    } finally {
      setBusy('');
    }
  }
  const foundationRequest: FoundationRequest = <T,>(path: string, body: unknown, method = 'POST') =>
    perform<T>('foundation', path, body, undefined, method);
  const project = state?.projects.find((p) => p.id === selectedProject) || state?.projects[0];
  const tasks = state?.tasks.filter((t) => t.projectId === project?.id) || [];
  const members = state?.members || [];
  const availableMembers = members.filter((member) => !member.entitlementLocked);
  const reviews = tasks.filter((t) => t.status === 'review');
  const approvals = state?.approvals.filter((a) => tasks.some((t) => t.id === a.taskId)) || [];
  const selectedTask =
    modal?.type === 'detail' ? state?.tasks.find((t) => t.id === modal.taskId) : undefined;
  const pageTitle = [...nav, ...advancedNav].find((item) => item.id === view)?.label ?? 'Settings';
  const chatRoom = view === 'mesh' ? selectedChat?.kind : undefined;
  const projectRoster =
    chatRoom === 'project'
      ? members.filter((member) => project?.memberIds?.includes(member.id))
      : [];
  const pending = !!busy;
  async function openBilling() {
    const desktop = window.relayDesktop;
    if (!desktop) return;
    try {
      const { cloudOrigin } = await desktop.getStatus();
      await desktop.openExternal(new URL('/billing', cloudOrigin).href);
      setSidebar(false);
    } catch (cause) {
      setToast({ text: 'Chưa mở được trang thanh toán. ' + (cause as Error).message, error: true });
    }
  }
  useEffect(() => {
    const session = state?.sessions.find((entry) => entry.id === focusedSessionId);
    document.title = session
      ? `${session.title} · Kivuno`
      : `${pageTitle}${project ? ` · ${project.name}` : ''} · Kivuno`;
  }, [
    focusedSessionId,
    view,
    project?.name,
    state?.sessions.find((entry) => entry.id === focusedSessionId)?.title,
  ]);
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
  function confirmAntigravity() {
    return window.confirm(
      'Connect the Antigravity account on this computer to Kivuno? This uses the current Google sign-in in Antigravity, including future account changes there. Only one Kivuno profile can use this connection. Model prompts require a separate project allowance.',
    );
  }
  async function login(member: Member, method: 'browser' | 'device', deviceConfirmed = false) {
    if (member.entitlementLocked) {
      setToast({ text: 'This profile is locked by your current Kivuno plan.', error: true });
      return;
    }
    const provider = providerOf(member);
    const deviceAccount = provider === 'antigravity' && !isExternalMember(member);
    if (deviceAccount && !deviceConfirmed && !confirmAntigravity()) return;
    if (window.relayDesktop && !member.runnerId && provider !== 'claude') {
      setBusy(`prepare-${provider}`);
      try {
        await window.relayDesktop.prepareProvider(provider);
      } catch (error) {
        setToast({ text: (error as Error).message, error: true });
        return;
      } finally {
        setBusy('');
      }
    }
    if (isExternalMember(member)) {
      setModal({ type: 'external', memberId: member.id });
      return;
    }
    const result = await perform<LoginResult>(`login-${member.id}`, `/members/${member.id}/login`, {
      method,
      ...(deviceAccount ? { confirmDeviceAccount: true } : {}),
    });
    if (result) setModal({ type: 'login', memberId: member.id, result });
  }
  async function antigravityGoogleSignIn(member: Member) {
    if (member.entitlementLocked) {
      setToast({ text: 'This profile is locked by your current Kivuno plan.', error: true });
      return;
    }
    if (!window.relayDesktop) {
      setToast({ text: 'Open Kivuno desktop to connect Antigravity.', error: true });
      return;
    }
    if (!confirmAntigravity()) return;
    setBusy(`antigravity-google-${member.id}`);
    try {
      await window.relayDesktop.prepareProvider('antigravity');
      if (isExternalMember(member)) {
        const managed = await perform<Member>(
          'enable-managed',
          `/members/${member.id}/managed-runtime`,
          {
            acknowledgeLocalExecution: true,
            confirmDeviceAccount: true,
          },
        );
        if (!managed) return;
        member = managed;
      }
      await login(member, 'browser', true);
    } catch (error) {
      setToast({ text: (error as Error).message, error: true });
    } finally {
      setBusy('');
    }
  }
  async function connectAccount(
    provider: ProviderId,
    managedRuntime = false,
    claudeClient?: ClaudeClient,
    existingMemberId?: string,
  ) {
    if (provider === 'claude' && existingMemberId) {
      const profile = members.find(
        (member) =>
          member.id === existingMemberId &&
          member.provider === 'claude' &&
          !member.entitlementLocked &&
          !member.runnerId,
      );
      if (!profile) return;
      saveClaudeClient(profile.id, claudeClient || 'web');
      setModal({ type: 'external', memberId: profile.id, claudeClient });
      setBusy('connect-claude-account');
      try {
        if (claudeClient === 'web') await beginClaudeAccount(profile.id);
        else if (claudeClient === 'desktop') await window.relayDesktop?.claudeClient('desktop');
      } catch (cause) {
        setToast({ text: (cause as Error).message, error: true });
      } finally {
        setBusy('');
      }
      return;
    }
    const runnerId = selectedMachine && !isExternalProvider(provider) ? selectedMachine : '';
    const deviceAccount = provider === 'antigravity' && managedRuntime;
    if (deviceAccount && !confirmAntigravity()) return;
    const profileId = crypto.randomUUID();
    let reserved = false;
    let created = false;
    setBusy(`prepare-${provider}`);
    try {
      if (window.relayDesktop) {
        await window.relayDesktop.profiles({
          action: 'reserve',
          profileId,
          name: `${provider} profile`,
          provider,
        });
        reserved = true;
      }
      if (window.relayDesktop && !runnerId && provider !== 'claude')
        await window.relayDesktop.prepareProvider(provider);
      const result = await perform<{ member: Member; login: LoginResult }>(
        'connect-account',
        '/accounts/connect',
        {
          profileId,
          provider,
          managedRuntime,
          ...(deviceAccount ? { confirmDeviceAccount: true } : {}),
          ...(runnerId ? { runnerId } : {}),
        },
      );
      if (result) {
        created = true;
        if (window.relayDesktop)
          try {
            await window.relayDesktop.profiles({
              action: 'commit',
              profileId,
              name: result.member.name,
              provider: providerOf(result.member),
            });
          } catch (error) {
            setToast({
              text: `Profile created, but its Kivuno plan record could not be confirmed: ${(error as Error).message}`,
              error: true,
            });
          }
        if (provider === 'claude') saveClaudeClient(result.member.id, claudeClient || 'web');
        navigate('team');
        setModal(
          isExternalMember(result.member)
            ? { type: 'external', memberId: result.member.id, claudeClient }
            : { type: 'login', memberId: result.member.id, result: result.login },
        );
        if (provider === 'claude' && claudeClient === 'web')
          await beginClaudeAccount(result.member.id);
        else if (provider === 'claude' && claudeClient === 'desktop')
          await window.relayDesktop?.claudeClient('desktop');
      } else if (reserved && window.relayDesktop) {
        await window.relayDesktop.profiles({ action: 'release', profileId });
      }
    } catch (error) {
      let message = (error as Error).message;
      if (reserved && !created && window.relayDesktop)
        try {
          await window.relayDesktop.profiles({ action: 'release', profileId });
        } catch (releaseError) {
          message += ` Profile reservation cleanup also failed: ${(releaseError as Error).message}`;
        }
      setToast({ text: message, error: true });
    } finally {
      setBusy('');
    }
  }
  async function dismissSignIn() {
    if (modal?.type !== 'login') return;
    if (modal.result.loginId) {
      const result = await perform('cancel-login', `/members/${modal.memberId}/login/cancel`, {
        loginId: modal.result.loginId,
      });
      if (!result) return;
    }
    closeModal();
  }
  async function openSetup(member: Member) {
    if (member.entitlementLocked) {
      setToast({ text: 'This profile is locked by your current Kivuno plan.', error: true });
      return;
    }
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
        `Integrate “${task.title}” into the project's current branch as a squash commit? Kivuno integrates the reviewed changes only if the main working tree is clean.`,
      )
    )
      return;
    const result = await perform(
      'accept',
      `/tasks/${task.id}/accept`,
      {},
      task.sharedSadeJobId ? 'Task complete.' : 'Changes integrated. Task complete.',
    );
    if (result) closeModal();
    else setReviewRefresh((n) => n + 1);
  }

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
    <div
      className={`app ${sidebar ? 'sidebar-open' : ''} ${focusedSessionId ? 'session-popout' : ''}`}
      data-chat-room={chatRoom}
    >
      {sidebar && (
        <button
          className="sidebar-scrim"
          onClick={() => setSidebar(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="workspace-brand">
            <Logo />
            <small>Workspace</small>
          </div>
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
              onChange={(e) => {
                const id = e.target.value;
                if (view === 'mesh' && id) openChat({ kind: 'project', id });
                else setSelectedProject(id);
              }}
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
            {chatRoom === 'project' && project?.goal && (
              <small className="chat-project-summary" title={project.goal}>
                {project.goal}
              </small>
            )}
          </div>
          <ChevronDown size={13} />
        </div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <Fragment key={item.id}>
              <button
                onClick={() => navigate(item.id)}
                className={`nav-item ${view === item.id ? 'active' : ''}`}
                aria-current={view === item.id ? 'page' : undefined}
                aria-label={item.label}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.id === 'mesh' && projectRoster.length > 0 && (
                  <span className="nav-count" aria-hidden="true">
                    {projectRoster.length}
                  </span>
                )}
                {item.id === 'team' && members.length > 0 && (
                  <span className="nav-count">{members.length}</span>
                )}
                {item.id === 'reviews' && reviews.length + approvals.length > 0 && (
                  <span className="nav-count highlight">{reviews.length + approvals.length}</span>
                )}
              </button>
              {item.id === 'mesh' && projectRoster.length > 0 && (
                <div className="chat-sidebar-roster">
                  <p id="chat-roster-label">Project teammates</p>
                  <ul aria-labelledby="chat-roster-label">
                    {projectRoster.map((member) => {
                      const presence =
                        member.presence ||
                        (member.status === 'offline' || member.status === 'error'
                          ? 'offline'
                          : 'online');
                      return (
                        <li key={member.id}>
                          <span
                            className="chat-avatar"
                            style={{ '--avatar-color': member.color } as React.CSSProperties}
                            aria-hidden="true"
                          >
                            {member.name.slice(0, 1).toUpperCase()}
                            <i className={`presence-dot ${presence}`} />
                          </span>
                          <span>
                            <strong>{member.name}</strong>
                            <small>{providerLabels[providerOf(member)]}</small>
                            <span className="sr-only">{presence}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </Fragment>
          ))}
          {window.relayDesktop ? (
            <button
              className="nav-item"
              onClick={() => void openBilling()}
              title="Mở trang gói của tài khoản trong trình duyệt"
            >
              <CreditCard size={18} />
              <span>Gói &amp; thanh toán</span>
            </button>
          ) : (
            <a className="nav-item" href="/billing">
              <CreditCard size={18} />
              <span>Gói &amp; thanh toán</span>
            </a>
          )}
          <details
            className="advanced-nav"
            open={advancedNav.some((item) => item.id === view) || undefined}
          >
            <summary>Advanced</summary>
            {advancedNav.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}
                aria-current={view === item.id ? 'page' : undefined}
                aria-label={item.label}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
              </button>
            ))}
          </details>
        </nav>
        <button className="sidebar-invite" onClick={() => setModal({ type: 'project' })}>
          <Plus size={14} /> {cloud ? 'New project' : 'Connect project'}
        </button>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
            aria-current={view === 'settings' ? 'page' : undefined}
          >
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
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
            <span className="breadcrumb-project">
              {view === 'mesh' && chatRoom !== 'project'
                ? 'Workspace'
                : project?.name || 'Workspace'}
            </span>
            <span className="breadcrumb-slash">/</span>
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-actions">
            {state && !focusedSessionId && (
              <UsageGuide stage={view} enabled={!modal} cloud={cloud} />
            )}
            {!connected && (
              <span className="connection-label" role="status">
                {state ? 'Reconnecting' : 'Connecting'}
              </span>
            )}
            <button
              className="icon-button"
              aria-label={theme === 'dark' ? 'Use light mode' : 'Use dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
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
            {(cloud || window.relayDesktop) && (
              <button
                className="icon-button"
                aria-label="Sign out of workspace"
                title="Sign out of workspace"
                onClick={() => window.dispatchEvent(new Event('relay-sign-out'))}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </header>

        <main
          className={`main-content view-${view}`}
          data-usage={view === 'reviews' ? 'review-content' : undefined}
        >
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

          {view === 'mesh' && state && (
            <div
              className="chat-workspace-frame"
              data-pane={showChatDetail && selectedChat ? 'room' : 'list'}
            >
              <ChatHome
                state={state}
                listing={chatGroups.listing}
                error={chatGroups.error}
                selected={selectedChat}
                open={openChat}
                createProject={() => setModal({ type: 'project' })}
                enterGroup={
                  canShareGroups ? (mode) => setModal({ type: 'group-entry', mode }) : undefined
                }
                slides={deckChatEnabled}
                railRef={chatRail}
              >
                {canShareGroups && (
                  <SharedGroupListExtras
                    listing={chatGroups.listing}
                    onOpen={(id) => openChat({ kind: 'shared', id })}
                    onChanged={refreshChatGroups}
                  />
                )}
              </ChatHome>
              <section
                className="chat-room-panel"
                aria-label="Conversation"
                tabIndex={-1}
                ref={chatConversation}
              >
                {selectedChat && (
                  <button
                    type="button"
                    className="chat-room-back text-button"
                    onClick={backToChatList}
                  >
                    <ArrowLeft size={16} aria-hidden="true" /> Back to chats
                  </button>
                )}
                {selectedChat?.kind === 'shared' && canShareGroups ? (
                  <SharedGroups
                    key={selectedChat.id}
                    members={availableMembers}
                    projects={state.projects}
                    sessions={state.sessions}
                    addTeammate={() => setModal({ type: 'connect' })}
                    groupId={selectedChat.id}
                    listing={chatGroups.listing}
                    onGroupsChanged={refreshChatGroups}
                    onLeave={() => {
                      setSelectedChat(null);
                      backToChatList();
                    }}
                  />
                ) : selectedChat?.kind === 'project' ? (
                  <MeshPage
                    key={selectedChat.id}
                    state={state}
                    project={state.projects.find((item) => item.id === selectedChat.id)}
                    busy={pending}
                    request={foundationRequest}
                    selectProject={(id) => openChat({ kind: 'project', id })}
                    addProject={() => setModal({ type: 'project' })}
                    openSessions={() => navigate('sessions')}
                    makeDeck={
                      deckChatEnabled
                        ? (prompt) => {
                            if (!deckChat.submit(prompt)) return false;
                            openChat({ kind: 'slides' });
                            return true;
                          }
                        : undefined
                    }
                  />
                ) : deckChatEnabled && selectedChat?.kind === 'slides' ? (
                  <div className="chat-room-slides">
                    <SadeDeckChat deckChat={deckChat} />
                  </div>
                ) : (
                  <div className="chat-room-placeholder">
                    <MessageSquare size={28} aria-hidden="true" />
                    <h2>Select a chat</h2>
                    <p>Choose a conversation or use the plus button to start one.</p>
                  </div>
                )}
              </section>
            </div>
          )}
          {view === 'aegis' && state && <Aegis state={state} project={project} />}
          {view === 'sessions' && state && (
            <SessionsPage
              state={state}
              project={project}
              busy={pending}
              request={foundationRequest}
              addProject={() => setModal({ type: 'project' })}
              focusedId={focusedSessionId || undefined}
            />
          )}
          {view === 'workroom' && (
            <Workroom
              key={project?.id || 'empty'}
              state={state}
              project={project}
              busy={pending}
              openTask={openDetail}
              addProject={() => setModal({ type: 'project' })}
              addMember={() => setModal({ type: 'connect' })}
              manageTeam={() => navigate('team')}
              review={() => navigate('reviews')}
              start={async (prompt) =>
                project
                  ? perform<Workflow>('workflow', `/projects/${project.id}/workflows`, {
                      prompt,
                    })
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
                <Button
                  primary
                  guide="add-account"
                  disabled={pending}
                  onClick={() => setModal({ type: 'connect' })}
                >
                  <Plus size={16} /> Add account
                </Button>
              </section>
              <Machines
                selected={selectedMachine}
                onSelect={setSelectedMachine}
                cloud={cloud}
                projects={state?.projects || []}
              />
              <div className="team-grid">
                {members.map((member) => (
                  <div className="account-card-group" key={member.id}>
                    <MemberCard
                      member={member}
                      quota={state?.quotas.find((entry) => entry.memberId === member.id)}
                      task={tasks.find(
                        (t) =>
                          t.assignedTo === member.id && ['running', 'review'].includes(t.status),
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
                      modelSaved={(preferredModel) =>
                        setState(
                          (current) =>
                            current && {
                              ...current,
                              members: current.members.map((entry) =>
                                entry.id === member.id ? { ...entry, preferredModel } : entry,
                              ),
                            },
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
                      external={() => setModal({ type: 'external', memberId: member.id })}
                      googleSignIn={() => void antigravityGoogleSignIn(member)}
                      remove={() => {
                        if (
                          window.confirm(
                            `Remove ${member.name} from your team and project groups? This signs the account out. Project files and history are kept.`,
                          )
                        )
                          void perform(
                            `remove-${member.id}`,
                            `/members/${member.id}`,
                            {},
                            'Teammate removed.',
                            'DELETE',
                          );
                      }}
                    >
                      <div className="account-control-panel" data-usage="account-controls">
                        {providerOf(member) !== 'codex' && !isExternalMember(member) ? (
                          <ProviderTurnAllowance
                            member={member}
                            state={state!}
                            busy={pending}
                            request={foundationRequest}
                          />
                        ) : providerOf(member) === 'codex' ? (
                          <QuotaCard
                            member={member}
                            project={project}
                            state={state!}
                            busy={pending}
                            request={foundationRequest}
                          />
                        ) : (
                          <span className="provider-tag">Quota unknown</span>
                        )}
                        <AccountSettings
                          member={member}
                          busy={pending}
                          request={foundationRequest}
                        />
                      </div>
                    </MemberCard>
                  </div>
                ))}
                {!members.length && (
                  <div className="panel compact-empty">
                    <Users size={22} />
                    <span>No accounts</span>
                    <Button disabled={pending} onClick={() => setModal({ type: 'connect' })}>
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
                <div className="heading-actions" data-usage="task-actions">
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
                <section className="panel settings-panel" data-usage="project-settings">
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
                      <Terminal size={17} /> {cloud ? 'Cloud runtime' : 'Local runtime'}
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
                      <dt>Kivuno</dt>
                      <dd className="mono">v{state?.runtime.version || '0.1.0'}</dd>
                    </div>
                    <div>
                      <dt>Platform</dt>
                      <dd>{state?.runtime.platform || '—'}</dd>
                    </div>
                    <div className="runtime-path">
                      <dt>{cloud ? 'Cloud data' : 'Local data'}</dt>
                      <dd className="mono">{state?.runtime.dataDir || '—'}</dd>
                    </div>
                    {cloud && state?.runtime.expiresAt && (
                      <div>
                        <dt>Cloud run ends</dt>
                        <dd>{new Date(state.runtime.expiresAt).toLocaleString()}</dd>
                      </div>
                    )}
                  </dl>
                  {!state?.runtime.codexAvailable && (
                    <HelpDetails title="Install Codex">
                      <p>Install the official Codex CLI, then restart Kivuno.</p>
                      <code>npm install -g @openai/codex</code>
                    </HelpDetails>
                  )}
                </section>
              </div>
              {state?.runtime.recoveryRequired && (
                <section className="panel recovery-panel">
                  <AlertTriangle size={24} />
                  <div>
                    <h3>Recover interrupted tasks</h3>
                    <HelpDetails title="Recovery requirements">
                      <p>
                        Stop any orphan Codex processes from the previous Kivuno session before
                        releasing their locks. Releasing a lock while an old worker is still running
                        can create conflicting work.
                      </p>
                    </HelpDetails>
                    <Button
                      disabled={pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            'I have verified that Codex processes from the interrupted Kivuno session have stopped. Release their stale task locks?',
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

      {modal?.type === 'connect' && (
        <Modal title="Add account" close={closeModal}>
          <ProviderConnect
            members={members}
            busy={pending}
            runnerId={selectedMachine || undefined}
            connect={connectAccount}
            profile={() => setModal({ type: 'member' })}
          />
        </Modal>
      )}
      {modal?.type === 'external' &&
        members.find((member) => member.id === modal.memberId && !member.entitlementLocked) && (
          <Modal
            title={`${providerLabels[providerOf(members.find((member) => member.id === modal.memberId))]} · ${members.find((member) => member.id === modal.memberId)?.provider === 'claude' ? 'Connect' : 'MESH connection'}`}
            close={closeModal}
          >
            <ExternalConnection
              initialClaudeClient={modal.claudeClient}
              member={members.find((member) => member.id === modal.memberId)!}
              projects={state?.projects || []}
              refreshProjects={refresh}
              googleBusy={pending}
              googleSignIn={() =>
                void antigravityGoogleSignIn(
                  members.find((member) => member.id === modal.memberId)!,
                )
              }
            />
          </Modal>
        )}
      {modal?.type === 'member' && (
        <Modal title="Add account" close={closeModal}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const profileId = crypto.randomUUID();
              const name = String(data.get('name') || '').trim();
              let reserved = false;
              let created = false;
              try {
                if (window.relayDesktop) {
                  await window.relayDesktop.profiles({
                    action: 'reserve',
                    profileId,
                    name,
                    provider: profileProvider,
                  });
                  reserved = true;
                }
                const result = await perform<Member>(
                  'create-member',
                  '/members',
                  {
                    profileId,
                    name,
                    role: data.get('role'),
                    color: data.get('color'),
                    provider: profileProvider,
                  },
                  'Profile created. Sign in to connect this agent.',
                );
                if (result) {
                  created = true;
                  if (window.relayDesktop)
                    try {
                      await window.relayDesktop.profiles({
                        action: 'commit',
                        profileId,
                        name: result.name,
                        provider: profileProvider,
                      });
                    } catch (error) {
                      setToast({
                        text: `Profile created, but its Kivuno plan record could not be confirmed: ${(error as Error).message}`,
                        error: true,
                      });
                    }
                  closeModal();
                  navigate('team');
                } else if (reserved && window.relayDesktop) {
                  await window.relayDesktop.profiles({ action: 'release', profileId });
                }
              } catch (error) {
                let message = (error as Error).message;
                if (reserved && !created && window.relayDesktop)
                  try {
                    await window.relayDesktop.profiles({ action: 'release', profileId });
                  } catch (releaseError) {
                    message += ` Profile reservation cleanup also failed: ${(releaseError as Error).message}`;
                  }
                setToast({ text: message, error: true });
              }
            }}
          >
            <ProviderPicker value={profileProvider} change={setProfileProvider} />
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

      {modal?.type === 'group-entry' && (
        <SharedGroupEntryDialog
          mode={modal.mode}
          onClose={closeModal}
          onOpen={(id) => {
            refreshChatGroups();
            openChat({ kind: 'shared', id });
            closeModal();
          }}
        />
      )}

      {modal?.type === 'project' && (
        <Modal title={cloud ? 'New project' : 'Connect project'} close={closeModal}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const goal = String(data.get('goal') ?? '').trim();
              let deadline: string | null = null;
              try {
                if (projectMode === 'hackathon') deadline = deadlineFromForm(data);
              } catch (error) {
                setToast({ text: (error as Error).message, error: true });
                return;
              }
              const result = await perform<Project>(
                'create-project',
                projectMode === 'hackathon' ? '/hackathons' : '/projects',
                projectMode === 'hackathon'
                  ? {
                      name: data.get('name'),
                      memberId: data.get('memberId'),
                      competitionName: data.get('competitionName'),
                      competitionUrl: data.get('competitionUrl'),
                      deadline,
                      goal,
                    }
                  : {
                      name: data.get('name'),
                      path: data.get('path'),
                      goal,
                      initializeGit: projectMode === 'initialize',
                    },
                projectMode === 'initialize'
                  ? 'Folder initialized and connected. Nothing was pushed.'
                  : 'Project connected. Your room is ready.',
              );
              if (result) {
                if (view !== 'mesh') navigate('mesh');
                openChat({ kind: 'project', id: result.id });
                closeModal();
              }
            }}
          >
            {!cloud && (
              <label>
                Project type
                <select
                  aria-label="Project type"
                  value={projectMode}
                  onChange={(event) =>
                    setProjectMode(event.target.value as 'existing' | 'initialize' | 'hackathon')
                  }
                >
                  <option value="existing">Open an existing Git project</option>
                  <option value="initialize">Start from a folder</option>
                  <option value="hackathon">New hackathon project</option>
                </select>
              </label>
            )}
            {projectMode === 'initialize' && (
              <p className="form-note" role="note">
                Choose a folder for your work. Kivuno will save a starting version so changes can be
                reviewed. Common credential files are excluded. Connecting a folder does not upload
                it. When AI works, relevant content is sent to the AI providers you select.
              </p>
            )}
            <label>
              Project name
              <input name="name" required maxLength={80} placeholder="Project name" />
            </label>
            {projectMode === 'hackathon' ? (
              <>
                <label>
                  Project owner
                  <select aria-label="Project owner" name="memberId" required defaultValue="">
                    <option value="">Choose profile</option>
                    {availableMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Competition
                  <input name="competitionName" required maxLength={100} />
                </label>
                <label>
                  Competition URL
                  <input name="competitionUrl" type="url" required placeholder="https://…" />
                </label>
                <DeadlineField />
              </>
            ) : (
              <label>
                Project folder
                <input
                  name="path"
                  value={repositoryPath}
                  onChange={(event) => setRepositoryPath(event.target.value)}
                  required
                  placeholder="D:\projects\your-project"
                  className="mono"
                />
                {window.relayDesktop && (
                  <button
                    className="button"
                    type="button"
                    onClick={() =>
                      void window
                        .relayDesktop!.chooseDirectory()
                        .then((value) => {
                          if (value) setRepositoryPath(value);
                        })
                        .catch((error) => setToast({ text: error.message, error: true }))
                    }
                  >
                    Choose folder
                  </button>
                )}
              </label>
            )}
            <label>
              What would you like to achieve? (optional)
              <textarea
                name="goal"
                rows={3}
                placeholder="What are we building, and what does success look like?"
                maxLength={5000}
              />
            </label>
            <div className="modal-footer">
              <Button onClick={closeModal}>Cancel</Button>
              <Button primary type="submit" disabled={pending}>
                <FolderGit2 size={15} />{' '}
                {projectMode === 'hackathon'
                  ? 'Create project'
                  : projectMode === 'initialize'
                    ? 'Start project'
                    : 'Connect project'}
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
                  {availableMembers.map((m) => (
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
                <legend>Dependencies</legend>
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
          title={
            modal.result.type.startsWith('antigravity')
              ? 'Antigravity connection'
              : modal.result.type === 'claudeSubscription'
                ? 'Claude sign-in'
                : /Google/.test(modal.result.type)
                  ? 'Google sign-in'
                  : 'OpenAI sign-in'
          }
          eyebrow={members.find((m) => m.id === modal.memberId)?.name || 'ACCOUNT SIGN-IN'}
          close={() => void dismissSignIn()}
        >
          <ProviderSignIn
            memberId={modal.memberId}
            member={members.find((m) => m.id === modal.memberId)}
            result={modal.result}
            close={closeModal}
            cancel={dismissSignIn}
          />
        </Modal>
      )}

      {modal?.type === 'setup' && (
        <Modal title="Skills & plugins" close={closeModal}>
          <div className="setup-content">
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
            <HelpDetails title="Setup steps">
              <p>{modal.instructions}</p>
            </HelpDetails>
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
                    {diff.machineChecks && (
                      <section
                        aria-label="Paired-machine checks"
                        className="detail-section machine-checks"
                      >
                        <h3>Paired-machine checks</h3>
                        <Button disabled={pending} onClick={() => setReviewRefresh((n) => n + 1)}>
                          Refresh checks
                        </Button>
                        {!diff.machineChecks.passed &&
                          diff.machineChecks.attempts.every(
                            (check) => check.purpose === 'diagnostic',
                          ) && <p>This task needs a verification check on the paired machine.</p>}
                        {diff.machineChecks.attempts
                          .slice()
                          .reverse()
                          .map((check) => (
                            <details key={check.id} open={check.current || undefined}>
                              <summary>
                                {check.purpose === 'diagnostic' && 'Diagnostic · '}
                                {check.runner} · {check.platform}/{check.arch} · {check.status}
                                {!check.current && ' (previous attempt)'}
                              </summary>
                              <p>
                                <code>{check.command}</code>
                              </p>
                              <p>
                                {new Date(check.started).toLocaleString()}
                                {check.timedOut
                                  ? ' · timed out'
                                  : check.code != null
                                    ? ` · exit ${check.code}`
                                    : ''}
                              </p>
                              {check.input && (
                                <p>
                                  Tested input <code>{check.input}</code>
                                </p>
                              )}
                              {check.base && (
                                <p>
                                  Git base <code>{check.base}</code>
                                </p>
                              )}
                              {check.signer && (
                                <p>
                                  Runner key fingerprint <code>{check.signer}</code>
                                </p>
                              )}
                              {check.output && (
                                <p>
                                  Output digest <code>{check.output}</code>
                                </p>
                              )}
                              {check.runId && (
                                <Button
                                  onClick={async () => {
                                    try {
                                      const manifest = await api(
                                        '/tasks/' + selectedTask.id + '/checks/' + check.id,
                                      );
                                      const url = URL.createObjectURL(
                                        new Blob([JSON.stringify(manifest, null, 2)], {
                                          type: 'application/json',
                                        }),
                                      );
                                      const a = document.createElement('a');
                                      a.href = url;
                                      a.download = 'paired-check-' + check.id + '.json';
                                      a.click();
                                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                                    } catch (error) {
                                      setToast({ text: (error as Error).message, error: true });
                                    }
                                  }}
                                >
                                  Export signed result
                                </Button>
                              )}
                              {check.release && (
                                <p>
                                  {check.platform} {check.release} · runner Node {check.runtime}
                                </p>
                              )}
                              {check.error && <p className="error-text">{check.error}</p>}
                              {check.current &&
                                check.repeatable &&
                                check.status !== 'preparing' &&
                                selectedTask.status === 'review' && (
                                  <Button
                                    disabled={pending}
                                    onClick={async () => {
                                      if (
                                        !window.confirm(
                                          check.status === 'awaiting result'
                                            ? `A result is still pending. Start a separate run of ${check.command} on ${check.runner}?`
                                            : `Sync this worktree to ${check.runner} and run ${check.command} again?`,
                                        )
                                      )
                                        return;
                                      await perform(
                                        'machine-check',
                                        `/tasks/${selectedTask.id}/machine-check`,
                                        { checkId: check.id, clientRequestId: check.id },
                                        'Paired-machine review updated.',
                                      );
                                      setReviewRefresh((n) => n + 1);
                                    }}
                                  >
                                    {check.status === 'awaiting result'
                                      ? 'Start a separate check on'
                                      : 'Rerun on'}{' '}
                                    {check.runner}
                                  </Button>
                                )}
                            </details>
                          ))}
                      </section>
                    )}
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
                {selectedTask.status === 'running' &&
                  !isExternalMember(
                    members.find((member) => member.id === selectedTask.assignedTo),
                  ) && (
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
                        {availableMembers
                          .filter(
                            (m) =>
                              m.status === 'ready' &&
                              !m.entitlementLocked &&
                              !isExternalMember(m) &&
                              project?.memberIds?.includes(m.id) &&
                              !tasks.some(
                                (t) =>
                                  t.assignedTo === m.id && ['running', 'review'].includes(t.status),
                              ),
                          )
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} · {providerLabels[providerOf(m)]}
                              {m.status !== 'ready' ? ' (not ready)' : ''}
                            </option>
                          ))}
                      </select>
                      <Button
                        primary
                        disabled={
                          pending ||
                          !(detailMember || selectedTask.assignedTo) ||
                          isExternalMember(
                            members.find(
                              (member) => member.id === (detailMember || selectedTask.assignedTo),
                            ),
                          )
                        }
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
                    {state?.workflows.some(
                      (workflow) =>
                        workflow.id === selectedTask.workflowId && workflow.orchestrator === 'sade',
                    ) && (
                      <Button
                        disabled={pending}
                        onClick={() =>
                          void perform(
                            'sade-review',
                            `/tasks/${selectedTask.id}/sade-review`,
                            {},
                            'Sade review checked. See the project chat for details.',
                          )
                        }
                      >
                        Retry Sade review
                      </Button>
                    )}
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
                      disabled={
                        pending || !diff || !!diffError || diff.machineChecks?.passed === false
                      }
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
                {selectedTask.status === 'done' &&
                  selectedTask.sharedSadeNeedsPublication &&
                  selectedTask.worktree && (
                    <Button
                      disabled={pending}
                      onClick={() =>
                        void perform(
                          'share-sade-revision',
                          `/tasks/${selectedTask.id}/share-sade-revision`,
                          {},
                          'Shared the reviewed Git revision with the group.',
                        )
                      }
                    >
                      Share published revision
                    </Button>
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
  quota,
  task,
  busy,
  login,
  refresh,
  modelSaved,
  logout,
  importSkills,
  openTask,
  setup,
  external,
  googleSignIn,
  remove,
  children,
}: {
  member: Member;
  quota?: AccountQuota;
  task?: Task;
  busy: boolean;
  login: (method: 'browser' | 'device') => void;
  refresh: () => void;
  modelSaved: (model: string | undefined) => void;
  logout: () => void;
  importSkills: () => void;
  openTask: (task: Task) => void;
  setup: () => void;
  external: () => void;
  googleSignIn: () => void;
  remove: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [usageError, setUsageError] = useState('');
  const provider = providerOf(member);
  const { account: claudeAccount } = useClaudeAccount(
    provider === 'claude' && !member.entitlementLocked ? member.id : undefined,
  );
  const codeAccount = useClaudeCodeAccount(
    provider === 'claude' && !member.entitlementLocked ? member.id : undefined,
  );
  const webStatus =
    provider === 'claude' && !member.entitlementLocked ? claudeAccount?.status : undefined;
  const presence = codeAccount?.signedIn
    ? 'signed in'
    : webStatus === 'connected' || webStatus === 'pending'
      ? webStatus
      : member.presence || 'offline';
  return (
    <section className="panel member-card" data-usage="account-card">
      <div className="member-top">
        <Avatar member={member} size="large" />
        <div className="member-identity">
          <h2>{member.name}</h2>
          <span className="role-label">
            {providerLabels[provider]} · {member.runnerName}
          </span>
          {member.entitlementLocked && (
            <span className="quota-state blocked" role="status">
              <LockKeyhole size={12} /> Locked by Kivuno plan
            </span>
          )}
        </div>
        <span className={`member-presence ${presence}`}>
          <i />
          {presence === 'connected'
            ? 'Claude connected'
            : presence === 'online' &&
                provider === 'antigravity' &&
                member.account &&
                !isExternalMember(member)
              ? 'Antigravity connected'
              : presence}
        </span>
      </div>
      <div className="member-account">
        <span>
          {provider === 'antigravity'
            ? isExternalMember(member)
              ? 'Google sign-in is managed by Antigravity'
              : member.account
                ? 'Connected to Antigravity on this computer'
                : 'Device account disconnected'
            : codeAccount?.signedIn
              ? `Claude Code · ${codeAccount.email || 'Signed in on this computer'}`
              : webStatus === 'connected'
                ? 'Claude account linked'
                : webStatus === 'pending'
                  ? 'Waiting for Claude'
                  : member.account?.email ||
                    (member.account ? 'Email unavailable' : 'Not signed in')}
        </span>
        {member.account?.planType && member.account.planType !== 'unknown' && (
          <span className="plan-tag">{member.account.planType}</span>
        )}
      </div>
      <div className="member-quota" aria-label={`${member.name} usage`}>
        <div className="member-quota-title">
          <span>Usage</span>
          {quota && ['stale', 'unknown'].includes(quota.status) && quota.windows.length > 0 && (
            <span className={`quota-state ${quota.status}`}>
              {quota.status === 'stale' ? 'Stale' : 'Unverified'}
            </span>
          )}
        </div>
        {member.account && quota?.windows.length ? (
          quota.windows.map((window) => (
            <div className="member-quota-window" key={window.id}>
              <span>{window.label}</span>
              <meter
                min={0}
                max={100}
                low={50}
                optimum={100}
                value={window.remainingPercent}
                aria-label={`${member.name} ${window.label} quota remaining`}
              />
              <strong>{Math.round(window.remainingPercent)}% left</strong>
            </div>
          ))
        ) : provider === 'claude' ? (
          <>
            <button
              className="text-button"
              onClick={() =>
                void openExternal('https://claude.ai/settings/usage').catch((cause) =>
                  setUsageError(cause.message),
                )
              }
            >
              View usage on Claude
            </button>
            <small>
              Detailed usage requires a supported paid Claude plan. Free does not include this
              dashboard.
            </small>
          </>
        ) : provider === 'antigravity' ? (
          <small>
            Antigravity does not provide quota totals to Kivuno. Check /usage in the official
            Antigravity CLI. This is separate from sign-in status.
          </small>
        ) : (
          <span className="quota-unknown">Unavailable</span>
        )}
      </div>
      {usageError && (
        <p className="member-error" role="alert">
          {usageError}
        </p>
      )}
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
      <button
        className="capability-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span>
          <Layers3 size={14} />
          {member.capabilitiesLoading ? (
            <>
              <Loader2 size={13} className="spin" /> Loading skills & plugins…
            </>
          ) : (
            <>
              {provider === 'antigravity' && !isExternalMember(member) ? (
                'Skills and plugins are managed in Antigravity'
              ) : (
                <>
                  {member.skills.length} skills<span className="divider-dot">·</span>
                  {member.plugins.length} plugins
                </>
              )}
            </>
          )}
        </span>
        <ChevronDown size={14} className={expanded ? 'rotated' : ''} />
      </button>
      {expanded && (
        <div className="capability-list">
          {member.skills.length > 0 && <h4>AVAILABLE SKILLS</h4>}
          {member.skills.length > 0 && (
            <div className="chips">
              {member.skills.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          )}
          {member.plugins.length > 0 && <h4>INSTALLED PLUGINS</h4>}
          {member.plugins.length > 0 && (
            <div className="chips">
              {member.plugins.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          )}
          {member.capabilitiesError && <p className="error-text">{member.capabilitiesError}</p>}
          {provider === 'codex' && (
            <button
              className="text-button accent"
              onClick={importSkills}
              disabled={busy || member.entitlementLocked}
            >
              <ArrowDownLeft size={14} /> Import local skills
            </button>
          )}
          {provider === 'codex' ? (
            <button
              className="text-button capability-setup"
              onClick={setup}
              disabled={member.entitlementLocked}
            >
              <Terminal size={14} /> Configure skills & plugins
            </button>
          ) : (
            <HelpDetails title="Skill setup">
              <p>Configure skills and plugins in your {providerLabels[provider]} client.</p>
            </HelpDetails>
          )}
        </div>
      )}
      <div className={`member-actions ${provider === 'antigravity' ? 'antigravity-actions' : ''}`}>
        <div className="member-action-main">
          <TeamModelPicker member={member} busy={busy} onSaved={modelSaved} />
          {provider === 'antigravity' && isExternalMember(member) ? (
            <div className="member-provider-actions">
              <Button
                primary
                onClick={googleSignIn}
                disabled={busy || member.entitlementLocked}
                title="Verify this computer’s Antigravity account or open official Google sign-in."
              >
                <ArrowUpRight size={15} /> Connect Antigravity
              </Button>
              <Button onClick={external} disabled={busy || member.entitlementLocked}>
                <ExternalLink size={15} /> MESH connection
              </Button>
            </div>
          ) : isExternalMember(member) ? (
            <Button primary onClick={external} disabled={busy || member.entitlementLocked}>
              <ExternalLink size={15} />
              {provider === 'claude'
                ? webStatus === 'connected'
                  ? 'Manage Claude connection'
                  : 'Connect Claude'
                : 'MESH connection'}
            </Button>
          ) : member.account ? (
            <>
              <Button onClick={refresh} disabled={busy || member.entitlementLocked}>
                <RefreshCw size={14} /> Refresh
              </Button>
            </>
          ) : (
            <>
              <Button
                primary
                onClick={() => login(member.runnerId ? 'device' : 'browser')}
                disabled={busy || member.entitlementLocked}
              >
                <ArrowUpRight size={15} />{' '}
                {provider === 'antigravity' ? 'Connect device account' : 'Sign in with OpenAI'}
              </Button>
              {provider === 'codex' && (
                <button
                  className="text-button"
                  disabled={busy || member.entitlementLocked}
                  onClick={() => login('browser')}
                >
                  Browser sign-in
                </button>
              )}
            </>
          )}
        </div>
        <button
          className="icon-button member-remove"
          aria-label={`Remove ${member.name} from team`}
          title="Remove from team"
          disabled={busy}
          onClick={remove}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <details className="member-settings">
        <summary>Settings</summary>
        {member.entitlementLocked ? (
          <p className="quota-unknown" role="status">
            This profile is retained, but plan locked profiles cannot change settings or run.
          </p>
        ) : (
          children
        )}
        {(member.account || member.deviceAccountLinked) && !isExternalMember(member) && (
          <button
            className="text-button"
            disabled={busy || (!member.entitlementLocked && member.status === 'working')}
            onClick={() => {
              if (
                window.confirm(
                  provider === 'antigravity'
                    ? 'Disconnect the Antigravity device account from Kivuno?'
                    : `Sign ${member.name} out?`,
                )
              )
                logout();
            }}
          >
            <LogOut size={14} />{' '}
            {provider === 'antigravity' ? 'Disconnect device account' : 'Sign out'}
          </button>
        )}
      </details>
    </section>
  );
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
        <textarea name="goal" rows={3} defaultValue={project.goal} maxLength={5000} />
      </label>
      <Button type="submit" disabled={busy}>
        Save changes
        <Check size={14} />
      </Button>
    </form>
  );
}
