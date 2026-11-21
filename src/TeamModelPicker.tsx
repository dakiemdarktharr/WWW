import { ArrowUpRight, Check, ChevronDown, Cpu, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { isExternalMember, providerLabels } from '../shared/providers';
import type { CodexModel, Member } from '../shared/types';
import { api } from './api';
import { savedClaudeClient } from './ClaudeAccount';
import { openExternal } from './desktop';

const tiers = ['High capacity', 'Standard', 'Fast'] as const;
type ModelOption = Pick<CodexModel, 'model' | 'displayName'>;
function tierOf(model: ModelOption) {
  const name = `${model.model} ${model.displayName}`.toLowerCase().split(/[^a-z0-9]+/);
  if (
    ['mini', 'nano', 'flash', 'lite', 'spark', 'luna', 'haiku'].some((word) => name.includes(word))
  )
    return 'Fast';
  if (['pro', 'ultra', 'max', 'opus', 'astra', 'fable'].some((word) => name.includes(word)))
    return 'High capacity';
  return 'Standard';
}

export default function TeamModelPicker({
  member,
  busy,
  onSaved,
}: {
  member: Member;
  busy: boolean;
  onSaved: (model: string | undefined) => void;
}) {
  const panel = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState<{ key: string; models: ModelOption[]; error?: string }>();
  const [saveError, setSaveError] = useState('');
  const [claudeClient, setClaudeClient] = useState(() => savedClaudeClient(member.id));
  const [browseCode, setBrowseCode] = useState(false);
  const [openedCodeModel, setOpenedCodeModel] = useState<string>();
  const external = isExternalMember(member);
  const provider = providerLabels[member.provider || 'codex'];
  const claude = member.provider === 'claude';
  const canOpenCode = claude && Boolean(window.relayDesktop?.claudeClient);
  const code = canOpenCode && (claudeClient === 'code' || browseCode);
  const readable = !member.entitlementLocked && (code || Boolean(member.account && !external));
  const key = JSON.stringify([
    member.id,
    member.runnerId,
    member.account?.email,
    member.account?.type,
    member.connectedAt,
    code,
  ]);
  const current = readable && catalog?.key === key ? catalog : undefined;
  const preferred = code ? openedCodeModel : member.preferredModel;
  const selected = current?.models.find((model) => model.model === preferred);
  const automatic = code ? 'Claude Code default' : 'Automatic';
  const value =
    external && !code ? `Choose in ${provider}` : selected?.displayName || preferred || automatic;

  useEffect(() => {
    if (!claude) return;
    function changed(event: Event) {
      if ((event as CustomEvent<string>).detail !== member.id) return;
      setClaudeClient(savedClaudeClient(member.id));
      setBrowseCode(false);
    }
    window.addEventListener('kivuno-claude-client-changed', changed);
    return () => window.removeEventListener('kivuno-claude-client-changed', changed);
  }, [claude, member.id]);

  useEffect(() => {
    if (!open || !readable) return;
    let live = true;
    let inFlight = false;
    async function load() {
      if (!live || document.hidden || inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const models = code
          ? await window.relayDesktop!.claudeClient('models')
          : await api<ModelOption[]>(`/members/${member.id}/models`);
        if (live)
          setCatalog({
            key,
            models: [...new Map(models.map((model) => [model.model, model])).values()],
          });
      } catch (error) {
        if (live) setCatalog({ key, models: [], error: (error as Error).message });
      } finally {
        inFlight = false;
        if (live) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(load, 20_000);
    window.addEventListener('focus', load);
    window.addEventListener('online', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener('online', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [open, readable, key, member.id, revision, code]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  async function select(model: string | null) {
    if (saving.current || busy || !readable) return;
    saving.current = true;
    setSaveError('');
    setPending(true);
    try {
      if (code) {
        await window.relayDesktop!.claudeClient('code-model', model);
        setOpenedCodeModel(model ?? undefined);
      } else {
        const updated = await api<Member>(`/members/${member.id}/model`, { model }, 'PATCH');
        onSaved(updated.preferredModel);
      }
      if (root.current?.contains(document.activeElement)) trigger.current?.focus();
      setOpen(false);
    } catch (error) {
      setSaveError((error as Error).message);
      setRevision((current) => current + 1);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  async function openClaudePicker() {
    if (saving.current || busy) return;
    saving.current = true;
    setPending(true);
    setSaveError('');
    try {
      if (claudeClient === 'desktop' && window.relayDesktop?.claudeClient)
        await window.relayDesktop.claudeClient('desktop');
      else await openExternal('https://claude.ai/new');
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return (
    <div
      className="team-model"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        trigger.current?.focus();
        setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="button team-model-trigger"
        aria-label={`Model for ${member.name}: ${value}`}
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        disabled={member.entitlementLocked}
        onClick={() => {
          setSaveError('');
          setOpen(!open);
        }}
      >
        <Cpu size={15} aria-hidden="true" />
        <span>Model</span>
        <strong title={value}>{value}</strong>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={panel}
          className="team-model-panel"
          role="group"
          aria-label={`Models for ${member.name}`}
        >
          {external && !code ? (
            claude ? (
              <>
                <button
                  className="team-model-option"
                  type="button"
                  aria-disabled={busy || pending}
                  onClick={() => void openClaudePicker()}
                >
                  <span>
                    {claudeClient === 'desktop' && window.relayDesktop?.claudeClient
                      ? 'Choose in Claude Desktop'
                      : 'Choose in Claude Web'}
                  </span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
                {canOpenCode && (
                  <button
                    className="team-model-option"
                    type="button"
                    onClick={() => setBrowseCode(true)}
                  >
                    Browse Claude Code models
                  </button>
                )}
              </>
            ) : (
              <p>Choose the model in the connected {provider} app.</p>
            )
          ) : !readable ? (
            <p>Sign in to this account to see its models.</p>
          ) : (
            <>
              <button
                type="button"
                className="team-model-option"
                aria-pressed={!preferred}
                aria-disabled={busy || pending}
                onClick={() => void select(null)}
              >
                <span>{automatic}</span>
                {!preferred && <Check size={14} aria-hidden="true" />}
              </button>
              {(!current || pending) && (
                <p className="team-model-progress" role="status">
                  <Loader2 size={13} className="spin" aria-hidden="true" />
                  {pending && code
                    ? 'Opening Claude Code…'
                    : pending
                      ? 'Checking model availability…'
                      : 'Checking account models…'}
                </p>
              )}
              {current?.error && !loading && (
                <div className="team-model-unavailable">
                  <p role="status">{current.error}</p>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setRevision((value) => value + 1)}
                  >
                    Retry
                  </button>
                </div>
              )}
              {current && !current.error && (
                <>
                  {preferred && !selected && (
                    <p role="status">
                      This model is no longer available. Pick another or use {automatic}.
                    </p>
                  )}
                  {!loading && !current.models.length && (
                    <p role="status">This account returned no models.</p>
                  )}
                  <div className="team-model-options">
                    {tiers.map((tier) => {
                      const entries = current.models.filter((model) => tierOf(model) === tier);
                      if (!entries.length) return null;
                      return (
                        <div className="team-model-tier" key={tier} role="group" aria-label={tier}>
                          <p>{tier}</p>
                          {entries.map((model) => (
                            <button
                              type="button"
                              key={model.model}
                              className="team-model-option"
                              aria-pressed={preferred === model.model}
                              title={model.model}
                              aria-disabled={busy || pending}
                              onClick={() => void select(model.model)}
                            >
                              <span>{model.displayName}</span>
                              {preferred === model.model && <Check size={14} aria-hidden="true" />}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              <p>
                {code
                  ? 'Opens a new Claude Code session with the chosen model.'
                  : 'Applies to the next automatic turn.'}
              </p>
            </>
          )}
          {saveError && (
            <p className="error-text" role="alert">
              {saveError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
