import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Bell,
  Check,
  Circle,
  GitBranch,
  Globe,
  Hash,
  Heart,
  MessageSquare,
  Network,
  Plus,
  Reply,
  Search,
  Send,
  SmilePlus,
  ThumbsDown,
  ThumbsUp,
  Users,
  X,
} from 'lucide-react';
import type { Member, RoomMessage } from '../shared/types';
import { api } from './api';
import {
  CreateSession,
  FoundationDialog,
  HandoffCard,
  HandoffForm,
  QuotaCard,
  SessionConsole,
  type FoundationProps,
} from './Foundation';
import GlassSelect from './GlassSelect';
import SessionGraph from './SessionGraph';
import BrowserPanel from './BrowserPanel';
import './workspace.css';

type Context = 'sessions' | 'team' | 'usage' | 'needs' | 'handoffs' | 'browser' | null;
const feedback = [
  { emoji: 'heart', label: 'Understood', Icon: Heart },
  { emoji: 'up', label: 'Agree', Icon: ThumbsUp },
  { emoji: 'down', label: 'Disagree', Icon: ThumbsDown },
] as const;
const time = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function Avatar({ member, human = false }: { member?: Member; human?: boolean }) {
  return (
    <span
      className={`chat-avatar ${human ? 'human' : ''}`}
      style={{ '--avatar-color': member?.color || '#8ce8cf' } as React.CSSProperties}
    >
      {human ? 'Y' : member?.name.slice(0, 1).toUpperCase() || 'K'}
    </span>
  );
}
function Presence({ member }: { member: Member }) {
  const status =
    member.presence ||
    (member.status === 'offline' || member.status === 'error' ? 'offline' : 'online');
  return (
    <span className={`member-presence ${status}`}>
      <i />
      {status}
    </span>
  );
}

