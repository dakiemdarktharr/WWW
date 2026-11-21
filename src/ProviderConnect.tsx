import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Copy, Link2, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type {
  Member,
  Project,
  ProviderCapability,
  ProviderId,
  WorkspaceState,
} from '../shared/types';
import { api } from './api';
import { openExternal } from './desktop';
import {
  beginClaudeAccount,
  claudeClients,
  claudeConnectorsUrl,
  refreshClaudeAccount,
  useClaudeAccount,
  type ClaudeClient,
} from './ClaudeAccount';
import { activeProviderIds, isExternalProvider, providerLabels } from '../shared/providers';
import GlassSelect from './GlassSelect';
import HelpDetails from './HelpDetails';
import type { FoundationRequest } from './Foundation';
import './ProviderConnect.css';
import ConnectionProgress from './ConnectionProgress';

export { providerLabels };
export const providerOf = (member?: Pick<Member, 'provider'>): ProviderId =>
  member?.provider || 'codex';
export function ProviderPicker({
  value,
  change,
}: {
  value: ProviderId;
  change: (provider: ProviderId) => void;
}) {
  return (
    <GlassSelect
      label="AI provider"
      value={value}
      onChange={(value) => change(value as ProviderId)}
      options={activeProviderIds.map((value) => ({ value, label: providerLabels[value] }))}
    />
  );
}

