export type Role = 'engineer' | 'researcher' | 'designer' | 'reviewer';
export type ProviderId = 'codex' | 'gemini' | 'claude' | 'antigravity';
export interface ProviderCapability {
  id: ProviderId;
  label: string;
  mode: 'native' | 'external';
  available: boolean;
  installable?: boolean;
  login: 'chatgpt' | 'google' | 'external';
  quota: 'provider' | 'unknown';
  models: boolean;
  reasoning: boolean;
  reason?: string;
  managed?: { available: boolean; models: boolean; reasoning: boolean };
}
export interface ProviderTurnGrant {
  id: string;
  memberId: string;
  projectId: string;
  maxTurns: number;
  usedTurns: number;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
}
export type TaskStatus = 'backlog' | 'ready' | 'running' | 'review' | 'done' | 'blocked';
export type TaskKind = 'code' | 'research' | 'design' | 'review';
export interface ChatConfig {
  model?: string;
  reasoningEffort?: string;
  skills?: string[];
}
export interface MessageReaction {
  emoji: 'heart' | 'up' | 'down';
  actorId: 'human';
  meaning: 'understood' | 'agree' | 'disagree';
  createdAt: string;
}
export interface GroupIntroduction {
  id: string;
  projectId: string;
  memberId: string;
  status: 'ready';
  skills: string[];
  plugins: string[];
  agreement: string;
  createdAt: string;
}
export interface HumanPresence {
  projectId: string;
  status: 'online' | 'offline';
  lastSeen: string;
}
export interface Member {
  signIn?: {
    state: 'starting' | 'waiting' | 'verifying' | 'connected' | 'cancelled' | 'error';
    startedAt: string;
    error?: string;
  };
  provider?: ProviderId;
  integration?: 'native' | 'external';
  /** Explicit human opt-in to Kivuno starting the official local CLI. */
  managedRuntime?: boolean;
  externalLastSeen?: string;
  presence?: 'online' | 'offline' | 'busy';
  activeSessions?: number;
  id: string;
  name: string;
  role: Role;
  color: string;
  status: 'offline' | 'connecting' | 'ready' | 'working' | 'error';
  account: { email?: string; planType?: string; type?: string } | null;
  skills: string[];
  plugins: string[];
  capabilitiesError?: string;
  capabilitiesLoading?: boolean;
  rateLimits: unknown;
  error?: string | null;
  createdAt: string;
  owner?: { login: string; name: string; email: string };
  maxSessions?: number;
  managed?: boolean;
  connectedAt?: string;
  /** Removed from the team; retained only for historical task/message attribution. */
  removedAt?: string;
  runnerId?: string;
  runnerName?: string;
}
export interface Project {
  /** Explicit group roster. Undefined exists only in pre-roster databases. */
  memberIds?: string[];
  chatConfig?: ChatConfig;
  id: string;
  name: string;
  path: string;
  goal: string;
  createdAt: string;
  ownerMemberId?: string;
  repositoryName?: string;
  competition?: { name: string; url: string; deadline: string | null };
}
export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
}
export interface Task {
  sharedSadeJobId?: string;
  sharedSadeNeedsPublication?: boolean;
  reviewOfTaskId?: string;
  humanQuestionId?: string;
  id: string;
  projectId: string;
  title: string;
  description: string;
  kind: TaskKind;
  status: TaskStatus;
  priority: 'high' | 'medium' | 'low';
  assignedTo: string | null;
  dependsOn: string[];
  scope: string[];
  acceptance: string;
  branch: string | null;
  worktree: string | null;
  baseCommit: string | null;
  threadId: string | null;
  turnId: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  workflowId?: string;
  phase?: 'proposal' | 'plan' | 'execution';
  parentTaskId?: string | null;
  stage?: string;
  effort?: number;
  planKey?: string;
  sessionId?: string;
}
export interface PlanTask {
  requiredPlatform?: 'win32' | 'darwin' | 'linux';
  preferredMemberId?: string;
  key: string;
  title: string;
  description: string;
  kind: TaskKind;
  scope: string[];
  dependsOn: string[];
  acceptance: string;
  effort: number;
  stage: string;
}
export interface TeamPlan {
  summary: string;
  tasks: PlanTask[];
}
export interface Proposal {
  summary: string;
  risks: string[];
  suggestions: {
    title: string;
    kind: TaskKind;
    scope: string[];
    acceptance: string;
    effort: number;
  }[];
}
export interface Workflow {
  orchestrator?: 'sade';
  requestId?: string;
  awaitingCompetitionApproval?: boolean;
  competitionApprovedAt?: string;
  id: string;
  controlVersion: number;
  projectId: string;
  prompt: string;
  status:
    | 'planning'
    | 'running'
    | 'review'
    | 'completed'
    | 'blocked'
    | 'paused'
    | 'cancelling'
    | 'cancelled';
  phase: 'proposals' | 'synthesis' | 'execution';
  leadId: string;
  memberIds: string[];
  contributions: { memberId: string; taskId: string; proposal: Proposal }[];
  plan: TeamPlan | null;
  hierarchy: { memberId: string; reportsTo: string | null; taskIds: string[]; effort: number }[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RoomMessage {
  clientRequestId?: string;
  requestedMentions?: string[];
  reactions?: MessageReaction[];
  effectiveConfig?: ChatConfig;
  command?: string;
  id: string;
  projectId: string;
  taskId: string | null;
  authorId: string | null;
  kind: 'message' | 'progress' | 'handoff' | 'blocker' | 'system';
  content: string;
  createdAt: string;
  sequence?: number;
  sessionId?: string | null;
  replyTo?: string | null;
  mentions?: string[];
  humanCommand?: boolean;
  requestStatus?: 'open' | 'claimed' | 'done';
  claimedBy?: string | null;
}
export interface CodexSession {
  pausedFor?: 'quota' | 'capacity';
  queuedPrompt?: string;
  provider?: ProviderId;
  external?: boolean;
  externalConnectionId?: string;
  skills?: string[];
  id: string;
  memberId: string;
  projectId: string;
  taskId: string;
  title: string;
  status:
    | 'idle'
    | 'starting'
    | 'running'
    | 'paused'
    | 'review'
    | 'stopped'
    | 'interrupted'
    | 'error'
    | 'handoff';
  readOnly: boolean;
  threadId: string | null;
  turnId: string | null;
  pid: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  model?: string | null;
  reasoningEffort?: string | null;
  modelPolicy?: 'auto' | 'manual';
  selectionReason?: string;
}
export interface SessionEvent {
  id: string;
  sessionId: string;
  kind: 'user' | 'agent' | 'command' | 'files' | 'system' | 'error';
  text: string;
  createdAt: string;
}
export interface QuotaWindow {
  id: string;
  label: string;
  usedPercent: number;
  remainingPercent: number;
  windowMinutes: number | null;
  resetsAt: number | null;
}
export interface AccountQuota {
  id: string;
  memberId: string;
  windows: QuotaWindow[];
  observedAt: string;
  source: 'provider';
  ordinaryUsageAllowed: boolean | null;
  status: 'available' | 'reserve' | 'unknown' | 'stale' | 'blocked';
  error: string | null;
}
export interface QuotaGrant {
  id: string;
  memberId: string;
  projectId: string;
  floor: number;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
}
export interface MeshCursor {
  id: string;
  projectId: string;
  memberId: string;
  readThrough: number;
  acknowledgedThrough: number;
  updatedAt: string;
}
export interface HumanRequest {
  id: string;
  projectId: string;
  kind: 'quota' | 'question' | 'recovery' | 'handoff';
  title: string;
  content: string;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
}
export interface Handoff {
  id: string;
  projectId: string;
  taskId: string;
  fromSessionId: string;
  toMemberId: string;
  toSessionId: string | null;
  status: 'checkpointing' | 'blocked' | 'awaiting_ack' | 'accepted' | 'cancelled';
  branch: string | null;
  commitSha: string | null;
  remote: string | null;
  summary: string;
  nextSteps: string;
  testEvidence: string;
  quota: AccountQuota | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Approval {
  id: string;
  memberId: string;
  taskId: string;
  method: string;
  description: string;
  details: unknown;
  createdAt: string;
}
export interface Activity {
  id: string;
  projectId: string | null;
  taskId: string | null;
  memberId: string | null;
  type: string;
  text: string;
  createdAt: string;
}
export interface WorkspaceState {
  competitionResearch?: {
    id: string;
    projectId: string;
    url: string;
    status: string;
    sourceCount: number;
    blocked: string[];
    notes: { category: string; status: string; sourceUrl?: string; finding: string }[];
  }[];
  providerTurnGrants?: ProviderTurnGrant[];
  groupIntroductions?: GroupIntroduction[];
  humanPresence?: HumanPresence[];
  projects: Project[];
  members: Member[];
  tasks: Task[];
  workflows: Workflow[];
  sessions: CodexSession[];
  quotas: AccountQuota[];
  quotaGrants: QuotaGrant[];
  meshCursors: MeshCursor[];
  humanRequests: HumanRequest[];
  handoffs: Handoff[];
  messages: RoomMessage[];
  approvals: Approval[];
  activity: Activity[];
  runtime: {
    codexAvailable: boolean;
    codexVersion: string;
    version: string;
    platform: string;
    dataDir: string;
    recoveryRequired: boolean;
    deployment?: 'local' | 'cloud';
    expiresAt?: string | null;
  };
}
export interface LoginResult {
  instructions?: string;
  type: string;
  loginId?: string;
  authUrl?: string;
  verificationUrl?: string;
  userCode?: string;
}
export interface MachineCheckView {
  id: string;
  current: boolean;
  status: 'passed' | 'stale' | 'failed' | 'unconfirmed' | 'awaiting result' | 'preparing';
  runner: string;
  platform: string;
  arch: string;
  command: string;
  started: string;
  finished?: string;
  input?: string;
  base?: string | null;
  signer?: string;
  output?: string;
  runId?: string;
  recipe?: string;
  release?: string;
  runtime?: string;
  code?: number | null;
  timedOut?: boolean;
  error?: string;
  repeatable: boolean;
}
export interface TaskDiff {
  machineChecks?: { passed: boolean; attempts: MachineCheckView[] };
  diff: string;
  files: string[];
  stat: string;
  truncated: boolean;
}
