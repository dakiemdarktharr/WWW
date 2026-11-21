import { useState } from 'react';
import type { Member, Project } from '../shared/types';
import { useClaudeAccount } from './ClaudeAccount';
import type { ClaudeWebConnection } from './desktop';
import GlassSelect from './GlassSelect';

export default function ClaudeProjectSharing({
  member,
  project,
}: {
  member: Member;
  project: Project;
}) {
  const { account } = useClaudeAccount(member.id);
  const [minutes, setMinutes] = useState('60');
  const [grant, setGrant] = useState<ClaudeWebConnection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (account?.status !== 'connected' || !account.canShare || member.entitlementLocked) return null;
  async function update(revoke: boolean) {
    if (busy || !window.relayDesktop || !account?.connectionId) return;
    setBusy(true);
    setError('');
    try {
      if (revoke && grant) {
        await window.relayDesktop.revokeClaudeWebConnection(grant.id);
        setGrant(undefined);
      } else {
        setGrant(
          await window.relayDesktop.createClaudeWebConnection({
            memberId: member.id,
            projectId: project.id,
            durationMinutes: Number(minutes),
            accountConnectionId: account.connectionId,
          }),
        );
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="claude-project-sharing">
      <summary>Share project messages</summary>
      <div className="form">
        {grant && Date.parse(grant.expiresAt) > Date.now() ? (
          <>
            <p role="status">
              {member.name} can read messages in {project.name} until{' '}
              {new Date(grant.expiresAt).toLocaleString()}. In your Claude chat, enable Kivuno and
              ask to read the group. If the tool list is out of date, refresh it or start a new
              chat.
            </p>
            <button className="button" disabled={busy} onClick={() => void update(true)}>
              Revoke project access
            </button>
          </>
        ) : (
          <>
            <p>
              Share the name and group messages of {project.name} with {member.name} in Claude. You
              can share one project at a time. To review or revoke an existing grant, open Team →{' '}
              {member.name} → MESH connection.
            </p>
            <GlassSelect
              label="Project access duration"
              value={minutes}
              onChange={setMinutes}
              options={[15, 30, 60, 120, 480].map((n) => ({
                value: String(n),
                label: n + ' minutes',
              }))}
            />
            <button className="button primary" disabled={busy} onClick={() => void update(false)}>
              Allow read-only project access
            </button>
          </>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