export default function ProjectChat({
  state,
  project,
  busy,
  request,
  selectProject,
  addProject,
  openSessions,
}: FoundationProps) {
  const [panel, setPanel] = useState<Context>(null);
  const [content, setContent] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(80);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [mention, setMention] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const [rosterOpen, setRosterOpen] = useState(false);
  const [roster, setRoster] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [reactionMenu, setReactionMenu] = useState<string | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const memberIds = project?.memberIds || [];
  const members = state.members.filter((member) => memberIds.includes(member.id));
  const projectSessions = state.sessions.filter((session) => session.projectId === project?.id);
  const session = projectSessions.find((entry) => entry.id === selectedSession);
  const messages = useMemo(
    () =>
      state.messages
        .filter((message) => message.projectId === project?.id)
        .sort(
          (a, b) => (a.sequence || 0) - (b.sequence || 0) || a.createdAt.localeCompare(b.createdAt),
        ),
    [state.messages, project?.id],
  );
  const messageMap = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const filtered = messages.filter((message) => {
    if (
      search &&
      !`${message.content} ${state.members.find((member) => member.id === message.authorId)?.name || 'You'}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
      return false;
    if (!thread) return true;
    let cursor: RoomMessage | undefined = message;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor.id)) {
      if (cursor.id === thread) return true;
      visited.add(cursor.id);
      cursor = cursor.replyTo ? messageMap.get(cursor.replyTo) : undefined;
    }
    return false;
  });
  const shown = filtered.slice(-limit);
  const needs = state.humanRequests.filter(
    (item) => item.projectId === project?.id && item.status === 'open',
  );
  const handoffs = state.handoffs.filter((item) => item.projectId === project?.id);
  const skills = [...new Set(members.flatMap((member) => member.skills))];
  const commands = [
    { name: 'goal', hint: 'Set the project goal', example: '/goal ' },
    { name: 'reasoning', hint: 'low · medium · high · xhigh', example: '/reasoning ' },
    { name: 'model', hint: 'Choose a supported model', example: '/model ' },
    { name: 'skills', hint: 'Choose skills for this group', example: '/skills ' },
    ...skills.map((name) => ({ name, hint: 'Use installed skill', example: `/${name} ` })),
  ];
  const slash = /^\/[^\s]*$/.test(content);
  const suggestions = slash
    ? commands
        .filter((command) => command.name.toLowerCase().startsWith(content.slice(1).toLowerCase()))
        .slice(0, 8)
    : [];
  useEffect(() => {
    if (nearBottom.current) scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages.length, thread]);
  useEffect(() => {
    if (!project) return;
    const beat = () => {
      if (!document.hidden) void api(`/mesh/${project.id}/heartbeat`, {}).catch(() => {});
    };
    beat();
    const interval = window.setInterval(beat, 30000);
    document.addEventListener('visibilitychange', beat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [project?.id]);
  function chooseCommand(value: string) {
    setContent(value);
    setCommandIndex(0);
    input.current?.focus();
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!project || !content.trim()) return;
    const result = await request<RoomMessage>('/mesh/messages', {
      projectId: project.id,
      content: content.trim(),
      replyTo: replyTo || undefined,
      mentions: mention ? [mention] : [],
    });
    if (result) {
      setContent('');
      setReplyTo(null);
      setMention('');
      nearBottom.current = true;
      input.current?.focus();
    }
  }
  const openRoster = () => {
    setRoster([...memberIds]);
    setRosterOpen(true);
  };
  const toggle = (next: Context) => setPanel(panel === next ? null : next);
  return (
    <div className={`chat-workspace ${panel ? 'with-context' : ''}`}>
      <section className="project-chat" aria-label="Neralu project chat">
        <header className="chat-heading">
          <div className="chat-project-picker" data-usage="groups">
            <Hash size={18} />
            <GlassSelect
              label="Project group"
              value={project?.id || ''}
              options={state.projects.map((item) => ({ value: item.id, label: item.name }))}
              onChange={selectProject}
            />
            <button
              className="icon-button"
              onClick={addProject}
              aria-label="Connect a project group"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="chat-header-actions">
            <button
              className="button compact primary"
              aria-label="Plan project"
              title="Plan and build with your team"
              disabled={!project}
              onClick={() => {
                if (project && content.trim()) {
                  try {
                    sessionStorage.setItem(`kivuno-plan-draft-${project.id}`, content.trim());
                  } catch {
                    /* The workflow remains available without draft storage. */
                  }
                }
                location.hash = 'workroom';
              }}
            >
              <GitBranch size={14} />
              <span>Plan project</span>
            </button>
            <button
              className={`button compact ${panel === 'sessions' ? 'selected' : ''}`}
              onClick={() => toggle('sessions')}
              aria-label="Session view"
              aria-expanded={panel === 'sessions'}
              data-usage="session-map"
            >
              <Network size={15} />
              <span>Sessions</span>
              <span className="count-pill">{projectSessions.length}</span>
            </button>
            <button
              className={`icon-button ${panel === 'team' ? 'selected' : ''}`}
              aria-label="Group team"
              title="Group members"
              onClick={() => toggle('team')}
            >
              <Users size={17} />
            </button>
            <button
              className={`icon-button ${panel === 'needs' ? 'selected' : ''}`}
              aria-label={`Needs you (${needs.length})`}
              title="Needs you"
              onClick={() => toggle('needs')}
              data-usage="mesh-needs"
            >
              <Bell size={17} />
              {needs.length > 0 && <span className="mini-count">{needs.length}</span>}
            </button>
          </div>
        </header>
        {project && !members.length && (
          <div className="chat-setup">
            <Users size={18} />
            <span>Choose who works on this project.</span>
            <button className="button compact primary" onClick={openRoster}>
              Choose members
            </button>
          </div>
        )}
        <div className="chat-search-row">
          <label className="chat-search">
            <Search size={14} />
            <input
              aria-label="Search group messages"
              placeholder="Search this chat"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setLimit(80);
              }}
            />
          </label>
          {thread && (
            <button className="text-button" onClick={() => setThread(null)}>
              All messages <X size={12} />
            </button>
          )}
          <button
            className="text-button"
            onClick={() => toggle('usage')}
            data-usage="mesh-usage"
            aria-label="Account usage"
          >
            Usage
          </button>
          <button
            className="text-button"
            onClick={() => toggle('handoffs')}
            data-usage="mesh-handoff"
          >
            Handoffs
          </button>
        </div>
        <div
          className="chat-stream"
          ref={scroll}
          role="log"
          aria-label="Project messages"
          aria-live="polite"
          onScroll={(event) => {
            const el = event.currentTarget;
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
          }}
        >
          {filtered.length > limit && (
            <button className="load-messages" onClick={() => setLimit(limit + 80)}>
              Load earlier messages ({filtered.length - limit})
            </button>
          )}
          {shown.map((message) => {
            const author = state.members.find((member) => member.id === message.authorId);
            const human = !message.authorId && message.kind === 'message';
            const parent = message.replyTo ? messageMap.get(message.replyTo) : undefined;
            const replies = messages.filter((item) => item.replyTo === message.id).length;
            return (
              <article
                key={message.id}
                className={`chat-message ${human ? 'from-human' : author ? 'from-agent' : 'from-system'}`}
                data-message-id={message.id}
              >
                <Avatar member={author} human={human} />
                <div className="chat-message-content">
                  <div className="chat-message-meta">
                    <strong>{human ? 'You' : author?.name || 'Kivuno'}</strong>
                    {author?.presence && (
                      <i
                        className={`presence-dot ${author.presence}`}
                        aria-label={author.presence}
                      />
                    )}
                    <time
                      dateTime={message.createdAt}
                      title={new Date(message.createdAt).toLocaleString()}
                    >
                      {time(message.createdAt)}
                    </time>
                    {message.kind !== 'message' && <span>{message.kind}</span>}
                  </div>
                  <div className="chat-bubble">
                    {parent && (
                      <button className="chat-reply-preview" onClick={() => setThread(parent.id)}>
                        <Reply size={12} />
                        <span>{parent.content.slice(0, 90)}</span>
                      </button>
                    )}
                    {message.kind === 'system' &&
                    message.content.length > 420 &&
                    message.content.includes('\n') ? (
                      <>
                        <p>{message.content.split('\n')[0]}</p>
                        <details className="chat-system-details">
                          <summary>Working agreement & details</summary>
                          <p>{message.content.slice(message.content.indexOf('\n') + 1)}</p>
                        </details>
                      </>
                    ) : (
                      <p>{message.content}</p>
                    )}
                    {!!message.mentions?.length && (
                      <div className="chat-tags">
                        {message.mentions.map((id) => (
                          <span key={id}>
                            @{state.members.find((member) => member.id === id)?.name || id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="chat-message-actions">
                    <button
                      aria-label={`Reply to ${human ? 'your message' : author?.name || 'Kivuno'}`}
                      title="Reply"
                      onClick={() => {
                        setReplyTo(message.id);
                        input.current?.focus();
                      }}
                    >
                      <Reply size={13} />
                    </button>
                    <button
                      aria-label="Add reaction"
                      title="React"
                      aria-expanded={reactionMenu === message.id}
                      onClick={() =>
                        setReactionMenu(reactionMenu === message.id ? null : message.id)
                      }
                    >
                      <SmilePlus size={14} />
                    </button>
                    {feedback
                      .filter(
                        (item) =>
                          reactionMenu === message.id ||
                          message.reactions?.some((reaction) => reaction.emoji === item.emoji),
                      )
                      .map(({ emoji, label, Icon }) => (
                        <button
                          key={emoji}
                          className={
                            message.reactions?.some((reaction) => reaction.emoji === emoji)
                              ? 'reaction selected'
                              : 'reaction'
                          }
                          aria-label={label}
                          aria-pressed={
                            message.reactions?.some((reaction) => reaction.emoji === emoji) || false
                          }
                          title={label}
                          disabled={busy}
                          onClick={async () => {
                            await request(`/mesh/messages/${message.id}/reactions`, { emoji });
                            setReactionMenu(null);
                          }}
                        >
                          <Icon size={13} />
                          {message.reactions?.filter((reaction) => reaction.emoji === emoji)
                            .length || ''}
                        </button>
                      ))}
                    {!!replies && (
                      <button onClick={() => setThread(message.id)}>
                        {replies} {replies === 1 ? 'reply' : 'replies'}
                      </button>
                    )}
                    {message.claimedBy && (
                      <span className="chat-claim">
                        <Check size={11} />
                        {state.members.find((member) => member.id === message.claimedBy)?.name ||
                          'Claimed'}
                        {message.requestStatus === 'done' ? ' · done' : ' · on it'}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {!shown.length && (
            <div className="chat-empty">
              <div className="chat-empty-mark">
                <MessageSquare size={28} />
              </div>
              <h2>
                {search
                  ? 'No matching messages'
                  : project
                    ? 'What will your team build?'
                    : 'One project. One shared conversation.'}
              </h2>
              {!search && (
                <p>
                  {project
                    ? 'Share an idea, ask a question, or paste a challenge.'
                    : 'Create a project, choose your Codex team, then send a prompt.'}
                </p>
              )}
              {!project && (
                <button className="button primary" onClick={addProject}>
                  <Plus size={15} />
                  New project
                </button>
              )}
              {project && !search && (
                <button
                  className="prompt-starter"
                  onClick={() => {
                    setContent(
                      'Read the project goal, share what you know, and propose the next steps.',
                    );
                    input.current?.focus();
                  }}
                >
                  Help us plan the first steps <ArrowRight size={14} />
                </button>
              )}
            </div>
          )}
        </div>
        <form className="chat-composer" onSubmit={send}>
          {replyTo && (
            <div className="composer-reply">
              <Reply size={13} />
              <span>{messageMap.get(replyTo)?.content.slice(0, 90)}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="Cancel reply"
                onClick={() => setReplyTo(null)}
              >
                <X size={13} />
              </button>
            </div>
          )}
          {suggestions.length > 0 && (
            <div
              className="slash-menu"
              role="listbox"
              id="slash-suggestions"
              aria-label="Chat commands"
            >
              {suggestions.map((command, index) => (
                <button
                  id={`slash-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === commandIndex}
                  className={index === commandIndex ? 'selected' : ''}
                  key={command.name}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseCommand(command.example)}
                >
                  <strong>/{command.name}</strong>
                  <span>{command.hint}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            id="mesh-composer"
            ref={input}
            aria-label="Message the project team"
            aria-controls={suggestions.length ? 'slash-suggestions' : undefined}
            aria-activedescendant={suggestions.length ? `slash-${commandIndex}` : undefined}
            data-usage="mesh-input"
            rows={2}
            maxLength={10000}
            value={content}
            disabled={!project}
            placeholder={
              project ? 'Message your team… or type / for commands' : 'Create a project to start'
            }
            onChange={(event) => {
              setContent(event.target.value);
              setCommandIndex(0);
            }}
            onKeyDown={(event) => {
              if (
                suggestions.length &&
                ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape'].includes(event.key) &&
                !event.shiftKey
              ) {
                event.preventDefault();
                if (event.key === 'ArrowDown')
                  setCommandIndex((commandIndex + 1) % suggestions.length);
                else if (event.key === 'ArrowUp')
                  setCommandIndex((commandIndex + suggestions.length - 1) % suggestions.length);
                else if (event.key === 'Escape') setContent('');
                else chooseCommand(suggestions[commandIndex].example);
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="chat-composer-toolbar">
            <GlassSelect
              label="Mention a teammate"
              value={mention}
              options={[
                { value: '', label: '@ Mention' },
                ...members.map((member) => ({
                  value: member.id,
                  label: `${member.name} · ${member.presence || 'offline'}`,
                })),
              ]}
              onChange={setMention}
              disabled={!project}
            />
            <button
              type="button"
              className="text-button"
              aria-label="Show chat commands"
              onClick={() => chooseCommand('/')}
            >
              /
            </button>
            <span
              className="composer-policy"
              title="Chat sessions research and plan without changing files. Choose Plan project to start the shared build workflow."
            >
              Read-only · {project?.chatConfig?.model || 'Auto model'} ·{' '}
              {project?.chatConfig?.reasoningEffort || 'Auto reasoning'}
            </span>
            <button
              type="submit"
              className="send-prompt"
              aria-label="Send"
              disabled={!project || !content.trim() || busy}
            >
              <Send size={17} />
            </button>
          </div>
        </form>
      </section>
      {panel && (
        <aside className={`chat-context context-${panel}`} aria-label={`${panel} panel`}>
          <header>
            <strong>
              {panel === 'team'
                ? 'Group members'
                : panel === 'needs'
                  ? 'Needs you'
                  : panel === 'sessions'
                    ? 'Session view'
                    : panel === 'browser'
                      ? 'Browser'
                      : panel === 'usage'
                        ? 'Usage'
                        : 'Handoffs'}
            </strong>
            <button
              className="icon-button"
              aria-label="Close context panel"
              onClick={() => setPanel(null)}
            >
              <X size={16} />
            </button>
          </header>
          {panel === 'sessions' && (
            <>
              <div className="context-toolbar">
                <button
                  className="button compact"
                  onClick={() => setCreating(true)}
                  disabled={!project || !members.length}
                >
                  <Plus size={13} />
                  New session
                </button>
                <button className="button compact" onClick={() => setPanel('browser')}>
                  <Globe size={13} />
                  Browser
                </button>
              </div>
              <SessionGraph
                sessions={projectSessions}
                members={state.members}
                selected={selectedSession}
                select={setSelectedSession}
              />
              {session && (
                <div className="graph-session-detail">
                  <SessionConsole
                    key={session.id}
                    session={session}
                    state={state}
                    busy={busy}
                    request={request}
                    focused
                    handoff={() => setHandoff(session.id)}
                  />
                </div>
              )}
              <button className="context-link" onClick={openSessions}>
                Open full session workspace <ArrowRight size={13} />
              </button>
            </>
          )}
          {panel === 'browser' && project && (
            <BrowserPanel
              projectId={project.id}
              sessionId={session?.id}
              onClose={() => setPanel('sessions')}
            />
          )}
          {panel === 'team' && (
            <div className="context-body">
              <button className="button" onClick={openRoster} disabled={!project}>
                <Users size={14} />
                Edit group members{' '}
                <span>
                  {members.length}/{state.members.length}
                </span>
              </button>
              <div className="group-person">
                <Avatar human />
                <div>
                  <strong>You</strong>
                  <span>Project owner</span>
                </div>
                <span className="member-presence online">
                  <i />
                  online
                </span>
              </div>
              {members.map((member) => {
                const introduction = state.groupIntroductions?.find(
                  (item) => item.projectId === project?.id && item.memberId === member.id,
                );
                return (
                  <div className="group-member" key={member.id}>
                    <div className="group-person">
                      <Avatar member={member} />
                      <div>
                        <strong>{member.name}</strong>
                        <span>
                          {member.account?.planType || 'Not signed in'} ·{' '}
                          {member.owner?.login || member.account?.email || 'Owner not set'}
                        </span>
                      </div>
                      <Presence member={member} />
                    </div>
                    <div className="member-workload">
                      {member.activeSessions || 0} active sessions ·{' '}
                      {member.runnerName || 'This computer'}
                    </div>
                    <details>
                      <summary>
                        {introduction ? 'Introduction complete' : 'Waiting for introduction'}
                      </summary>
                      <p>
                        {introduction?.agreement ||
                          'Sign in to exchange capabilities with this group.'}
                      </p>
                      <div className="capability-tags">
                        {member.skills.map((skill) => (
                          <span key={skill}>{skill}</span>
                        ))}
                        {member.plugins.map((plugin) => (
                          <span key={plugin}>{plugin}</span>
                        ))}
                      </div>
                    </details>
                  </div>
                );
              })}
              {!state.members.length && (
                <button
                  className="context-link"
                  onClick={() => {
                    location.hash = 'team';
                  }}
                >
                  Add your first Codex account <ArrowRight size={13} />
                </button>
              )}
              <p className="context-note">
                Offline members wait. Work goes to available teammates; busy means more than four
                active sessions.
              </p>
            </div>
          )}
          {panel === 'usage' && (
            <div className="context-body">
              {members.map((member) => (
                <QuotaCard
                  key={member.id}
                  member={member}
                  state={state}
                  project={project}
                  request={request}
                  busy={busy}
                />
              ))}
              {!members.length && (
                <p className="context-note">Choose group members to see their usage.</p>
              )}
            </div>
          )}
          {panel === 'needs' && (
            <div className="context-body">
              {needs.length ? (
                needs.map((item) => (
                  <article className="needs-card" key={item.id}>
                    <Bell size={16} />
                    <h3>{item.title}</h3>
                    <p>{item.content}</p>
                    <button
                      className="button compact"
                      disabled={busy}
                      onClick={() => void request(`/requests/${item.id}/resolve`, {})}
                    >
                      Mark resolved
                    </button>
                  </article>
                ))
              ) : (
                <div className="chat-empty compact">
                  <Check size={24} />
                  <p>Nothing needs your attention.</p>
                </div>
              )}
            </div>
          )}
          {panel === 'handoffs' && (
            <div className="context-body">
              <button className="button" onClick={() => setHandoff('')} disabled={!project}>
                <GitBranch size={14} />
                Prepare handoff
              </button>
              {handoffs
                .slice()
                .reverse()
                .map((item) => (
                  <HandoffCard
                    key={item.id}
                    item={item}
                    state={state}
                    busy={busy}
                    request={request}
                  />
                ))}
            </div>
          )}
        </aside>
      )}
      {rosterOpen && project && (
        <FoundationDialog title="Choose group members" close={() => setRosterOpen(false)}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await request(
                `/projects/${project.id}/members`,
                { memberIds: roster },
                'PATCH',
              );
              if (result) setRosterOpen(false);
            }}
          >
            <p className="roster-description">
              Your team belongs to you. Only selected members join {project.name}.
            </p>
            <div className="roster-options">
              {state.members.map((member) => (
                <label className="roster-option" key={member.id}>
                  <input
                    type="checkbox"
                    checked={roster.includes(member.id)}
                    onChange={(event) =>
                      setRoster(
                        event.target.checked
                          ? [...roster, member.id]
                          : roster.filter((id) => id !== member.id),
                      )
                    }
                  />
                  <Avatar member={member} />
                  <span>
                    <strong>{member.name}</strong>
                    <small>
                      {member.account?.planType || 'Not signed in'} ·{' '}
                      {member.owner?.login || 'Owner not set'}
                    </small>
                  </span>
                  <Presence member={member} />
                </label>
              ))}
            </div>
            {!state.members.length && (
              <a className="button" href="#team" onClick={() => setRosterOpen(false)}>
                Add an account in Team
              </a>
            )}
            <footer className="dialog-actions">
              <span>
                {roster.length} of {state.members.length} selected
              </span>
              <button className="button primary" type="submit" disabled={busy}>
                Save members
              </button>
            </footer>
          </form>
        </FoundationDialog>
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
      {handoff !== null && project && (
        <HandoffForm
          state={state}
          project={project}
          busy={busy}
          request={request}
          close={() => setHandoff(null)}
          sessionId={handoff || undefined}
        />
      )}
    </div>
  );
}
