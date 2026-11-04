import { useState, type FormEvent } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDot,
  Crown,
  GitBranch,
  GitMerge,
  ListTodo,
  Pause,
  Play,
  Plus,
  Send,
  Users,
  X,
} from 'lucide-react';
import type { Project, Task, Workflow, WorkspaceState } from '../shared/types';

const labels = {
  backlog: 'Backlog',
  ready: 'Queued',
  running: 'Working',
  review: 'Review',
  done: 'Done',
  blocked: 'Blocked',
};
const time = (date: string) =>
  new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const statusIcon = (task: Task) =>
  task.status === 'done' ? (
    <CircleCheck size={14} />
  ) : task.status === 'running' ? (
    <CircleDot size={14} />
  ) : (
    <Circle size={14} />
  );

export default function Workroom({
  state,
  project,
  busy,
  openTask,
  addProject,
  addMember,
  manageTeam,
  review,
  start,
  control,
  send,
}: {
  state: WorkspaceState | null;
  project?: Project;
  busy: boolean;
  openTask: (task: Task) => void;
  addProject: () => void;
  addMember: () => void;
  manageTeam: () => void;
  review: () => void;
  start: (prompt: string) => Promise<Workflow | undefined>;
  control: (workflow: Workflow, action: 'pause' | 'resume' | 'cancel') => Promise<unknown>;
  send: (content: string) => Promise<unknown>;
}) {
  const [prompt, setPrompt] = useState(() => {
    try {
      return sessionStorage.getItem(`kivuno-plan-draft-${project?.id}`) || '';
    } catch {
      return '';
    }
  });
  const [message, setMessage] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const members = (state?.members || []).filter((member) =>
    project?.memberIds?.includes(member.id),
  );
  const workflows = (state?.workflows || []).filter((w) => w.projectId === project?.id);
  const workflow = workflows.find((w) => w.id === workflowId) || workflows.at(-1);
  const currentWorkflow = workflows.find((w) => !['completed', 'cancelled'].includes(w.status));
  const tasks = (state?.tasks || []).filter((t) => t.projectId === project?.id);
  const workflowTasks = workflow ? tasks.filter((t) => t.workflowId === workflow.id) : tasks;
  const team = workflow
    ? workflow.memberIds.flatMap((id) => members.find((m) => m.id === id) || [])
    : members;
  const lead = team.find((m) => m.id === workflow?.leadId);
  const orderedTeam = lead ? [lead, ...team.filter((m) => m.id !== lead.id)] : team;
  const working = tasks.filter((t) => t.status === 'running').length;
  const attention =
    tasks.filter((t) => t.status === 'review').length +
    (state?.approvals.filter((a) => tasks.some((t) => t.id === a.taskId)).length || 0);
  const ready = members.filter((m) => !!m.account).length;
  const queue = workflowTasks.filter((t) => !t.phase || t.phase === 'execution');
  const phases = ['Proposals', 'Plan', 'Execute', 'Review', 'Done'];
  const phaseIndex = !workflow
    ? -1
    : workflow.status === 'completed'
      ? 4
      : workflow.status === 'review'
        ? 3
        : workflow.phase === 'execution'
          ? 2
          : workflow.phase === 'synthesis'
            ? 1
            : 0;
  const messages = (state?.messages || []).filter((m) => m.projectId === project?.id);
  const events = [
    ...messages.map((m) => ({
      id: m.id,
      memberId: m.authorId,
      taskId: m.taskId,
      type: m.kind,
      text: m.content,
      createdAt: m.createdAt,
      message: true,
    })),
    ...(state?.activity || [])
      .filter(
        (a) =>
          a.projectId === project?.id &&
          !messages.some(
            (m) => m.taskId === a.taskId && m.authorId === a.memberId && m.content === a.text,
          ),
      )
      .map((a) => ({ ...a, message: false })),
  ]
    .filter(
      (e) =>
        (agentFilter === 'all' || e.memberId === agentFilter) &&
        (eventFilter === 'all' ||
          (eventFilter === 'conversation'
            ? e.message
            : ['error', 'blocker', 'approval'].includes(e.type))),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 150);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) return;
    const result = await start(prompt.trim());
    if (result) {
      setPrompt('');
      try {
        sessionStorage.removeItem(`kivuno-plan-draft-${project?.id}`);
      } catch {
        /* Optional draft. */
      }
      setWorkflowId(result.id);
    }
  }
  async function post(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    if (await send(message.trim())) setMessage('');
  }

  return (
    <div className="workroom-layout">
      <section className="prompt-panel panel">
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor="team-prompt">
            Team prompt
          </label>
          <textarea
            id="team-prompt"
            data-usage="team-prompt"
            rows={2}
            value={prompt}
            maxLength={16000}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the team work on?"
            disabled={!project || busy || !!currentWorkflow}
          />
          <div className="prompt-toolbar">
            <div className="prompt-context">
              {!project ? (
                <button type="button" className="text-button" onClick={addProject}>
                  <Plus size={14} /> Connect project
                </button>
              ) : (
                <span>
                  <GitBranch size={14} />
                  {project.name}
                </span>
              )}
              {!ready ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={members.length ? manageTeam : addMember}
                >
                  <Users size={14} />
                  {members.length ? 'Connect accounts' : 'Add account'}
                </button>
              ) : (
                <button type="button" className="text-button" onClick={manageTeam}>
                  <Users size={14} />
                  {ready} connected
                </button>
              )}
            </div>
            <button
              className="button primary"
              type="submit"
              disabled={!project || !prompt.trim() || !members.length || busy || !!currentWorkflow}
            >
              <Play size={14} />
              Run team
            </button>
          </div>
        </form>
      </section>

      <section className="workflow-bar">
        <div className="workflow-title">
          <GitBranch size={16} />
          {workflow ? (
            <select
              aria-label="Workflow"
              value={workflow.id}
              onChange={(e) => setWorkflowId(e.target.value)}
            >
              {[...workflows].reverse().map((w) => (
                <option key={w.id} value={w.id}>
                  {w.prompt.slice(0, 90)}
                </option>
              ))}
            </select>
          ) : (
            <strong>Workflow</strong>
          )}
          {workflow && (
            <span className={`workflow-status ${workflow.status}`}>{workflow.status}</span>
          )}
        </div>
        {workflow && (
          <div className="workflow-controls">
            <span className="workflow-phase-label">{phases[phaseIndex]}</span>
            {!['completed', 'cancelled'].includes(workflow.status) && (
              <>
                <button
                  className="button compact"
                  disabled={busy || workflow.status === 'cancelling'}
                  onClick={() =>
                    void control(
                      workflow,
                      ['paused', 'blocked'].includes(workflow.status) ? 'resume' : 'pause',
                    )
                  }
                  title={
                    ['paused', 'blocked'].includes(workflow.status)
                      ? 'Resume workflow'
                      : 'Pause new tasks; active turns continue'
                  }
                >
                  {['paused', 'blocked'].includes(workflow.status) ? (
                    <>
                      <Play size={13} />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause size={13} />
                      Pause
                    </>
                  )}
                </button>
                <button
                  className="icon-button"
                  disabled={busy || workflow.status === 'cancelling'}
                  aria-label="Cancel workflow"
                  title="Stop workflow"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Stop this workflow and its active agents? Completed work and pending reviews are preserved.',
                      )
                    )
                      void control(workflow, 'cancel');
                  }}
                >
                  <X size={15} />
                </button>
              </>
            )}
          </div>
        )}
      </section>
      {workflow?.error && (
        <div className="error-banner" role="alert">
          {workflow.error}
        </div>
      )}
      {workflow && (
        <ol className="workflow-phases" aria-label="Workflow progress">
          {phases.map((phase, i) => (
            <li
              key={phase}
              className={i === phaseIndex ? 'current' : i < phaseIndex ? 'complete' : ''}
              aria-current={i === phaseIndex ? 'step' : undefined}
            >
              {i < phaseIndex ? <CircleCheck size={13} /> : <span>{i + 1}</span>}
              {phase}
              {i < phases.length - 1 && <ChevronRight size={13} />}
            </li>
          ))}
        </ol>
      )}

      <section className="panel hierarchy-panel" data-usage="workflow-team">
        <div className="panel-heading">
          <h2>
            <Users size={15} />
            Team<span className="count-bubble">{team.length}</span>
          </h2>
          <button className="text-button" onClick={manageTeam}>
            Manage
            <ChevronRight size={13} />
          </button>
        </div>
        {team.length ? (
          <div className="team-hierarchy" aria-label="Team hierarchy">
            {orderedTeam.map((member) => {
              const assignment = workflow?.hierarchy.find((node) => node.memberId === member.id);
              const memberTasks = workflowTasks.filter((t) => t.assignedTo === member.id);
              const current =
                memberTasks.find((t) => t.status === 'running') ||
                memberTasks.find((t) => t.status === 'review');
              const isLead = member.id === workflow?.leadId;
              return (
                <div
                  className={`hierarchy-member ${isLead ? 'lead' : workflow ? 'worker' : ''}`}
                  key={member.id}
                >
                  <div className="hierarchy-identity">
                    <span
                      className="member-initial"
                      style={{ '--avatar-color': member.color } as React.CSSProperties}
                    >
                      {member.name.slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{member.name}</strong>
                    {isLead && (
                      <span className="lead-label">
                        <Crown size={12} />
                        Lead
                      </span>
                    )}
                    <span
                      className={`presence ${member.presence || 'offline'}`}
                      aria-label={member.presence || 'offline'}
                      title={member.presence || 'offline'}
                    />
                  </div>
                  <div className="hierarchy-role">
                    <span>{member.role}</span>
                    {workflow && !isLead && (
                      <span title={`Reports to ${lead?.name || 'lead'}`}>
                        <GitBranch size={11} />
                        {lead?.name || 'Lead'}
                      </span>
                    )}
                  </div>
                  <div className="hierarchy-task">
                    {current ? (
                      <button
                        className={`text-button status-${current.status}`}
                        onClick={() => openTask(current)}
                      >
                        {statusIcon(current)}
                        <span>{current.title}</span>
                      </button>
                    ) : (
                      <span className="muted">
                        {!member.account
                          ? 'Offline'
                          : workflow?.status === 'completed'
                            ? 'Complete'
                            : 'Idle'}
                      </span>
                    )}
                  </div>
                  <div className="hierarchy-load">
                    <span>
                      {
                        memberTasks.filter((t) => t.phase === 'execution' && t.status === 'done')
                          .length
                      }
                      /{memberTasks.filter((t) => t.phase === 'execution').length} tasks
                    </span>
                    {assignment && <span>{assignment.effort} effort</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="compact-empty">
            <button className="text-button" onClick={addMember}>
              <Plus size={14} />
              Add a Codex account
            </button>
          </div>
        )}
      </section>

      <div className="monitor-grid">
        <section className="panel activity-panel">
          <div className="panel-heading">
            <h2>
              <Activity size={15} />
              Activity{working > 0 && <span className="working-count">{working} working</span>}
            </h2>
            <div className="feed-filters">
              <select
                aria-label="Filter activity by agent"
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
              >
                <option value="all">All agents</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter activity type"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
              >
                <option value="all">All activity</option>
                <option value="conversation">Conversation</option>
                <option value="attention">Needs attention</option>
              </select>
            </div>
          </div>
          <div className="activity-timeline" role="log" aria-label="Agent activity" aria-live="off">
            {events.length ? (
              events.slice(-160).map((event) => {
                const member = members.find((m) => m.id === event.memberId);
                const task = tasks.find((t) => t.id === event.taskId);
                const long = event.text.length > 440 || event.text.split('\n').length > 5;
                return (
                  <article className={`timeline-event event-${event.type}`} key={event.id}>
                    <span
                      className={`event-marker ${member ? '' : 'system'}`}
                      style={
                        member
                          ? ({ '--avatar-color': member.color } as React.CSSProperties)
                          : undefined
                      }
                    >
                      {member ? (
                        member.name.slice(0, 1).toUpperCase()
                      ) : event.message && event.type === 'message' ? (
                        'Y'
                      ) : (
                        <Activity size={13} />
                      )}
                    </span>
                    <div className="event-body">
                      <div className="event-meta">
                        <strong>
                          {member?.name ||
                            (event.message && event.type === 'message' ? 'You' : 'Kivuno')}
                        </strong>
                        <span className={`event-type ${event.type}`}>{event.type}</span>
                        <time
                          dateTime={event.createdAt}
                          title={new Date(event.createdAt).toLocaleString()}
                        >
                          {time(event.createdAt)}
                        </time>
                      </div>
                      {long ? (
                        <details className="event-content">
                          <summary>
                            {event.text
                              .split('\n')
                              .find((line) => line.trim())
                              ?.slice(0, 180) || event.type}
                            <ChevronDown size={13} />
                          </summary>
                          <pre>{event.text}</pre>
                        </details>
                      ) : (
                        <p className="event-content">{event.text}</p>
                      )}
                      {task && (
                        <button className="event-task" onClick={() => openTask(task)}>
                          <ListTodo size={11} />
                          {task.title}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="compact-empty feed-empty">
                <Activity size={21} />
                <span>No activity</span>
              </div>
            )}
          </div>
          <form className="team-message" onSubmit={post}>
            <label className="sr-only" htmlFor="room-message">
              Message team
            </label>
            <input
              id="room-message"
              value={message}
              maxLength={10000}
              onChange={(e) => setMessage(e.target.value)}
              disabled={!project}
              placeholder="Message team…"
            />
            <button
              type="submit"
              className="icon-button"
              disabled={!project || !message.trim() || busy}
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          </form>
        </section>

        <section className="panel queue-panel">
          <div className="panel-heading">
            <h2>
              <ListTodo size={15} />
              Queue<span className="count-bubble">{queue.length}</span>
            </h2>
            {attention > 0 && (
              <button className="text-button accent" onClick={review}>
                <GitMerge size={13} />
                {attention} to review
              </button>
            )}
          </div>
          <div className="workflow-queue">
            {queue.length ? (
              [...new Set(queue.map((t) => t.stage || 'Tasks'))].map((stage) => (
                <div className="queue-stage" key={stage}>
                  <h3>
                    {stage}
                    <span>
                      {
                        queue.filter((t) => (t.stage || 'Tasks') === stage && t.status === 'done')
                          .length
                      }
                      /{queue.filter((t) => (t.stage || 'Tasks') === stage).length}
                    </span>
                  </h3>
                  {queue
                    .filter((t) => (t.stage || 'Tasks') === stage)
                    .map((task) => (
                      <div className="queue-task" key={task.id}>
                        <button onClick={() => openTask(task)}>
                          <span className={`task-state state-${task.status}`}>
                            {statusIcon(task)}
                          </span>
                          <strong>{task.title}</strong>
                          <ChevronRight size={12} />
                        </button>
                        <div className="queue-task-meta">
                          <span>
                            {members.find((m) => m.id === task.assignedTo)?.name || 'Unassigned'}
                          </span>
                          <span className={`queue-status ${task.status}`}>
                            {labels[task.status]}
                          </span>
                          {task.effort && <span>{task.effort} pt</span>}
                        </div>
                        {task.dependsOn.length > 0 && (
                          <div className="queue-dependencies">
                            {task.dependsOn.map((id) => {
                              const dependency = tasks.find((t) => t.id === id);
                              return dependency ? (
                                <button
                                  key={id}
                                  onClick={() => openTask(dependency)}
                                  title={dependency.title}
                                >
                                  <GitBranch size={11} />
                                  <span>{dependency.title}</span>
                                  {dependency.status === 'done' && <CircleCheck size={11} />}
                                </button>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              ))
            ) : (
              <div className="compact-empty queue-empty">
                <ListTodo size={21} />
                <span>{workflow && workflow.phase !== 'execution' ? 'Planning…' : 'No tasks'}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
