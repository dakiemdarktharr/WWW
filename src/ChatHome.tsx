import { useEffect, useState } from 'react';
import { MessageSquare, Plus, Search, Users } from 'lucide-react';
import type { WorkspaceState } from '../shared/types';
import type { GroupListing, SharedGroup } from '../shared/collaboration';
import { chatList, type ChatListItem } from '../shared/chat-list';
import './ChatHome.css';

export default function ChatHome({
  state,
  projectsOnly = false,
  open,
  create,
  groups,
}: {
  state: WorkspaceState;
  projectsOnly?: boolean;
  open: (item: ChatListItem) => void;
  create: () => void;
  groups: () => void;
}) {
  const [shared, setShared] = useState<SharedGroup[]>([]),
    [error, setError] = useState(''),
    [search, setSearch] = useState('');
  const canShare = !!window.relayDesktop?.groups;
  useEffect(() => {
    if (!canShare || projectsOnly) return;
    let live = true,
      inFlight = false;
    const refresh = async () => {
      if (!live || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const listing = await window.relayDesktop!.groups<GroupListing>({ action: 'list' });
        if (live) {
          setShared(listing.groups);
          setError('');
        }
      } catch (cause) {
        if (live) setError((cause as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [canShare, projectsOnly]);
  const rows = chatList(state, projectsOnly ? [] : shared).filter((row) =>
    `${row.name} ${row.preview}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="chat-home" aria-label="All chats">
      <header>
        <h1>{projectsOnly ? 'Projects' : 'Chats'}</h1>
        <div>
          <button className="button compact" onClick={create}>
            <Plus size={15} />
            New project
          </button>
          {canShare && (
            <button className="button compact" onClick={groups}>
              <Users size={15} />
              Manage groups
            </button>
          )}
        </div>
      </header>
      <label className="chat-home-search">
        <Search size={16} />
        <input
          aria-label="Search chats"
          placeholder="Search chats"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {error && (
        <p role="status" className="error-text">
          Shared groups unavailable: {error}
        </p>
      )}
      <div className="chat-home-list" aria-label="Chats by latest activity">
        {rows.map((row) => (
          <button
            key={`${row.kind}:${row.id}`}
            className="chat-home-row"
            onClick={() => open(row)}
            aria-label={`Open ${row.kind === 'project' ? 'project' : 'group'} ${row.name}`}
          >
            <span className="chat-home-avatar">
              <MessageSquare size={21} />
            </span>
            <span className="chat-home-content">
              <strong>{row.name}</strong>
              <span>
                {row.preview || (row.kind === 'shared' ? 'Shared group' : 'Project chat')}
              </span>
            </span>
            <span className="chat-home-meta">
              <span>{row.kind === 'shared' ? 'Group' : 'Project'}</span>
              {row.active ? (
                <time dateTime={new Date(row.at).toISOString()}>
                  {new Date(row.at).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              ) : (
                <span>Inactive</span>
              )}
            </span>
          </button>
        ))}
        {!rows.length && <p role="status">{search ? 'No matching chats' : 'No chats yet'}</p>}
      </div>
    </section>
  );
}