export default function ProviderConnect({
  busy,
  runnerId,
  connect,
  profile,
  members,
}: {
  busy: boolean;
  runnerId?: string;
  connect: (
    provider: ProviderId,
    managedRuntime?: boolean,
    client?: ClaudeClient,
    existingMemberId?: string,
  ) => void;
  profile: () => void;
  members: Member[];
}) {
  const [provider, setProvider] = useState<ProviderId>('codex');
  const [client, setClient] = useState<ClaudeClient>('web');
  const [choice, setChoice] = useState<string>();
  const profiles = members.filter(
    (member) => member.provider === 'claude' && !member.runnerId && !member.entitlementLocked,
  );
  const selectedProfile =
    choice ?? (profiles.length === 1 ? profiles[0].id : profiles.length ? '' : 'new');
  const chooseExisting = provider === 'claude' && client === 'web' && profiles.length > 0;
  const [managedRuntime, setManagedRuntime] = useState(true);
  const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api<ProviderCapability[]>('/providers')
      .then((data) => {
        if (active) setCapabilities(data);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const capability = capabilities.find((entry) => entry.id === provider);
  const useManaged = provider === 'antigravity' && managedRuntime;
  const available = useManaged
    ? capability?.managed?.available
    : capability?.available || (provider === 'codex' && runnerId);
  const canPrepare =
    provider !== 'claude' &&
    typeof window.relayDesktop?.prepareProvider === 'function' &&
    capability?.installable !== false;
  return (
    <div className="provider-connect form">
      <ProviderPicker value={provider} change={setProvider} />
      {provider === 'antigravity' && (
        <label className="foundation-checkbox">
          <input
            type="checkbox"
            checked={managedRuntime}
            onChange={(event) => setManagedRuntime(event.target.checked)}
          />
          Let Sade use the Antigravity account on this computer
        </label>
      )}

      {provider === 'claude' && (
        <>
          <GlassSelect
            label="Claude client"
            value={client}
            onChange={(value) => setClient(value as ClaudeClient)}
            options={claudeClients}
          />
          {chooseExisting && (
            <GlassSelect
              label="Claude profile on this computer"
              value={selectedProfile}
              onChange={setChoice}
              options={[
                ...(profiles.length > 1 ? [{ value: '', label: 'Choose a Claude profile' }] : []),
                ...profiles.map((profile) => ({ value: profile.id, label: profile.name })),
                { value: 'new', label: 'Create a new Claude profile' },
              ]}
            />
          )}
          <p className="provider-summary">
            {client === 'web'
              ? 'Kivuno opens your Claude connectors. Link your account first. You can share project messages later.'
              : 'Use the project MCP connection in your signed-in Claude client.'}
          </p>
        </>
      )}
      <HelpDetails title="Connection help">
        <p>
          {provider === 'codex'
            ? 'Add each ChatGPT account separately on this computer. Each has its own sign-in, usage, skills and plugins. Finish one sign-in before adding the next; choose the intended account on OpenAI.'
            : provider === 'claude' && client === 'web'
              ? 'In Claude, choose Kivuno and then Connect (Connecter). Approve the account link in Kivuno.'
              : useManaged
                ? `Sade can assign work and independent reviews to ${providerLabels[provider]}. Connect the account, then choose a project and a limited number of prompts.`
                : `Connect your own ${providerLabels[provider]} client to this project through MESH MCP.`}
        </p>
      </HelpDetails>
      {canPrepare && (
        <p className="provider-summary">
          {isExternalProvider(provider)
            ? `Kivuno checks for the official ${providerLabels[provider]} CLI and installs it for your computer if it is missing. Sign-in and model use stay in that client.`
            : `Kivuno checks its bundled ${providerLabels[provider]} runtime and repairs it in Kivuno's private storage if needed.`}
        </p>
      )}
      {!loading && !canPrepare && !available && (
        <p className="error-text">
          {capability?.reason || error || 'This provider is unavailable on this machine.'}
        </p>
      )}
      <button
        className="button primary"
        disabled={
          busy || loading || (!available && !canPrepare) || (chooseExisting && !selectedProfile)
        }
        onClick={() =>
          connect(
            provider,
            useManaged,
            provider === 'claude' ? client : undefined,
            chooseExisting && selectedProfile !== 'new' ? selectedProfile : undefined,
          )
        }
      >
        {busy || loading ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
        {busy
          ? `Connecting ${providerLabels[provider]}…`
          : provider === 'claude' && client === 'web'
            ? 'Connect Claude in browser'
            : isExternalProvider(provider)
              ? `Add ${providerLabels[provider]} connection`
              : `Connect ${providerLabels[provider]}`}
      </button>
      {!(
        provider === 'claude' &&
        client === 'web' &&
        window.relayDesktop?.beginClaudeWebAccount
      ) && (
        <button className="text-button" onClick={profile} disabled={busy}>
          Create a profile first
        </button>
      )}
    </div>
  );
}

interface ExternalMetadata {
  transport?: 'claude-web' | 'stdio';
  id: string;
  memberId: string;
  projectId: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  lastSeen: string | null;
  allowTaskClaims: boolean;
  allowUnknownQuota: boolean;
}
export function ExternalConnection({
  member,
  projects,
  refreshProjects,
  googleSignIn,
  googleBusy,
  enableManaged,
  initialClaudeClient = 'web',
}: {
  member: Member;
  projects: Project[];
  refreshProjects: () => Promise<void>;
  googleSignIn: () => void;
  googleBusy: boolean;
  enableManaged?: () => void;
  initialClaudeClient?: ClaudeClient;
}) {
  const eligible = projects.filter((project) => project.memberIds?.includes(member.id));
  const [projectId, setProjectId] = useState(eligible[0]?.id || '');
  const [joinId, setJoinId] = useState('');
  const joinProject = projects.find((project) => project.id === joinId) || projects[0];
  const [minutes, setMinutes] = useState('60');
  const [claudeClient, setClaudeClient] = useState<ClaudeClient>(initialClaudeClient);
  const web = member.provider === 'claude' && claudeClient === 'web';
  const { account, error: accountError } = useClaudeAccount(web ? member.id : undefined, true);
  const [claims, setClaims] = useState(false);
  const [quota, setQuota] = useState(false);
  const [connections, setConnections] = useState<ExternalMetadata[]>([]);
  const [available, setAvailable] = useState(false);
  const [created, setCreated] = useState<{ id: string; expiresAt: string; config: unknown } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    const capability = (await api<ProviderCapability[]>('/providers')).find(
      (entry) => entry.id === providerOf(member),
    );
    setAvailable(Boolean(capability?.available));
    if (!capability?.available) {
      setCreated(null);
      setConnections([]);
      setError(
        capability?.reason ||
          'Open a local Kivuno desktop workspace to connect an external client.',
      );
      return;
    }
    setConnections(
      (await api<ExternalMetadata[]>('/external-connections')).filter(
        (connection) => connection.memberId === member.id,
      ),
    );
  };
  useEffect(() => {
    void refresh().catch((cause) => setError(cause.message));
    const timer = setInterval(
      () => {
        if (!document.hidden) void refresh().catch((cause) => setError(cause.message));
      },
      created ? 1500 : 10000,
    );
    const focus = () => void refresh().catch((cause) => setError(cause.message));
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [member.id, created?.id]);
  useEffect(() => {
    if (!eligible.some((project) => project.id === projectId)) {
      setProjectId(eligible[0]?.id || '');
      setCreated(null);
    }
  }, [eligible.map((project) => project.id).join(',')]);
  async function create() {
    setBusy(true);
    setError('');
    setCopied(false);
    setCreated(null);

    try {
      setCreated(
        await api('/external-connections', {
          memberId: member.id,
          projectId,
          durationMinutes: Number(minutes),
          allowTaskClaims: claims,
          allowUnknownQuota: quota,
        }),
      );
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const projectControls =
    available && eligible.length ? (
      <>
        <GlassSelect
          label="Connection project"
          value={projectId}
          onChange={(value) => {
            setProjectId(value);
            setCreated(null);
          }}
          options={eligible.map((project) => ({ value: project.id, label: project.name }))}
        />
        <GlassSelect
          label="Connection duration"
          value={minutes}
          onChange={setMinutes}
          options={[15, 30, 60, 120, 480].map((minutes) => ({
            value: String(minutes),
            label: `${minutes} minutes`,
          }))}
        />
        {!web && (
          <>
            <label className="foundation-checkbox">
              <input
                type="checkbox"
                checked={claims}
                onChange={(event) => setClaims(event.target.checked)}
              />
              Allow task claims, isolated worktrees and checkpoint pushes
            </label>
            <label className="foundation-checkbox">
              <input
                type="checkbox"
                checked={quota}
                onChange={(event) => setQuota(event.target.checked)}
              />
              I will monitor {providerLabels[providerOf(member)]} usage in my client
            </label>
          </>
        )}
        <button
          className="button primary"
          disabled={busy || !projectId}
          onClick={() => void create()}
        >
          <Link2 size={15} />
          Generate MCP config
        </button>
      </>
    ) : available ? (
      <div>
        {member.provider === 'claude' && joinProject ? (
          <>
            <GlassSelect
              label="Project to join"
              value={joinProject.id}
              onChange={setJoinId}
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
            />
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await api(`/projects/${joinProject.id}/member`, { memberId: member.id });
                  await refreshProjects();
                } catch (cause) {
                  setError((cause as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add {member.name} to this project
            </button>
          </>
        ) : (
          <span>No project membership</span>
        )}
        <HelpDetails title="Add to a group">
          <p>Chat → Group team → select {member.name}, then reopen this connection.</p>
        </HelpDetails>
      </div>
    ) : null;
  return (
    <div className="external-connection form">
      {enableManaged && member.provider === 'antigravity' && (
        <section>
          <p>
            Let Sade start and stop the official CLI, assign work and request independent reviews.
            Kivuno will ask you to confirm use of this computer’s Antigravity account. Project
            prompts require an allowance.
          </p>
          <button
            className="button"
            disabled={busy || googleBusy}
            onClick={() =>
              void Promise.resolve(enableManaged()).catch((cause) => setError(cause.message))
            }
          >
            Enable Sade execution
          </button>
        </section>
      )}
      {providerOf(member) === 'antigravity' && (
        <>
          <p>
            Sign in to Google through the official Antigravity CLI. Kivuno opens Terminal; your
            Google credentials stay with Antigravity.
          </p>
          <button className="button primary" disabled={busy || googleBusy} onClick={googleSignIn}>
            <ArrowUpRight size={15} /> Sign in with Google
          </button>
        </>
      )}
      {member.provider === 'claude' && (
        <>
          <GlassSelect
            label="Claude client"
            value={claudeClient}
            disabled={busy}
            onChange={(value) => {
              setClaudeClient(value as ClaudeClient);
              setCreated(null);

              setCopied(false);
              setError('');
            }}
            options={claudeClients}
          />
          {!web && (
            <div className="member-provider-actions">
              <button
                className="button"
                onClick={() =>
                  void openExternal('https://claude.ai/login').catch((cause) =>
                    setError(cause.message),
                  )
                }
              >
                <ArrowUpRight size={15} /> Open Claude sign-in in browser
              </button>
              {claudeClient === 'desktop' && (
                <button
                  className="text-button"
                  onClick={() =>
                    void openExternal('https://claude.com/download').catch((cause) =>
                      setError(cause.message),
                    )
                  }
                >
                  Get Claude Desktop
                </button>
              )}
            </div>
          )}
          {!web && (
            <p>
              {claudeClient === 'desktop'
                ? 'After signing in, open Claude Desktop with the same account and connect the project below.'
                : 'Start Claude Code and use /login to authorize the CLI in your browser. Connect the project below.'}
            </p>
          )}
        </>
      )}
      {web && (
        <section className="form claude-account-step">
          {account?.status === 'connected' ? (
            <>
              <strong role="status">
                <Check size={16} /> Claude connected
              </strong>
              <p>Your Claude client verified the Kivuno connector.</p>
              {account.canShare !== false ? (
                <p>
                  To share messages later, open a project in Chat → Group team, add {member.name} to
                  that group, then choose Share project messages.
                </p>
              ) : (
                <p>
                  This connection can verify your account only. Reconnect from Claude to request
                  project-sharing access.
                </p>
              )}
              {account.expiresAt && (
                <small>Account link expires {new Date(account.expiresAt).toLocaleString()}.</small>
              )}
              {account.connectionId && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await window.relayDesktop!.revokeClaudeWebConnection(account.connectionId!);

                      refreshClaudeAccount(member.id);
                      await refresh();
                    } catch (cause) {
                      setError((cause as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Disconnect Claude
                </button>
              )}
            </>
          ) : account?.status === 'pending' ? (
            <>
              <strong role="status">Waiting for Claude</strong>
              <p>
                In your Claude connectors, choose Kivuno → Connect (Connecter), then confirm the
                account link on Kivuno.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void openExternal(claudeConnectorsUrl).catch((cause) => setError(cause.message))
                }
              >
                <ArrowUpRight size={16} /> Open Claude connectors
              </button>
              <details>
                <summary>Add Kivuno to Claude for the first time</summary>
                <p>
                  Choose Add → Custom → Web, name it Kivuno and enter this URL. Save it, then choose
                  Connect.
                </p>
                <input
                  aria-label="Connector URL"
                  readOnly
                  value={account.url}
                  onFocus={(event) => event.target.select()}
                />
              </details>
            </>
          ) : (
            <>
              <p>
                Link the Claude account you use in the browser. You can choose a project after
                Claude verifies the connection.
              </p>
              <button
                className="button primary"
                disabled={busy || !available}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await beginClaudeAccount(member.id);
                  } catch (cause) {
                    setError((cause as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <ArrowUpRight size={16} /> Connect Claude in browser
              </button>
            </>
          )}
          {accountError && (
            <p className="error-text" role="alert">
              {accountError}
            </p>
          )}
        </section>
      )}
      {!web && projectControls}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {created && (
        <section className="provider-secret">
          <ConnectionProgress
            step={
              connections.some(
                (connection) =>
                  connection.id === created.id &&
                  connection.lastSeen &&
                  !connection.revokedAt &&
                  Date.parse(connection.expiresAt) > Date.now(),
              )
                ? 3
                : 1
            }
            labels={[
              'Create connection',
              `Add config in ${providerLabels[providerOf(member)]}`,
              'Verify MCP connection',
            ]}
          />
          <p>
            {providerOf(member) === 'antigravity'
              ? 'Confirm you are signed into your Google account in Antigravity, add this configuration, then ask it to read the group. Kivuno confirms the MESH connection automatically.'
              : `Sign in inside your ${providerLabels[providerOf(member)]} client, add this configuration, then ask it to read the group. Kivuno confirms the connection automatically.`}
          </p>
          {member.provider === 'claude' && (
            <p>
              {claudeClient === 'desktop'
                ? 'In Claude Desktop, open Settings → Developer → Edit Config. Merge the server below into mcpServers, save, then fully quit and reopen Claude. In a new chat, enable the Kivuno tools and ask Claude to read your project group.'
                : 'Save this JSON as kivuno-mcp.json outside the repository. In the project folder, start Claude Code with claude --mcp-config "<absolute path to kivuno-mcp.json>". Run /mcp to check the connection, then ask Claude to read your project group.'}
            </p>
          )}
          <strong>MCP configuration</strong>
          <textarea
            aria-label="MCP configuration"
            readOnly
            spellCheck={false}
            value={JSON.stringify(created.config, null, 2)}
          />
          <button
            className="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(JSON.stringify(created.config, null, 2))
                .then(() => setCopied(true))
                .catch(() => setError('Select and copy the configuration above.'))
            }
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy configuration'}
          </button>
          <HelpDetails title={`Connect your ${providerLabels[providerOf(member)]} client`}>
            <ol>
              <li>
                {providerOf(member) === 'antigravity'
                  ? 'In Antigravity, open MCP Servers → Manage MCP Servers → View raw config. Add this entry under mcpServers without replacing existing servers.'
                  : 'In Claude Desktop, open Settings → Developer → Edit Config. Merge this entry under mcpServers and fully quit and reopen Claude. For Claude Code, use your local or user MCP configuration.'}
              </li>
              <li>Restart that client and ask it to read this project's MESH group.</li>
              <li>
                Save your copy before closing. Access expires at{' '}
                {new Date(created.expiresAt).toLocaleTimeString()} or when Kivuno restarts.
              </li>
            </ol>
          </HelpDetails>
        </section>
      )}
      {connections.length > 0 && (!web || account?.status === 'connected') && (
        <div className="provider-connections">
          <strong>Connections</strong>
          {connections.map((connection) => {
            const expired =
              Boolean(connection.revokedAt) || Date.parse(connection.expiresAt) <= Date.now();
            return (
              <div key={connection.id}>
                <span>
                  {projects.find((project) => project.id === connection.projectId)?.name ||
                    'Project'}
                  <small>
                    {expired
                      ? 'Expired / revoked'
                      : connection.lastSeen
                        ? 'Connected'
                        : 'Waiting for client'}{' '}
                    · {new Date(connection.expiresAt).toLocaleTimeString()}
                  </small>
                </span>
                <button
                  className="icon-button"
                  aria-label="Revoke connection"
                  disabled={busy || expired}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      if (connection.transport === 'claude-web') {
                        if (!window.relayDesktop)
                          throw new Error('Revoke this connector from Kivuno desktop.');
                        await window.relayDesktop.revokeClaudeWebConnection(connection.id);
                      } else await api(`/external-connections/${connection.id}/revoke`, {});
                      if (created?.id === connection.id) setCreated(null);
                      await refresh();
                    } catch (cause) {
                      setError((cause as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProviderTurnAllowance({
  member,
  state,
  request,
  busy,
}: {
  member: Member;
  state: WorkspaceState;
  request: FoundationRequest;
  busy: boolean;
}) {
  const projects = state.projects.filter((project) => project.memberIds?.includes(member.id));
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [turns, setTurns] = useState('1');
  const [minutes, setMinutes] = useState('30');
  const [acknowledged, setAcknowledged] = useState(false);
  const grants = (state.providerTurnGrants || []).filter(
    (grant) =>
      grant.memberId === member.id && !grant.revokedAt && Date.parse(grant.expiresAt) > Date.now(),
  );
  useEffect(() => {
    if (!projects.some((project) => project.id === projectId)) setProjectId(projects[0]?.id || '');
  }, [projects.map((project) => project.id).join(',')]);
  return (
    <section className="provider-allowance">
      <strong>{providerLabels[providerOf(member)]} usage</strong>
      <span className="provider-tag">Quota unknown</span>
      {projects.length > 0 ? (
        <>
          <GlassSelect
            label={`Usage project for ${member.name}`}
            value={projectId}
            onChange={setProjectId}
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
          />
          <div className="provider-allowance-options">
            <GlassSelect
              label="Prompt allowance"
              value={turns}
              onChange={setTurns}
              options={[1, 2, 3, 5, 10].map((n) => ({
                value: String(n),
                label: `${n} prompt${n > 1 ? 's' : ''}`,
              }))}
            />
            <GlassSelect
              label="Allowance duration"
              value={minutes}
              onChange={setMinutes}
              options={[15, 30, 60, 120].map((n) => ({ value: String(n), label: `${n} min` }))}
            />
          </div>
          <label className="foundation-checkbox">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I understand remaining quota cannot be checked
          </label>
          <button
            className="button"
            disabled={busy || !acknowledged || !projectId}
            onClick={async () => {
              if (
                await request(`/members/${member.id}/quota/turn-grants`, {
                  projectId,
                  maxTurns: Number(turns),
                  expiresAt: new Date(Date.now() + Number(minutes) * 60000).toISOString(),
                  acknowledgeUnknownQuota: true,
                })
              )
                setAcknowledged(false);
            }}
          >
            <ShieldCheck size={14} />
            Allow prompts
          </button>
        </>
      ) : (
        <div>
          <span>No project membership</span>
          <HelpDetails title="Add to a group">
            <p>Chat → Group team → select {member.name}.</p>
          </HelpDetails>
        </div>
      )}
      {grants.map((grant) => (
        <div className="provider-grant" key={grant.id}>
          <span>
            {grant.usedTurns}/{grant.maxTurns} prompts ·{' '}
            {state.projects.find((project) => project.id === grant.projectId)?.name}
          </span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void request(`/quota/turn-grants/${grant.id}/revoke`, {})}
          >
            Revoke
          </button>
        </div>
      ))}
    </section>
  );
}
