import { useEffect, useRef, useState } from 'react';
import type { Member } from '../shared/types';
import type {
  GroupCommand,
  GroupListing,
  SharedGroup,
  SharedMessage,
} from '../shared/collaboration';
import './SharedGroups.css';

const request = <T,>(input: GroupCommand) => window.relayDesktop!.groups<T>(input);
export default function SharedGroups({
  members,
  addTeammate,
  initialGroupId = '',
}: {
  members: Member[];
  addTeammate: () => void;
  initialGroupId?: string;
}) {
  const [listing, setListing] = useState<GroupListing>();
  const [selected, setSelected] = useState(initialGroupId);
  const [room, setRoom] = useState<SharedGroup>();
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const selectedRef = useRef(initialGroupId);
  const messageDraft = useRef<{ id: string; content: string; groupId: string } | null>(null);
  const refreshList = async () => {
    const next = await request<GroupListing>({ action: 'list' });
    setListing(next);
    if (selectedRef.current && !next.groups.some((group) => group.id === selectedRef.current)) {
      selectedRef.current = '';
      setSelected('');
      setRoom(undefined);
      setMessages([]);
    }
    return next;
  };
  useEffect(() => {
    let active = true,
      inFlight = false;
    const refresh = async () => {
      if (!active || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const next = await request<GroupListing>({ action: 'list' });
        if (active) setListing(next);
      } catch (cause) {
        if (active) setError((cause as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    let active = true,
      inFlight = false;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    setRoom(undefined);
    setMessages([]);
    setEditing(false);
    setContent('');
    setAccount('');
    messageDraft.current = null;
    if (!selected) return;
    const read = async () => {
      if (!active || inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      let delay = 3000;
      try {
        const next = await request<{
          group: SharedGroup;
          messages: SharedMessage[];
          hasMore: boolean;
        }>({ action: 'read', groupId: selected, after: cursor });
        if (active) {
          setRoom(next.group);
          setError('');
          if (next.messages.length) {
            cursor = next.messages[next.messages.length - 1].sequence;
            setMessages((previous) => [...previous, ...next.messages].slice(-1000));
          }
          if (next.hasMore) delay = 200;
        }
      } catch (cause) {
        if (active) {
          setRoom(undefined);
          setMessages([]);
          cursor = 0;
          setError((cause as Error).message);
        }
        delay = 10000;
      } finally {
        inFlight = false;
        if (active) timer = setTimeout(read, delay);
      }
    };
    void read();
    window.addEventListener('focus', read);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('focus', read);
    };
  }, [selected]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const choose = (id: string) => {
    selectedRef.current = id;
    setSelected(id);
  };
  const ownerId = listing?.owner.id;
  const isOwner = room?.ownerId === ownerId;
  return (
    <section className="shared-groups" aria-label="Kivuno groups">
      <aside className="shared-group-list">
        <h2>Groups</h2>
        {listing && (
          <button
            className="text-button"
            title={listing.owner.id}
            onClick={() =>
              void navigator.clipboard
                .writeText(listing.owner.id)
                .catch(() => setError(`Your account ID: ${listing.owner.id}`))
            }
          >
            {listing.owner.name} · Copy account ID
          </button>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const id = crypto.randomUUID();
            void run(async () => {
              await request({ action: 'create', id, name });
              setName('');
              await refreshList();
              choose(id);
            });
          }}
        >
          <input
            aria-label="New group name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            placeholder="Group name"
            required
          />
          <button className="button" disabled={busy || !name.trim()}>
            Create group
          </button>
        </form>
        {listing?.invitations.map((invitation) => (
          <div className="group-invitation" key={invitation.id}>
            <strong>{invitation.name}</strong>
            <button
              className="button compact"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await request({ action: 'accept', groupId: invitation.id });
                  await refreshList();
                  choose(invitation.id);
                })
              }
            >
              Accept invitation
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await request({ action: 'decline', groupId: invitation.id });
                  await refreshList();
                })
              }
            >
              Decline
            </button>
          </div>
        ))}
        <nav aria-label="Shared groups">
          {listing?.groups.map((group) => (
            <button
              className="shared-group-link"
              disabled={busy}
              key={group.id}
              aria-current={selected === group.id ? 'page' : undefined}
              onClick={() => choose(group.id)}
            >
              {group.name}
            </button>
          ))}
        </nav>
      </aside>
      <div className="shared-group-room">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {!listing && !error && <p role="status">Connecting to your Kivuno groups…</p>}
        {selected && !room && !error && <p role="status">Opening group…</p>}
        {room && (
          <>
            <header>
              <h2>{room.name}</h2>
              <button
                className="button compact"
                onClick={() => {
                  setEditing(!editing);
                  setChosen(
                    room.teammates
                      .filter((member) => member.ownerId === ownerId)
                      .map((member) => member.localId),
                  );
                }}
              >
                Members
              </button>
            </header>
            {editing && (
              <section className="shared-group-members" aria-label="Group members">
                <ul>
                  {room.people.map((person) => (
                    <li key={person.id}>
                      {person.name} {person.id === ownerId ? '(you)' : ''} ·{' '}
                      {person.state === 'invited' ? 'Invited' : 'Joined'}
                      {isOwner && person.id !== ownerId && (
                        <button
                          className="text-button"
                          disabled={busy}
                          aria-label={`Remove ${person.name}`}
                          onClick={() =>
                            void run(async () => {
                              const updated = await request<SharedGroup>({
                                action: 'remove',
                                groupId: room.id,
                                userId: person.id,
                              });
                              if (selectedRef.current === updated.id) setRoom(updated);
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {isOwner && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        const updated = await request<SharedGroup>({
                          action: 'invite',
                          groupId: room.id,
                          account,
                        });
                        if (selectedRef.current === updated.id) setRoom(updated);
                        setAccount('');
                      });
                    }}
                  >
                    <input
                      aria-label="Kivuno account email or ID"
                      placeholder="Kivuno email or account ID"
                      value={account}
                      onChange={(event) => setAccount(event.target.value)}
                      required
                    />
                    <button className="button" disabled={busy || !account.trim()}>
                      Invite account
                    </button>
                  </form>
                )}
                <h3>Your teammates</h3>
                {members.map((member) => (
                  <label key={member.id}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(member.id)}
                      onChange={(event) =>
                        setChosen((previous) =>
                          event.target.checked
                            ? [...previous, member.id]
                            : previous.filter((id) => id !== member.id),
                        )
                      }
                    />
                    {member.name} · {member.provider || 'codex'}
                  </label>
                ))}
                <div className="shared-group-actions">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const updated = await request<SharedGroup>({
                          action: 'teammates',
                          groupId: room.id,
                          teammates: members
                            .filter((member) => chosen.includes(member.id))
                            .map((member) => ({
                              localId: member.id,
                              name: member.name,
                              provider: member.provider || 'codex',
                            })),
                        });
                        if (selectedRef.current === updated.id) setRoom(updated);
                        setEditing(false);
                      })
                    }
                  >
                    Save my teammates
                  </button>
                  <button className="text-button" onClick={addTeammate}>
                    Connect a teammate
                  </button>
                </div>
                {!isOwner && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await request({ action: 'leave', groupId: room.id });
                        choose('');
                        await refreshList();
                      })
                    }
                  >
                    Leave group
                  </button>
                )}
              </section>
            )}
            <div className="shared-group-roster" aria-label="Shared teammates">
              {room.teammates.map((member) => (
                <span key={`${member.ownerId}:${member.localId}`}>
                  {member.name} · {room.people.find((person) => person.id === member.ownerId)?.name}
                </span>
              ))}
            </div>
            <div
              className="shared-group-history"
              role="log"
              aria-label="Group messages"
              aria-live="polite"
            >
              {messages.map((message) => (
                <article key={message.id}>
                  <strong>{message.author}</strong>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  <p>{message.content}</p>
                </article>
              ))}
            </div>
            <form
              className="shared-group-compose"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const draft = messageDraft.current;
                  const next =
                    draft?.content === content && draft.groupId === room.id
                      ? draft
                      : { id: crypto.randomUUID(), content, groupId: room.id };
                  messageDraft.current = next;
                  await request({ action: 'message', ...next });
                  messageDraft.current = null;
                  setContent('');
                });
              }}
            >
              <textarea
                aria-label="Message group"
                placeholder="Message group"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                maxLength={8000}
                required
              />
              <button className="button primary" disabled={busy || !content.trim()}>
                Send
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
