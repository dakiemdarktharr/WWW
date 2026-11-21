import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ChevronDown, ListTodo, Send, Users, X } from 'lucide-react';
import type { Member, Project } from '../shared/types';
import { sadeProjectCatalogueMaxBytes } from '../shared/sade-project';
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
import SharedSadeProject from './SharedSadeProject';

const request = <T,>(input: GroupCommand) => window.relayDesktop!.groups<T>(input);
const roomPollInterval = 3000;

async function catalogueJpeg(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The catalogue image could not be opened.');
    for (const width of [1600, 1280, 960]) {
      const scale = Math.min(1, width / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
      if (data && atob(data).length <= sadeProjectCatalogueMaxBytes) return data;
    }
    throw new Error(
      'This catalogue image is too detailed to send. Crop it or share a public link.',
    );
  } finally {
    bitmap.close();
  }
}

const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const timeLabel = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toLocaleUpperCase();
}

type GroupSadeView = {
  group?: SharedGroup;
  sadeGrants?: SharedHarnessGrant[];
  sadeRuns?: SharedSadeRun[];
  supportsReferencedMessage?: true;
  supportsProjectOrchestration?: true;
};
type GroupRead = GroupSadeView & {
  group: SharedGroup;
  messages: SharedMessage[];
  hasMore: boolean;
};
type GroupReader = {
  groupId: string;
  pause: () => void;
  resume: (refresh: boolean) => void;
};

function mergeMessages(previous: SharedMessage[], incoming: SharedMessage[]) {
  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence).slice(-1000);
}

