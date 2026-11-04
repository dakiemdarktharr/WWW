import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Search, Terminal } from 'lucide-react';
import type { CodexSession, Member } from '../shared/types';
import { providerLabels, providerOf } from './ProviderConnect';

const perPage = 24;
export default function SessionGraph({
  sessions,
  members,
  selected,
  select,
}: {
  sessions: CodexSession[];
  members: Member[];
  selected: string;
  select: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const filtered = useMemo(
    () =>
      sessions.filter((session) =>
        `${session.title} ${session.status} ${providerLabels[session.provider || providerOf(members.find((member) => member.id === session.memberId))]} ${members.find((member) => member.id === session.memberId)?.name || ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [sessions, members, query],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * perPage, (current + 1) * perPage);
  const height = Math.max(210, Math.ceil(shown.length / 3) * 92 + 52);
  const nodes = shown.map((session, i) => ({
    session,
    x: 58 + (i % 3) * 114,
    y: 60 + Math.floor(i / 3) * 92,
  }));
  return (
    <div className="session-graph-panel">
      <label className="chat-search">
        <Search size={14} />
        <input
          aria-label="Search all sessions"
          placeholder="Find a session…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
      </label>
      <div className="session-graph" aria-label="Session map">
        {shown.length ? (
          <svg
            viewBox={`0 0 344 ${height}`}
            role="group"
            aria-label={`${filtered.length} sessions, page ${current + 1} of ${pages}`}
          >
            {nodes.map((node, i) => {
              const previous = nodes
                .slice(0, i)
                .findLast((other) => other.session.memberId === node.session.memberId);
              return (
                previous && (
                  <path
                    key={`edge-${node.session.id}`}
                    d={`M${previous.x},${previous.y} Q172,${(previous.y + node.y) / 2} ${node.x},${node.y}`}
                    className="session-edge"
                  />
                )
              );
            })}
            {nodes.map(({ session, x, y }) => (
              <g
                key={session.id}
                role="button"
                tabIndex={0}
                aria-label={`${session.title}, ${members.find((member) => member.id === session.memberId)?.name || 'Codex'}, ${session.status}`}
                aria-pressed={selected === session.id}
                className={`session-node ${selected === session.id ? 'selected' : ''} status-${session.status}`}
                onClick={() => select(session.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select(session.id);
                  }
                }}
              >
                <title>
                  {session.title} ·{' '}
                  {
                    providerLabels[
                      session.provider ||
                        providerOf(members.find((member) => member.id === session.memberId))
                    ]
                  }{' '}
                  · {session.status} · {session.model || 'Auto model'}
                </title>
                <rect
                  x={x - 52}
                  y={y - 24}
                  width={104}
                  height={80}
                  rx={12}
                  fill="transparent"
                  pointerEvents="all"
                />
                <circle cx={x} cy={y} r={16} />
                <circle className="node-core" cx={x} cy={y} r={5} />
                <text x={x} y={y + 33} textAnchor="middle">
                  {session.title.length > 15 ? `${session.title.slice(0, 14)}…` : session.title}
                </text>
                <text className="node-owner" x={x} y={y + 48} textAnchor="middle">
                  {members.find((member) => member.id === session.memberId)?.name || 'Agent'} ·{' '}
                  {
                    providerLabels[
                      session.provider ||
                        providerOf(members.find((member) => member.id === session.memberId))
                    ]
                  }
                </text>
              </g>
            ))}
          </svg>
        ) : (
          <div className="chat-empty compact">
            <Terminal size={25} />
            <p>{query ? 'No matching sessions' : 'No sessions'}</p>
          </div>
        )}
      </div>
      <div className="graph-pagination">
        <span>{filtered.length} sessions</span>
        <button
          className="icon-button"
          aria-label="Previous sessions"
          disabled={!current}
          onClick={() => setPage(current - 1)}
        >
          <ArrowLeft size={14} />
        </button>
        <span>
          {current + 1} / {pages}
        </span>
        <button
          className="icon-button"
          aria-label="Next sessions"
          disabled={current === pages - 1}
          onClick={() => setPage(current + 1)}
        >
          <ArrowRight size={14} />
        </button>
      </div>
      <div className="session-map-list">
        {shown.map((session) => (
          <button
            key={session.id}
            className={selected === session.id ? 'selected' : ''}
            onClick={() => select(session.id)}
          >
            <span className={`session-dot status-${session.status}`} />
            <span>{session.title}</span>
            <small>{session.status}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
