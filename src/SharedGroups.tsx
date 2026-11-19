import { useEffect, useRef, useState } from 'react';
import type { Member, Project } from '../shared/types';
import type {
  GroupCommand,
  GroupListing,
  SharedGroup,
  SharedMessage,
  SharedHarnessGrant,
  SharedSadeRun,
} from '../shared/collaboration';
import './SharedGroups.css';
import { api } from './api';
import type { Machine } from './Machines';

const request = <T,>(input: GroupCommand) => window.relayDesktop!.groups<T>(input);
export default function SharedGroups({
  members,
  projects,
  addTeammate,
  initialGroupId = '',
}: {
  members: Member[];
  projects: Project[];
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
  const [chosenTeammates, setChosenTeammates] = useState<string[]>([]);
  const [chosenSeats, setChosenSeats] = useState<string[]>([]);
  const [grants, setGrants] = useState<SharedHarnessGrant[]>([]);
  const [sadeRuns, setSadeRuns] = useState<SharedSadeRun[]>([]);
  const [grantMember, setGrantMember] = useState('');
  const [grantProject, setGrantProject] = useState('');
  const [grantTurns, setGrantTurns] = useState(3);
  const [allowWrites, setAllowWrites] = useState(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineId, setMachineId] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [answer, setAnswer] = useState('');
  const [taskUpdate, setTaskUpdate] = useState<{ id: string; jobId: string; text: string } | null>(
    null,
  );
  const selectedRef = useRef(initialGroupId);
  const messageDraft = useRef<{
    id: string;
    content: string;
    groupId: string;
    sade?: { projectKey: string };
  } | null>(null);
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
        if (active) {
          setListing(next);
          if (
            selectedRef.current &&
            !next.groups.some((group) => group.id === selectedRef.current)
          ) {
            selectedRef.current = '';
            setSelected('');
            setRoom(undefined);
            setMessages([]);
            setGrants([]);
            setSadeRuns([]);
          }
        }
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
    setGrants([]);
    setSadeRuns([]);
    setGrantMember('');
    setGrantProject('');
    setAllowWrites(false);
    setMachineId('');
    setProjectKey('');
    setAnswer('');
    setTaskUpdate(null);
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
          sadeGrants?: SharedHarnessGrant[];
          sadeRuns?: SharedSadeRun[];
        }>({ action: 'read', groupId: selected, after: cursor });
        if (active) {
          setRoom(next.group);
          setGrants(next.sadeGrants || []);
          setSadeRuns(next.sadeRuns || []);
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
          setGrants([]);
          setSadeRuns([]);
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
  useEffect(() => {
    if (!editing || !grantProject || !allowWrites) return;
    let active = true;
    const refresh = () => {
      void api<Machine[]>('/runners').then(
        (next) => {
          if (active) setMachines(next);
        },
        () => {
          if (active) setMachines([]);
        },
      );
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [editing, grantProject, allowWrites]);
  const paired = allowWrites
    ? machines.filter(
        (machine) =>
          machine.online &&
          machine.ready &&
          machine.executionProjectId === grantProject &&
          machine.execution?.fullAccess &&
          Date.parse(machine.execution.expiresAt) > Date.now(),
      )
    : [];
  const ownerId = listing?.owner.id;
  const isOwner = room?.ownerId === ownerId;
  const localGrants = grants.filter((grant) => grant.ownerId === ownerId);
  const linkedProjects = [
    ...new Map(localGrants.map((grant) => [grant.projectKey, grant.projectName])).entries(),
  ];
  const latestSade = sadeRuns.at(-1);
  const waiting = latestSade?.jobs.find((job) => job.state === 'waiting');
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
        {Boolean(listing?.lockedGroups.length) && (
          <div className="locked-groups" aria-label="Groups with locked seats">
            <h3>Locked groups</h3>
            {listing?.lockedGroups.map((group) => (
              <div className="locked-group-row" key={group.id}>
                <div>
                  <strong>{group.name}</strong>
                  <span>Your seat is locked. You can leave the group.</span>
                </div>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await request({ action: 'leave', groupId: group.id });
                      await refreshList();
                    })
                  }
                >
                  Leave
                </button>
              </div>
            ))}
          </div>
        )}
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
                  setChosenTeammates(
                    room.teammates
                      .filter((member) => member.ownerId === ownerId)
                      .map((member) => member.localId),
                  );
                  setChosenSeats(
                    room.people
                      .filter((person) => person.id !== ownerId && !person.quotaLocked)
                      .map((person) => person.id),
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
                      {person.quotaLocked
                        ? 'Locked'
                        : person.state === 'invited'
                          ? 'Invited'
                          : 'Joined'}
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
                              if (selectedRef.current === updated.id) {
                                setRoom(updated);
                                setChosenSeats(
                                  updated.people
                                    .filter(
                                      (member) => member.id !== ownerId && !member.quotaLocked,
                                    )
                                    .map((member) => member.id),
                                );
                              }
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
                        if (selectedRef.current === updated.id) {
                          setRoom(updated);
                          setChosenSeats(
                            updated.people
                              .filter((member) => member.id !== ownerId && !member.quotaLocked)
                              .map((member) => member.id),
                          );
                        }
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
                {isOwner && (
                  <section className="group-seat-picker" aria-label="Active group seats">
                    <h3>Active group seats</h3>
                    <p>
                      The owner always uses one seat.{' '}
                      {room.seatLimit === null
                        ? `${chosenSeats.length + 1} people selected · no plan cap.`
                        : `${chosenSeats.length + 1} of ${room.seatLimit} seats selected.`}
                    </p>
                    <label>
                      <input type="checkbox" checked disabled />
                      {room.people.find((person) => person.id === ownerId)?.name || 'Group owner'} ·
                      Owner (required)
                    </label>
                    {room.people
                      .filter((person) => person.id !== ownerId)
                      .map((person) => (
                        <label key={person.id}>
                          <input
                            type="checkbox"
                            checked={chosenSeats.includes(person.id)}
                            onChange={(event) =>
                              setChosenSeats((previous) =>
                                event.target.checked
                                  ? [...previous, person.id]
                                  : previous.filter((id) => id !== person.id),
                              )
                            }
                          />
                          {person.name} · {person.state === 'invited' ? 'Invited' : 'Joined'}
                          {person.quotaLocked ? ' · Locked' : ''}
                        </label>
                      ))}
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const updated = await request<SharedGroup>({
                            action: 'seats',
                            groupId: room.id,
                            userIds: [ownerId!, ...chosenSeats],
                          });
                          if (selectedRef.current === updated.id) {
                            setRoom(updated);
                            setChosenSeats(
                              updated.people
                                .filter((person) => person.id !== ownerId && !person.quotaLocked)
                                .map((person) => person.id),
                            );
                          }
                        })
                      }
                    >
                      Save active seats
                    </button>
                  </section>
                )}
                <h3>Your teammates</h3>
                <div role="group" aria-label="Your teammates">
                  {members.map((member) => (
                    <label key={member.id}>
                      <input
                        type="checkbox"
                        checked={chosenTeammates.includes(member.id)}
                        onChange={(event) =>
                          setChosenTeammates((previous) =>
                            event.target.checked
                              ? [...previous, member.id]
                              : previous.filter((id) => id !== member.id),
                          )
                        }
                      />
                      {member.name} · {member.provider || 'codex'}
                    </label>
                  ))}
                </div>
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
                            .filter((member) => chosenTeammates.includes(member.id))
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
                <h3>Let Sade use your teammate</h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      await request({
                        action: 'sade-connect',
                        groupId: room.id,
                        projectId: grantProject,
                        teammateId: grantMember,
                        allowWrites,
                        machineId: machineId || undefined,
                        turns: grantTurns,
                      });
                    });
                  }}
                >
                  <select
                    aria-label="Sade teammate"
                    value={grantMember}
                    onChange={(event) => setGrantMember(event.target.value)}
                    required
                  >
                    <option value="">Choose your teammate</option>
                    {room.teammates
                      .filter(
                        (member) =>
                          member.ownerId === ownerId &&
                          members.some((local) => local.id === member.localId && local.account),
                      )
                      .map((member) => (
                        <option value={member.localId} key={member.localId}>
                          {member.name}
                        </option>
                      ))}
                  </select>
                  <select
                    aria-label="Sade local project"
                    value={grantProject}
                    onChange={(event) => {
                      setGrantProject(event.target.value);
                      setMachineId('');
                    }}
                    required
                  >
                    <option value="">Link a local Git project</option>
                    {projects.map((project) => (
                      <option value={project.id} key={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <label>
                    Prompt limit{' '}
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={grantTurns}
                      onChange={(event) => setGrantTurns(Number(event.target.value))}
                      required
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={allowWrites}
                      onChange={(event) => {
                        setAllowWrites(event.target.checked);
                        setMachineId('');
                      }}
                    />{' '}
                    Allow local file changes
                  </label>
                  {paired.length > 0 && (
                    <label>
                      Paired machine
                      <select
                        value={machineId}
                        onChange={(event) => setMachineId(event.target.value)}
                      >
                        <option value="">This computer only</option>
                        {paired.map((machine) => (
                          <option key={machine.id} value={machine.id}>
                            {machine.name} · {machine.execution?.platform}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button className="button" disabled={busy || !grantMember || !grantProject}>
                    Review one-hour access
                  </button>
                </form>
                {localGrants.map((grant) => (
                  <div key={grant.id}>
                    {grant.label} · {grant.projectName} · {grant.used}/{grant.turns} turns
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await request({
                            action: 'sade-revoke',
                            groupId: room.id,
                            grantId: grant.id,
                          });
                          setGrants((previous) => previous.filter((item) => item.id !== grant.id));
                        })
                      }
                    >
                      Revoke
                    </button>
                  </div>
                ))}
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
            {latestSade && (
              <section aria-label="Sade progress" className="shared-group-members">
                <strong>Sade · {latestSade.state}</strong>
                {latestSade.error && <p>{latestSade.error}</p>}
                <ul>
                  {latestSade.jobs.map((job) => (
                    <li key={job.id}>
                      {job.task?.title || (job.phase === 'review' ? 'Independent review' : 'Plan')}{' '}
                      ·{' '}
                      {grants.find((grant) => grant.id === job.grantId)?.label ||
                        'Assigned teammate'}{' '}
                      · {job.state}
                      {job.summary && <p>{job.summary}</p>}
                      {Boolean(job.updateCount) && (
                        <p aria-live="polite">
                          {job.updatesRead || 0}/{job.updateCount} task updates read
                        </p>
                      )}
                      {job.canUpdate &&
                        (taskUpdate?.jobId === job.id ? (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void run(async () => {
                                await request({
                                  action: 'sade-update-task',
                                  groupId: room.id,
                                  runId: latestSade.id,
                                  jobId: job.id,
                                  id: taskUpdate.id,
                                  text: taskUpdate.text.trim(),
                                });
                                setTaskUpdate(null);
                              });
                            }}
                          >
                            <label>
                              Task update
                              <input
                                value={taskUpdate.text}
                                maxLength={1000}
                                required
                                onChange={(event) =>
                                  setTaskUpdate({
                                    jobId: job.id,
                                    id: crypto.randomUUID(),
                                    text: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <button
                              className="button compact"
                              disabled={busy || !taskUpdate.text.trim()}
                            >
                              Send update
                            </button>
                            <button
                              className="text-button"
                              type="button"
                              onClick={() => setTaskUpdate(null)}
                            >
                              Close
                            </button>
                          </form>
                        ) : (
                          <button
                            className="button compact"
                            disabled={busy}
                            type="button"
                            onClick={() =>
                              setTaskUpdate({ jobId: job.id, id: crypto.randomUUID(), text: '' })
                            }
                          >
                            Update task
                          </button>
                        ))}
                    </li>
                  ))}
                </ul>
                {waiting && latestSade.canAnswer && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        await request({
                          action: 'sade-answer',
                          groupId: room.id,
                          runId: latestSade.id,
                          jobId: waiting.id,
                          answer: answer.trim(),
                        });
                        setAnswer('');
                      });
                    }}
                  >
                    <label>
                      Reply to Sade
                      <input
                        value={answer}
                        maxLength={1000}
                        onChange={(event) => setAnswer(event.target.value)}
                        required
                      />
                    </label>
                    <button className="button compact" disabled={busy || !answer.trim()}>
                      Send reply
                    </button>
                  </form>
                )}
                {['planning', 'running'].includes(latestSade.state) && (
                  <button
                    className="button compact"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await request({
                          action: 'sade-cancel',
                          groupId: room.id,
                          runId: latestSade.id,
                        });
                      })
                    }
                  >
                    Cancel Sade request
                  </button>
                )}
              </section>
            )}
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
                    draft?.content === content &&
                    draft.groupId === room.id &&
                    (draft.sade?.projectKey || '') === projectKey
                      ? draft
                      : {
                          id: crypto.randomUUID(),
                          content,
                          groupId: room.id,
                          ...(projectKey ? { sade: { projectKey } } : {}),
                        };
                  messageDraft.current = next;
                  await request({ action: 'message', ...next });
                  messageDraft.current = null;
                  setContent('');
                  setProjectKey('');
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
              {linkedProjects.length > 0 && (
                <select
                  aria-label="Ask Sade in this group"
                  value={projectKey}
                  onChange={(event) => setProjectKey(event.target.value)}
                >
                  <option value="">Send a group message</option>
                  {linkedProjects.map(([key, name]) => (
                    <option key={key} value={key}>
                      Ask Sade · {name}
                    </option>
                  ))}
                </select>
              )}
              <button className="button primary" disabled={busy || !content.trim()}>
                {projectKey ? 'Ask Sade' : 'Send'}
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