export default function SharedGroups({
  members,
  projects,
  sessions = [],
  addTeammate,
  initialGroupId = '',
}: {
  members: Member[];
  projects: Project[];
  sessions?: { id: string; title: string }[];
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
  const [showList, setShowList] = useState(!initialGroupId);
  const [showLatest, setShowLatest] = useState(false);
  const groupList = useRef<HTMLElement>(null);
  const roomHeading = useRef<HTMLHeadingElement>(null);
  const membersDialog = useRef<HTMLDialogElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const nearLatest = useRef(true);
  const moveRoomFocus = useRef(false);
  const [chosenTeammates, setChosenTeammates] = useState<string[]>([]);
  const [chosenSeats, setChosenSeats] = useState<string[]>([]);
  const [grants, setGrants] = useState<SharedHarnessGrant[]>([]);
  const [sadeRuns, setSadeRuns] = useState<SharedSadeRun[]>([]);
  const [grantMember, setGrantMember] = useState('');
  const [grantProject, setGrantProject] = useState('');
  const [grantTurns, setGrantTurns] = useState(3);
  const [allowWrites, setAllowWrites] = useState(false);
  const [projectOrchestration, setProjectOrchestration] = useState(false);
  const [supportsProjects, setSupportsProjects] = useState(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineId, setMachineId] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [readOnlyRequest, setReadOnlyRequest] = useState(false);
  const [supportsReferencedMessage, setSupportsReferencedMessage] = useState(false);
  const [reference, setReference] = useState<SharedMessage>();
  const [catalogue, setCatalogue] = useState<File>();
  const catalogueInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [answer, setAnswer] = useState('');
  const [taskUpdate, setTaskUpdate] = useState<{ id: string; jobId: string; text: string } | null>(
    null,
  );
  const selectedRef = useRef(initialGroupId);
  const roomReader = useRef<GroupReader | null>(null);
  const messageDraft = useRef<{
    id: string;
    content: string;
    groupId: string;
    sade?: SharedMessage['sade'];
    catalogue?: File;
  } | null>(null);
  const applyGroupView = (next: GroupSadeView) => {
    if (next.group) setRoom(next.group);
    setGrants(next.sadeGrants || []);
    setSadeRuns(next.sadeRuns || []);
    setSupportsReferencedMessage(next.supportsReferencedMessage === true);
    setSupportsProjects(next.supportsProjectOrchestration === true);
  };
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
      inFlight = false,
      paused = false;
    let readVersion = 0;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    setRoom(undefined);
    setMessages([]);
    nearLatest.current = true;
    setShowLatest(false);
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
    setReadOnlyRequest(false);
    setSupportsReferencedMessage(false);
    setReference(undefined);
    setAnswer('');
    setTaskUpdate(null);
    messageDraft.current = null;
    if (!selected) return;
    const canRead = () => active && !paused && selectedRef.current === selected;
    const read = async () => {
      if (!canRead() || inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      const version = ++readVersion;
      const isCurrent = () => canRead() && version === readVersion;
      let delay = roomPollInterval;
      try {
        const next = await request<GroupRead>({ action: 'read', groupId: selected, after: cursor });
        if (isCurrent()) {
          applyGroupView(next);
          setError('');
          if (next.messages.length) {
            cursor = next.messages[next.messages.length - 1].sequence;
            setMessages((previous) => mergeMessages(previous, next.messages));
          }
          if (next.hasMore) delay = 200;
        }
      } catch (cause) {
        if (isCurrent()) {
          setRoom(undefined);
          setMessages([]);
          setGrants([]);
          setSadeRuns([]);
          cursor = 0;
          setError((cause as Error).message);
        }
        delay = 10000;
      } finally {
        if (isCurrent()) {
          inFlight = false;
          timer = setTimeout(read, delay);
        }
      }
    };
    roomReader.current = {
      groupId: selected,
      pause: () => {
        // A read started before a mutation cannot replace its decision when it returns late.
        paused = true;
        readVersion++;
        inFlight = false;
        clearTimeout(timer);
      },
      resume: (refresh) => {
        paused = false;
        if (!canRead()) return;
        if (refresh) void read();
        else timer = setTimeout(read, roomPollInterval);
      },
    };
    void read();
    window.addEventListener('focus', read);
    return () => {
      active = false;
      roomReader.current = null;
      clearTimeout(timer);
      window.removeEventListener('focus', read);
    };
  }, [selected]);
  const submitRoom = async <T,>(
    input: GroupCommand & { groupId: string },
    apply: (result: T) => boolean,
  ) => {
    const reader = roomReader.current;
    if (!reader || reader.groupId !== input.groupId || selectedRef.current !== input.groupId)
      return;
    reader.pause();
    let refresh = false;
    try {
      const result = await request<T>(input);
      if (roomReader.current === reader && selectedRef.current === input.groupId)
        refresh = !apply(result);
    } catch (error) {
      refresh = true;
      throw error;
    } finally {
      reader.resume(refresh);
    }
  };
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
    setShowList(!id);
    moveRoomFocus.current = Boolean(id) && window.matchMedia('(max-width: 660px)').matches;
    setCatalogue(undefined);
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
  const latestMessageId = messages.at(-1)?.id;
  useEffect(() => {
    if (!showList && room?.id === selected && moveRoomFocus.current && roomHeading.current) {
      roomHeading.current.focus({ preventScroll: true });
      moveRoomFocus.current = false;
    }
  }, [room?.id, selected, showList]);
  useEffect(() => {
    const dialog = membersDialog.current;
    if (!dialog || dialog.open === editing) return;
    if (editing) dialog.showModal();
    else dialog.close();
  }, [editing]);
  useEffect(() => {
    const stream = history.current;
    if (!stream || stream.clientHeight === 0) return;
    if (nearLatest.current) stream.scrollTop = stream.scrollHeight;
    setShowLatest(stream.scrollHeight - stream.clientHeight - stream.scrollTop > 64);
  }, [room?.id, latestMessageId, showList]);
  const backToGroups = () => {
    setShowList(true);
    requestAnimationFrame(() =>
      (
        groupList.current?.querySelector<HTMLButtonElement>('[aria-current="page"]:enabled') ??
        groupList.current
      )?.focus(),
    );
  };
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
  const referenceProjectKey = reference?.sade?.projectKey;
  const projectOptions = referenceProjectKey
    ? linkedProjects.filter(([key]) => key === referenceProjectKey)
    : linkedProjects;
  const projectIsAvailable = projectOptions.some(([key]) => key === projectKey);
  const needsSadeProject = supportsProjects && /^\s*@sade\b/i.test(content) && !projectIsAvailable;
  const needsReferenceProject = Boolean(
    reference && (!supportsReferencedMessage || !projectIsAvailable),
  );
  const grantLabels = new Map(
    grants.map((grant) => {
      const owner = room?.people.find((person) => person.id === grant.ownerId);
      return [grant.id, owner ? `${grant.label} · ${owner.name}` : grant.label];
    }),
  );
  const latestSade = sadeRuns.at(-1);
  const latestProject = sadeRuns.findLast(({ project }) => project);
  const waiting = latestSade?.jobs.find((job) => job.state === 'waiting');
  return (
    <section
      className="shared-groups"
      data-pane={selected && !showList ? 'room' : 'list'}
      aria-label="Kivuno groups"
    >
      <aside className="shared-group-list" ref={groupList} tabIndex={-1} aria-label="Group list">
        <h2>Groups</h2>
        {!listing && !error && <p role="status">Connecting to your Kivuno groups…</p>}
        <nav aria-label="Shared groups">
          {listing?.groups.map((group) => (
            <button
              className="shared-group-link"
              aria-label={group.name}
              disabled={busy}
              key={group.id}
              aria-current={selected === group.id ? 'page' : undefined}
              onClick={() => choose(group.id)}
            >
              <span className="shared-group-avatar" aria-hidden="true">
                {initials(group.name)}
              </span>
              <span className="shared-group-list-copy">
                <strong title={group.name}>{group.name}</strong>
                {group.lastMessagePreview && <small>{group.lastMessagePreview}</small>}
              </span>
              {group.lastMessageAt && (
                <time dateTime={group.lastMessageAt}>
                  {timeLabel.format(new Date(group.lastMessageAt))}
                </time>
              )}
            </button>
          ))}
        </nav>
        {error && (
          <p className="shared-group-list-error error-text" role="alert">
            {error}
          </p>
        )}
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
      </aside>
      <div className="shared-group-room">
        <button
          className="shared-group-back text-button"
          type="button"
          aria-label="Back to group list"
          onClick={backToGroups}
        >
          <ArrowLeft size={17} aria-hidden="true" /> Groups
        </button>
        {error && !editing && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {selected && !room && !error && <p role="status">Opening group…</p>}
        {listing && !selected && !error && (
          <p className="shared-group-placeholder">Select a group to open the conversation.</p>
        )}
        {room && room.id === selected && (
          <>
            <header className="shared-group-heading">
              <span className="shared-group-avatar" aria-hidden="true">
                {initials(room.name)}
              </span>
              <div>
                <h2 ref={roomHeading} tabIndex={-1}>
                  {room.name}
                </h2>
                <p>
                  {room.people.length} {room.people.length === 1 ? 'member' : 'members'}
                  {room.teammates.length > 0 && (
                    <>
                      {' '}
                      · {room.teammates.length} shared{' '}
                      {room.teammates.length === 1 ? 'teammate' : 'teammates'}
                    </>
                  )}
                </p>
              </div>
              <button
                className="button compact"
                aria-haspopup="dialog"
                onClick={() => {
                  setEditing(true);
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
                <Users size={16} aria-hidden="true" /> Members
              </button>
            </header>
            <dialog
              ref={membersDialog}
              className="shared-group-dialog"
              aria-labelledby="shared-group-members-title"
              onClose={(event) => {
                if (!event.currentTarget.open) setEditing(false);
              }}
            >
              <header>
                <h3 id="shared-group-members-title">Group members</h3>
                <button
                  type="button"
                  className="text-button"
                  aria-label="Close group members"
                  onClick={() => membersDialog.current?.close()}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </header>
              {error && (
                <p className="error-text" role="alert">
                  {error}
                </p>
              )}
              <section className="shared-group-members" aria-label="Member settings">
                <div className="shared-group-roster" aria-label="Shared teammates">
                  {room.teammates.map((member) => (
                    <span key={`${member.ownerId}:${member.localId}`}>
                      {member.name} ·{' '}
                      {room.people.find((person) => person.id === member.ownerId)?.name}
                    </span>
                  ))}
                </div>

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
                  <button
                    className="text-button"
                    onClick={() => {
                      membersDialog.current?.close();
                      addTeammate();
                    }}
                  >
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
                        ...(supportsProjects && projectOrchestration
                          ? { projectOrchestration: true }
                          : {}),
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
                  {supportsProjects && (
                    <label>
                      <input
                        type="checkbox"
                        checked={projectOrchestration}
                        onChange={(event) => setProjectOrchestration(event.target.checked)}
                      />
                      Allow project orchestration and share assigned session updates
                    </label>
                  )}
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
                    {grant.projectOrchestration && ' · Project orchestration'}
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
            </dialog>
            {latestSade && (
              <details className="shared-group-disclosure" key={room.id}>
                <summary
                  aria-label="Sade activity"
                  aria-describedby={
                    waiting && latestSade.canAnswer
                      ? 'shared-sade-state shared-sade-reply'
                      : 'shared-sade-state'
                  }
                >
                  <ListTodo size={17} aria-hidden="true" />
                  <strong id="shared-sade-state">Sade · {latestSade.state}</strong>
                  {waiting && latestSade.canAnswer && (
                    <span id="shared-sade-reply">Reply requested</span>
                  )}
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <div className="shared-group-disclosure-body">
                  <section
                    aria-label="Sade progress"
                    className="shared-group-members"
                    data-sade-run={latestSade.id}
                  >
                    <strong>Sade · {latestSade.state}</strong>
                    {latestSade.error && <p>{latestSade.error}</p>}
                    <ul>
                      {latestSade.jobs.map((job) => (
                        <li key={job.id}>
                          {job.task?.title ||
                            (job.phase === 'review' ? 'Independent review' : 'Plan')}{' '}
                          · {grantLabels.get(job.grantId) || 'Assigned teammate'} · {job.state}
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
                                  setTaskUpdate({
                                    jobId: job.id,
                                    id: crypto.randomUUID(),
                                    text: '',
                                  })
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
                          void run(() =>
                            submitRoom<GroupSadeView & { sadeGroup?: GroupSadeView }>(
                              {
                                action: 'sade-answer',
                                groupId: room.id,
                                runId: latestSade.id,
                                jobId: waiting.id,
                                answer: answer.trim(),
                              },
                              (result) => {
                                setAnswer('');
                                const view = result?.sadeGroup ?? result;
                                if (!view?.sadeRuns || (view.group && view.group.id !== room.id))
                                  return false;
                                applyGroupView(view);
                                return true;
                              },
                            ),
                          );
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
                  {latestProject && latestProject.groupId === selected && (
                    <SharedSadeProject
                      key={latestProject.id}
                      run={latestProject}
                      localSessions={sessions}
                      requestStatus={() =>
                        run(async () => {
                          await submitRoom<GroupSadeView>(
                            {
                              action: 'sade-project-status',
                              groupId: latestProject.groupId,
                              runId: latestProject.id,
                            },
                            (view) => {
                              applyGroupView(view);
                              return true;
                            },
                          );
                        })
                      }
                    />
                  )}
                </div>
              </details>
            )}
            <div
              className="shared-group-history"
              ref={history}
              onScroll={(event) => {
                const stream = event.currentTarget;
                nearLatest.current =
                  stream.scrollHeight - stream.clientHeight - stream.scrollTop <= 64;
                setShowLatest(!nearLatest.current);
              }}
              role="log"
              tabIndex={0}
              aria-label="Group messages"
              aria-live="polite"
            >
              <div className="shared-group-feed">
                {messages.map((message, index) => {
                  const previous = messages[index - 1];
                  const date = new Date(message.createdAt);
                  const previousDate = previous && new Date(previous.createdAt);
                  const startsDay = date.toDateString() !== previousDate?.toDateString();
                  const continuation =
                    !startsDay &&
                    previous?.ownerId === message.ownerId &&
                    previous.author === message.author &&
                    previousDate &&
                    date.getTime() - previousDate.getTime() <= 5 * 60 * 1000;
                  const own = message.ownerId === ownerId && message.author !== 'Sade';
                  return (
                    <div key={message.id}>
                      {startsDay && <p className="shared-group-date">{dateLabel.format(date)}</p>}
                      <article
                        className="shared-group-message"
                        data-own={own || undefined}
                        data-continuation={Boolean(continuation) || undefined}
                      >
                        <span className="shared-group-avatar" aria-hidden="true">
                          {initials(message.author)}
                        </span>
                        <div className="shared-group-message-content">
                          <div className="shared-group-message-meta">
                            <strong>{message.author}</strong>
                            <time dateTime={message.createdAt}>{timeLabel.format(date)}</time>
                          </div>
                          <div className="shared-group-bubble">
                            {message.sade?.replyTo && <small>Refers to a group message</small>}
                            <p>{message.content}</p>
                          </div>
                          {supportsReferencedMessage &&
                            linkedProjects.some(
                              ([key]) => !message.sade || key === message.sade.projectKey,
                            ) && (
                              <button
                                type="button"
                                className="text-button"
                                disabled={busy}
                                onClick={() => {
                                  setReference(message);
                                  if (message.sade) setProjectKey(message.sade.projectKey);
                                  else if (linkedProjects.length === 1)
                                    setProjectKey(linkedProjects[0][0]);
                                  composer.current?.focus();
                                }}
                              >
                                Ask Sade about this
                              </button>
                            )}
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
            </div>
            {showLatest && (
              <div className="shared-group-latest">
                <button
                  type="button"
                  className="button compact"
                  onClick={() => {
                    if (!history.current) return;
                    history.current.scrollTop = history.current.scrollHeight;
                    history.current.focus({ preventScroll: true });
                  }}
                >
                  <ArrowDown size={16} aria-hidden="true" /> Latest messages
                </button>
              </div>
            )}
            <div className="shared-group-footer">
              {reference && (
                <div
                  className="shared-group-reference"
                  role="group"
                  aria-label="Selected message for Sade"
                >
                  <div>
                    <strong>{reference.author}</strong>
                    <p title={reference.content.slice(0, 160)}>{reference.content.slice(0, 160)}</p>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    aria-label="Remove message reference"
                    disabled={busy}
                    onClick={() => setReference(undefined)}
                  >
                    Remove
                  </button>
                </div>
              )}
              <form
                className="shared-group-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (needsReferenceProject || needsSadeProject || !content.trim()) return;
                  void run(async () => {
                    const draft = messageDraft.current;
                    const readOnly = Boolean(projectKey) && readOnlyRequest;
                    const replyTo = reference?.id;
                    const image = !readOnly && projectKey ? catalogue : undefined;
                    const next: NonNullable<typeof messageDraft.current> =
                      draft?.content === content &&
                      draft.groupId === room.id &&
                      (draft.sade?.projectKey || '') === projectKey &&
                      Boolean(draft.sade?.readOnly) === readOnly &&
                      draft.sade?.replyTo === replyTo &&
                      draft.catalogue === image
                        ? draft
                        : {
                            id: crypto.randomUUID(),
                            content,
                            groupId: room.id,
                            catalogue: image,
                            ...(projectKey
                              ? {
                                  sade: {
                                    projectKey,
                                    ...(readOnly ? { readOnly: true } : {}),
                                    ...(replyTo ? { replyTo } : {}),
                                    ...(image ? { catalogue: true } : {}),
                                  },
                                }
                              : {}),
                          };
                    messageDraft.current = next;
                    if (image)
                      await window.relayDesktop!.projectCatalogue({
                        groupId: room.id,
                        runId: next.id,
                        projectKey,
                        data: await catalogueJpeg(image),
                      });
                    const { catalogue: _localImage, ...message } = next;
                    await submitRoom<SharedMessage & { sadeGroup?: GroupSadeView }>(
                      { action: 'message', ...message },
                      (saved) => {
                        messageDraft.current = null;
                        setContent('');
                        setProjectKey('');
                        setReadOnlyRequest(false);
                        setReference(undefined);
                        setCatalogue(undefined);
                        if (saved?.id !== next.id || saved.groupId !== room.id) return false;
                        const { sadeGroup, ...message } = saved;
                        if (Number.isSafeInteger(message.sequence))
                          setMessages((previous) => mergeMessages(previous, [message]));
                        if (sadeGroup?.group?.id !== room.id) return false;
                        applyGroupView(sadeGroup);
                        return true;
                      },
                    );
                  });
                }}
              >
                <textarea
                  ref={composer}
                  aria-label="Message group"
                  placeholder="Message group"
                  value={content}
                  onChange={(event) => {
                    const text = event.target.value;
                    setContent(text);
                    if (
                      !projectKey &&
                      supportsProjects &&
                      /^\s*@sade\b/i.test(text) &&
                      projectOptions.length === 1
                    )
                      setProjectKey(projectOptions[0][0]);
                  }}
                  maxLength={8000}
                  required
                />
                {(projectOptions.length > 0 || reference) && (
                  <div className="shared-group-compose-controls">
                    <select
                      aria-label="Ask Sade in this group"
                      value={reference && !projectIsAvailable ? '' : projectKey}
                      onChange={(event) => setProjectKey(event.target.value)}
                    >
                      <option value="">
                        {reference ? 'Choose a project' : 'Send a group message'}
                      </option>
                      {projectOptions.map(([key, name]) => (
                        <option key={key} value={key}>
                          Ask Sade · {name}
                        </option>
                      ))}
                    </select>
                    {projectKey && (
                      <label>
                        <input
                          type="checkbox"
                          checked={readOnlyRequest}
                          onChange={(event) => setReadOnlyRequest(event.target.checked)}
                        />
                        Read-only request
                      </label>
                    )}
                    {supportsProjects &&
                      projectKey &&
                      !readOnlyRequest &&
                      window.relayDesktop?.projectCatalogue && (
                        <div className="shared-group-catalogue">
                          <label>
                            Catalogue image
                            <input
                              ref={catalogueInput}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={busy}
                              onChange={(event) => setCatalogue(event.target.files?.[0])}
                            />
                          </label>
                          {catalogue && (
                            <button
                              className="text-button"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                if (catalogueInput.current) catalogueInput.current.value = '';
                                setCatalogue(undefined);
                              }}
                            >
                              Remove catalogue image
                            </button>
                          )}
                        </div>
                      )}
                  </div>
                )}
                <button
                  className="button primary"
                  disabled={busy || !content.trim() || needsReferenceProject || needsSadeProject}
                >
                  <Send size={16} aria-hidden="true" />
                  {projectKey || reference || needsSadeProject ? 'Ask Sade' : 'Send'}
                </button>
                {needsSadeProject && <p role="status">Choose a linked project for @Sade.</p>}
              </form>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
