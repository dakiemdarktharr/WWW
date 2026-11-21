import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  FolderGit2,
  KeyRound,
  MessageSquare,
  Plus,
  Presentation,
  Search,
  Users,
} from 'lucide-react';
import type { WorkspaceState } from '../shared/types';
import type { GroupListing } from '../shared/collaboration';
import { chatList } from '../shared/chat-list';
import './ChatHome.css';

export type ChatSelection = { kind: 'project' | 'shared'; id: string } | { kind: 'slides' };

export function useChatGroups(enabled: boolean, revision: number) {
  const [listing, setListing] = useState<GroupListing>();
  const [error, setError] = useState('');
  useEffect(() => {
    const desktop = window.relayDesktop;
    if (!enabled || !desktop?.groups) return;
    let live = true;
    let inFlight = false;
    const refresh = async () => {
      if (!live || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const next = await desktop.groups<GroupListing>({ action: 'list' });
        if (live) {
          setListing(next);
          setError('');
        }
      } catch (cause) {
        if (live) setError((cause as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, revision]);
  return { listing, error };
}

export default function ChatHome({
  state,
  listing,
  error,
  selected,
  open,
  createProject,
  enterGroup,
  slides,
  railRef,
  children,
}: {
  state: WorkspaceState;
  listing?: GroupListing;
  error: string;
  selected: ChatSelection | null;
  open: (selection: ChatSelection) => void;
  createProject: () => void;
  enterGroup?: (mode: 'create' | 'join') => void;
  slides: boolean;
  railRef: Ref<HTMLElement>;
  children?: ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const rows = chatList(state, listing?.groups).filter((row) =>
    `${row.name} ${row.preview}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const pick = (action: () => void) => {
    setAdding(false);
    addButton.current?.focus();
    action();
  };
  return (
    <aside className="chat-home" aria-label="Chat list" tabIndex={-1} ref={railRef}>
      <header>
        <h1>Chats</h1>
        <button
          type="button"
          className="chat-home-add"
          aria-label="New or join chat"
          title="New or join chat"
          aria-controls="chat-add-options"
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
          ref={addButton}
        >
          <Plus size={25} aria-hidden="true" />
        </button>
      </header>
      <div
        id="chat-add-options"
        className="chat-home-actions"
        hidden={!adding}
        onKeyDown={(event) => {
          if (event.key === 'Escape') pick(() => {});
        }}
      >
        {enterGroup && (
          <>
            <button type="button" onClick={() => pick(() => enterGroup('create'))}>
              <Users size={16} /> Create group chat
            </button>
            <button type="button" onClick={() => pick(() => enterGroup('join'))}>
              <KeyRound size={16} /> Join with room ID
            </button>
          </>
        )}
        <button type="button" onClick={() => pick(createProject)}>
          <FolderGit2 size={16} /> {enterGroup ? 'Connect project folder' : 'New project'}
        </button>
      </div>
      <label className="chat-home-search">
        <Search size={16} />
        <input
          type="search"
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
      <nav className="chat-home-list" aria-label="Chats by latest activity">
        {slides && !search.trim() && (
          <button
            type="button"
            className="chat-home-row"
            aria-current={selected?.kind === 'slides' ? 'page' : undefined}
            onClick={() => open({ kind: 'slides' })}
          >
            <span className="chat-home-avatar" aria-hidden="true">
              <Presentation size={16} />
            </span>
            <span className="chat-home-content">
              <strong>Sade slides</strong>
            </span>
          </button>
        )}
        {rows.map((row) => {
          const current = selected?.kind === row.kind && selected.id === row.id;
          return (
            <button
              type="button"
              key={`${row.kind}:${row.id}`}
              className="chat-home-row"
              onClick={() => open({ kind: row.kind, id: row.id })}
              aria-current={current ? 'page' : undefined}
              aria-label={`Open ${row.kind === 'project' ? 'project' : 'group'} ${row.name}`}
            >
              <span className="chat-home-avatar" aria-hidden="true">
                {row.kind === 'project' ? <FolderGit2 size={16} /> : <MessageSquare size={16} />}
              </span>
              <span className="chat-home-content">
                <strong title={row.name}>{row.name}</strong>
                <span>
                  {row.preview || (row.kind === 'shared' ? 'Shared group' : 'Project chat')}
                </span>
              </span>
            </button>
          );
        })}
        {!rows.length && (
          <p role="status">{search.trim() ? 'No matching chats' : 'No chats yet'}</p>
        )}
      </nav>
      {children}
    </aside>
  );
}
