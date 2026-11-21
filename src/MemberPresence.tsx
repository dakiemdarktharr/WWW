import type { Member } from '../shared/types';
import { useClaudeAccount, useClaudeCodeAccount } from './ClaudeAccount';

export function useMemberConnection(member: Member) {
  const id = member.provider === 'claude' && !member.entitlementLocked ? member.id : undefined;
  const web = useClaudeAccount(id);
  const code = useClaudeCodeAccount(id);
  let status =
    member.presence ||
    (member.status === 'offline' || member.status === 'error' ? 'offline' : 'online');
  let label: string = status;
  if (id) {
    if (web.account?.status === 'connected') {
      status = 'online';
      label = 'Claude connected';
    } else if (code?.signedIn) {
      status = 'online';
      label = 'Claude Code signed in';
    } else if (status === 'offline') {
      label = web.error
        ? 'Connection unavailable'
        : !web.account
          ? 'Checking connection'
          : web.account?.status === 'pending'
            ? 'Waiting for Claude'
            : 'Claude not linked';
    }
  }
  return { status, label, web, code };
}

export default function MemberPresence({ member, dot = false }: { member: Member; dot?: boolean }) {
  const { status, label } = useMemberConnection(member);
  return dot ? (
    <i className={`presence-dot ${status}`} title={label} aria-label={label} />
  ) : (
    <span className={`member-presence ${status}`}>
      <i />
      {label}
    </span>
  );
}
