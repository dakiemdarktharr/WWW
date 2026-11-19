import { isExternalProvider } from '../shared/providers';
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
import type { CodexModel, Member, RoomMessage } from '../shared/types';
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
import { providerLabels, providerOf } from './ProviderConnect';
import './workspace.css';
import './chat-interactions.css';

type Context = 'sessions' | 'team' | 'usage' | 'needs' | 'handoffs' | 'browser' | 'research' | null;
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
      style={{ '--avatar-color': member?.color || '#d5ff5f' } as React.CSSProperties}
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
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [orchestrate, setOrchestrate] = useState(false);
  const sendLock = useRef(false);
  const retry = useRef<{ key: string; id: string } | null>(null);
  const currentProject = useRef(project?.id);
  currentProject.current = project?.id;
  const activeSeen = useRef({ project: '', ids: new Set<string>() });
  const [selectedSession, setSelectedSession] = useState('');
  const [rosterOpen, setRosterOpen] = useState(false);
  const [roster, setRoster] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [reactionMenu, setReactionMenu] = useState<string | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [projectModels, setProjectModels] = useState<CodexModel[]>([]);
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const memberIds = project?.memberIds || [];
  const members = state.members.filter((member) => memberIds.includes(member.id));
  const modelCatalogKey = `${project?.id || ''}:${members
    .map((member) => `${member.id}:${providerOf(member)}:${member.account?.email || ''}`)
    .join('|')}`;
  const projectSessions = state.sessions.filter((session) => session.projectId === project?.id);
  const dossier = state.competitionResearch
    ?.filter((item) => item.projectId === project?.id)
    .at(-1);
  const session = projectSessions.find((entry) => entry.id === selectedSession);
  const activeSessions = projectSessions.filter((entry) =>
    ['starting', 'running'].includes(entry.status),
  );
  const activeKey = activeSessions.map((entry) => entry.id).join(',');
  useEffect(() => {
    if (activeSeen.current.project !== project?.id)
      activeSeen.current = { project: project?.id || '', ids: new Set() };
    const started = activeSessions.find((entry) => !activeSeen.current.ids.has(entry.id));
    activeSeen.current.ids = new Set(activeSessions.map((entry) => entry.id));
    if (started) {
      setSelectedSession(started.id);
      setPanel('sessions');
    }
  }, [project?.id, activeKey]);
  useEffect(() => {
    setContent('');
    setOrchestrate(false);
    setReplyTo(null);
    setThread(null);
    setSearch('');
    setLimit(80);
    retry.current = null;
  }, [project?.id]);
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
  const mentionMatch = menuDismissed ? null : /(?:^|\s)@([^\s@]*)$/.exec(content.slice(0, caret));
  const mentionSuggestions = mentionMatch
    ? members
        .filter((member) =>
          member.name.toLowerCase().replace(/\s+/g, '-').startsWith(mentionMatch[1].toLowerCase()),
        )
        .slice(0, 16)
    : [];
  const slash = !menuDismissed && /^\/[^\s]*$/.test(content);
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
  useEffect(() => {
    let live = true;
    setProjectModels([]);
    if (!project) {
      setModelCatalogLoading(false);
      return;
    }
    setModelCatalogLoading(true);
    api<CodexModel[]>(`/projects/${project.id}/models`)
      .then((models) => {
        if (live) setProjectModels(models);
      })
      .catch(() => {
        if (live) setProjectModels([]);
      })
      .finally(() => {
        if (live) setModelCatalogLoading(false);
      });
    return () => {
      live = false;
    };
  }, [modelCatalogKey]);
  function chooseCommand(value: string) {
    setContent(value);
    setCommandIndex(0);
    input.current?.focus();
  }
  function chooseMention(member: Member) {
    const start = mentionMatch ? caret - mentionMatch[1].length - 1 : caret;
    const value = `@${member.name.replace(/\s+/g, '-')} `;
    setContent(content.slice(0, start) + value + content.slice(caret));
    setMenuDismissed(true);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(start + value.length, start + value.length);
      setCaret(start + value.length);
    });
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!project || !content.trim() || sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    const sentContent = content;
    const sentProject = project.id;
    const key = JSON.stringify([project.id, content.trim(), replyTo, orchestrate]);
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    try {
      const result = await request<RoomMessage>('/mesh/messages', {
        projectId: project.id,
        content: content.trim(),
        replyTo: replyTo || undefined,
        clientRequestId: retry.current.id,
        orchestrate,
      });
      if (result && currentProject.current === sentProject) {
        setContent((current) => (current === sentContent ? '' : current));
        setReplyTo(null);
        retry.current = null;
        nearBottom.current = true;
        input.current?.focus();
      }
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }
  async function changeChatModel(model: string) {
    if (!project) return;
    setModelSaving(true);
    try {
      await request(`/projects/${project.id}/chat-config`, { model: model || null }, 'PATCH');
    } finally {
      setModelSaving(false);
    }
  }
  const openRoster = () => {
    setRoster([...memberIds]);
    setRosterOpen(true);
  };
  const toggle = (next: Context) => setPanel(panel === next ? null : next);
  return (
    <div className={`chat-workspace ${panel ? 'with-context' : ''}`}>
      <section className="project-chat" aria-label="Chat project chat">
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
            {dossier && (
              <button
                className={`button compact ${panel === 'research' ? 'selected' : ''}`}
                onClick={() => toggle('research')}
                aria-label="Competition research"
              >
                <Globe size={14} />
                Research <span className="count-pill">{dossier.sourceCount}</span>
              </button>
            )}
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
                        <p>
                          {message.content.split('\n')[0].slice(0, 220)}
                          {message.content.split('\n')[0].length > 220 ? '…' : ''}
                        </p>
                        <details className="chat-system-details">
                          <summary>Details</summary>
                          <p>{message.content}</p>
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
                  {human && message.requestStatus === 'open' && (
                    <span className="chat-queued">Queued · waiting for an available teammate</span>
                  )}
                </div>
              </article>
            );
          })}
          {!thread &&
            members
              .filter((member) => activeSessions.some((entry) => entry.memberId === member.id))
              .map((member) => (
                <article
                  className="chat-message from-agent"
                  key={`thinking-${member.id}`}
                  aria-label={`${member.name} is working`}
                >
                  <Avatar member={member} />
                  <div className="chat-message-content">
                    <div className="chat-message-meta">
                      <strong>{member.name}</strong>
                    </div>
                    <button
                      className="chat-bubble thinking-bubble"
                      onClick={() => {
                        setSelectedSession(
                          activeSessions.find((entry) => entry.memberId === member.id)!.id,
                        );
                        setPanel('sessions');
                      }}
                    >
                      <span className="thinking-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>
                        Working ·{' '}
                        {activeSessions.filter((entry) => entry.memberId === member.id).length}{' '}
                        session(s)
                      </span>
                    </button>
                  </div>
                </article>
              ))}
          {!shown.length && (
            <div className="chat-empty">
              <div className="chat-empty-mark">
                <MessageSquare size={28} />
              </div>
              <h2>{search ? 'No matching messages' : project ? 'No messages' : 'No project'}</h2>
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
          {orchestrate && (
            <p className="composer-policy">
              Sade uses the connected AI teammates to plan, edit project files and cross-check
              changes. Relevant project content goes to their AI providers. You approve integration
              and publishing separately.
            </p>
          )}
          {mentionSuggestions.length > 0 && (
            <div
              className="slash-menu mention-menu"
              role="listbox"
              id="mention-suggestions"
              aria-label="Group teammates"
            >
              {mentionSuggestions.map((member, index) => (
                <button
                  type="button"
                  role="option"
                  id={`mention-${index}`}
                  aria-selected={index === mentionIndex}
                  className={index === mentionIndex ? 'selected' : ''}
                  key={member.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseMention(member)}
                >
                  <Avatar member={member} />
                  <strong>{member.name}</strong>
                  <Presence member={member} />
                </button>
              ))}
            </div>
          )}
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
            aria-controls={
              mentionSuggestions.length
                ? 'mention-suggestions'
                : suggestions.length
                  ? 'slash-suggestions'
                  : undefined
            }
            aria-activedescendant={
              mentionSuggestions.length
                ? `mention-${mentionIndex}`
                : suggestions.length
                  ? `slash-${commandIndex}`
                  : undefined
            }
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
              setCaret(event.target.selectionStart);
              setMenuDismissed(false);
              setMentionIndex(0);
              setCommandIndex(0);
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (
                mentionSuggestions.length &&
                !event.shiftKey &&
                ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape'].includes(event.key)
              ) {
                event.preventDefault();
                if (event.key === 'Escape') setMenuDismissed(true);
                else if (event.key === 'ArrowDown')
                  setMentionIndex((mentionIndex + 1) % mentionSuggestions.length);
                else if (event.key === 'ArrowUp')
                  setMentionIndex(
                    (mentionIndex + mentionSuggestions.length - 1) % mentionSuggestions.length,
                  );
                else chooseMention(mentionSuggestions[mentionIndex]);
                return;
              }
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
                else if (event.key === 'Escape') setMenuDismissed(true);
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
            <label
              className="composer-policy"
              title="Sade plans and assigns work to connected teammates, changes project files in isolated workspaces, and requests an independent review. You approve integration and publishing separately."
            >
              <input
                type="checkbox"
                checked={orchestrate}
                disabled={sending}
                onChange={(event) => setOrchestrate(event.target.checked)}
              />
              Sade · Plan and build
            </label>
            <button
              type="button"
              className="text-button"
              aria-label="Mention a teammate"
              disabled={!project}
              onClick={() => {
                const text = `${content}${content && !/\s$/.test(content) ? ' ' : ''}@`;
                setContent(text);
                setCaret(text.length);
                setMenuDismissed(false);
                input.current?.focus();
              }}
            >
              @
            </button>
            <GlassSelect
              label="Chat model"
              value={project?.chatConfig?.model || ''}
              options={[
                { value: '', label: 'Auto model' },
                ...projectModels.map((model) => ({
                  value: model.model,
                  label: model.displayName,
                })),
                ...(project?.chatConfig?.model &&
                !projectModels.some((model) => model.model === project.chatConfig?.model)
                  ? [{ value: project.chatConfig.model, label: project.chatConfig.model }]
                  : []),
              ]}
              disabled={!project || busy || sending || modelSaving || modelCatalogLoading}
              onChange={(model) => void changeChatModel(model)}
            />
            <span
              className="composer-policy"
              title="Chat sessions research and plan without changing files. Choose Plan project to start the shared build workflow."
            >
              {orchestrate ? 'Sade coordinates' : 'Read-only'} ·{' '}
              {project?.chatConfig?.reasoningEffort || 'Auto reasoning'}
            </span>
            <button
              type="submit"
              className="send-prompt"
              aria-label="Send"
              disabled={!project || !content.trim() || busy || sending}
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
                  : panel === 'research'
                    ? 'Competition research'
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
                  disabled={
                    !project || !members.some((member) => !isExternalProvider(providerOf(member)))
                  }
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
          {panel === 'research' && dossier && (
            <div className="context-body research-dossier">
              <div className="context-toolbar">
                <button
                  className="button compact"
                  disabled={busy || ['queued', 'fetching'].includes(dossier.status)}
                  onClick={() => void request(`/projects/${project!.id}/research/refresh`, {})}
                >
                  Refresh sources
                </button>
                <button className="button compact" onClick={() => setPanel('browser')}>
                  Browser
                </button>
              </div>
              <a href={dossier.url} target="_blank" rel="noreferrer">
                {new URL(dossier.url).hostname}
              </a>
              <strong>
                {dossier.status} · {dossier.sourceCount} sources
              </strong>
              {[
                'brief',
                'eligibility',
                'rules',
                'judging',
                'tracks',
                'deliverables',
                'deadline',
                'submission',
                'history',
                'resources',
                'prizes',
                'constraints',
              ].map((category) => {
                const note = dossier.notes.findLast((entry) => entry.category === category);
                return (
                  <section key={category}>
                    <div className="research-coverage">
                      <strong>{category}</strong>
                      <span>{note?.status || 'unknown'}</span>
                    </div>
                    {note && <p>{note.finding}</p>}
                    {note?.sourceUrl && (
                      <a href={note.sourceUrl} target="_blank" rel="noreferrer">
                        Source ↗
                      </a>
                    )}
                  </section>
                );
              })}
              {!!dossier.blocked.length && (
                <details>
                  <summary>{dossier.blocked.length} unavailable sources</summary>
                  {dossier.blocked.map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </details>
              )}
            </div>
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
                          {providerLabels[providerOf(member)]} ·{' '}
                          {member.account?.planType ||
                            (isExternalProvider(providerOf(member))
                              ? 'External client'
                              : 'Not signed in')}{' '}
                          · {member.owner?.login || member.account?.email || 'Owner not set'}
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
                  Add your first agent account <ArrowRight size={13} />
                </button>
              )}
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
              {!members.length && <p>No members</p>}
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
                    {item.kind === 'question' && (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const answer = String(
                            new FormData(event.currentTarget).get('answer') || '',
                          ).trim();
                          if (answer) void request(`/requests/${item.id}/resolve`, { answer });
                        }}
                      >
                        <textarea
                          name="answer"
                          aria-label={`Answer ${item.title}`}
                          placeholder="Your answer"
                          required
                          maxLength={4000}
                          rows={2}
                        />
                        <button className="button compact" disabled={busy}>
                          Send answer
                        </button>
                      </form>
                    )}
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
                  <p>No requests</p>
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
                      {providerLabels[providerOf(member)]} ·{' '}
                      {member.account?.planType ||
                        (isExternalProvider(providerOf(member))
                          ? 'External client'
                          : 'Not signed in')}{' '}
                      · {member.owner?.login || 'Owner not set'}
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
