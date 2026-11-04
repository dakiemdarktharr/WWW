import { createHash } from 'node:crypto';
import path from 'node:path';
import { lstat, readdir, readFile } from 'node:fs/promises';
import type { CodexModel, Member, Task } from '../shared/types.ts';
import type { Workspace } from './service.ts';
import { readModels, readCapabilities } from './codex.ts';
import { groupMembers } from './groups.ts';
import { DomainError } from './store.ts';
import { redact } from './security.ts';
import { availableParallelism } from 'node:os';
import { scopesOverlap } from './security.ts';
import { exportSkills, installSkills } from './skill-sharing.ts';

interface QueuedConversation {
  id: string;
  parentId: string;
  prompt: string;
  status: 'queued' | 'paused' | 'starting' | 'started' | 'blocked';
  error?: string;
}

const names = [
  'Atlas',
  'Vega',
  'Nova',
  'Echo',
  'Orion',
  'Lyra',
  'Sage',
  'Rune',
  'Sol',
  'Iris',
  'Kite',
  'Lumen',
  'Astra',
  'Cedar',
  'Ember',
  'Sora',
];
const roles: Member['role'][] = ['engineer', 'researcher', 'designer', 'reviewer'];
export class CapacityError extends DomainError {}

/** Choose only values advertised by this signed-in account; never infer entitlements. */
export function chooseModel(
  models: CodexModel[],
  task: Pick<Task, 'kind' | 'title' | 'description' | 'effort' | 'phase'>,
) {
  if (!models.length) throw new DomainError('Codex returned no available models.');
  const complex =
    task.phase === 'plan' ||
    (task.effort || 0) >= 3 ||
    /architect|security|migrat|debug|kiến trúc|bảo mật|phân tích|research/i.test(
      `${task.title} ${task.description}`,
    );
  const lightweight =
    !complex && /summar|format|rename|tóm tắt|đổi tên/i.test(`${task.title} ${task.description}`);
  const standard = models.find((model) => model.isDefault) || models[0];
  const model = lightweight
    ? models.find((model) => /mini|small|fast/i.test(`${model.model} ${model.displayName}`)) ||
      standard
    : standard;
  const preferred =
    complex || task.kind === 'review'
      ? ['high', 'medium', 'low']
      : lightweight
        ? ['low', 'minimal', 'medium']
        : ['medium', 'high', 'low'];
  const supported = model.supportedReasoningEfforts.map((option) => option.reasoningEffort);
  if (!supported.length && !model.defaultReasoningEffort)
    return {
      model: model.model,
      reasoningEffort: undefined,
      selectionReason: `Account catalog → ${model.displayName}. This provider does not advertise reasoning controls.`,
    };
  const effort =
    preferred.find((value) => supported.includes(value)) || model.defaultReasoningEffort;
  if (!supported.includes(effort))
    throw new DomainError('Model catalog has no supported reasoning default.');
  return {
    model: model.model,
    reasoningEffort: effort,
    selectionReason: `${lightweight ? 'Light task' : complex ? 'Complex task' : task.kind}: account catalog → ${model.displayName} / ${effort}.`,
  };
}

export class Autonomy {
  private syncing = new Map<string, Promise<void>>();
  private lastSync = new Map<string, number>();
  private pluginSync = new Map<string, Promise<void>>();
  private pluginChecked = new Map<string, number>();
  private onboarding = new Map<string, Promise<void>>();
  private reservations = new Map<string, string>();
  private dispatching: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private host: Workspace) {
    for (const item of host.store.all<QueuedConversation>('conversationQueue'))
      if (['starting', 'queued'].includes(item.status))
        host.store.put('conversationQueue', {
          ...item,
          status: 'paused',
          error: 'Coordinator restarted. Inspect and resume this conversation explicitly.',
        });
  }
  get capacity() {
    return Math.max(
      1,
      Math.min(
        8,
        Number(process.env.RELAY_MAX_ACTIVE_TURNS) ||
          (process.env.RELAY_DEPLOYMENT === 'cloud' ? 2 : Math.min(4, availableParallelism())),
      ),
    );
  }
  reserve(id: string, memberId?: string) {
    const member = memberId ? this.host.store.get<Member>('member', memberId) : undefined;
    const machine = member?.runnerId || 'cloud';
    const node = member?.runnerId ? this.host.runners.assertReady(member.runnerId) : undefined;
    if (node?.busy)
      throw new CapacityError(
        'Execution machine is busy. Work waits until resources are available.',
      );
    const capacity = node?.slots || this.capacity;
    const active = new Set(
      this.host.sessions
        .all()
        .filter(
          (session) =>
            ['starting', 'running', 'interrupted'].includes(session.status) &&
            (this.host.store.members().find((member) => member.id === session.memberId)?.runnerId ||
              'cloud') === machine,
        )
        .map((session) => session.id),
    );
    for (const [reserved, location] of this.reservations)
      if (location === machine) active.add(reserved);
    if (!active.has(id) && active.size >= capacity)
      throw new CapacityError(
        `Machine capacity reached (${capacity} active turns). This work must wait for a slot.`,
      );
    this.reservations.set(id, machine);
    return () => this.reservations.delete(id);
  }
  start() {
    this.timer = setInterval(() => {
      void this.dispatch().catch((error) => this.host.log(redact(error), null, null, 'error'));
      for (const workflow of this.host.store.workflows())
        if (['planning', 'running', 'review'].includes(workflow.status))
          this.host.workflows.wakeProject(workflow.projectId);
      for (const project of this.host.store.projects()) {
        this.host.notifyMesh(project.id);
        void this.host.inbox
          .dispatch(project.id)
          .catch((error) => this.host.log(redact(error), null, null, 'error'));
      }
    }, 5000);
    this.timer.unref();
  }
  async conversation(
    parentId: string,
    raw: { title: string; prompt?: string; readOnly?: boolean },
  ) {
    const parent = this.host.sessions.get(parentId);
    if (
      this.host.sessions
        .all()
        .filter(
          (session) =>
            session.memberId === parent.memberId &&
            !['stopped', 'error', 'handoff'].includes(session.status),
        ).length >= 8
    )
      throw new DomainError('This account already has eight open conversations.');
    const session = await this.host.sessions.create({
      memberId: parent.memberId,
      projectId: parent.projectId,
      title: raw.title,
      readOnly: parent.readOnly || raw.readOnly !== false,
      modelPolicy: 'auto',
      scope: this.host.store.get<Task>('task', parent.taskId).scope,
    });
    if (raw.prompt?.trim())
      this.host.store.put('conversationQueue', {
        id: session.id,
        parentId,
        prompt: raw.prompt,
        status: 'queued',
      } satisfies QueuedConversation);
    this.host.mesh.post({
      projectId: parent.projectId,
      authorId: parent.memberId,
      sessionId: parentId,
      kind: 'progress',
      content: `Created conversation “${session.title}”${raw.prompt ? ' and queued its task' : ''}; model/reasoning will be selected from this account's catalog.`,
    });
    return session;
  }
  dispatch(): Promise<void> {
    if (this.host.closing) return Promise.resolve();
    if (!this.dispatching)
      this.dispatching = this.pump().finally(() => {
        this.dispatching = null;
      });
    return this.dispatching;
  }
  private async pump() {
    for (const item of this.host.store
      .all<QueuedConversation>('conversationQueue')
      .filter((item) => item.status === 'queued')) {
      if (this.host.closing) return;
      const session = this.host.sessions.get(item.id),
        task = this.host.store.get<Task>('task', session.taskId);
      if (session.status !== 'idle') {
        this.host.store.put('conversationQueue', {
          ...item,
          status: 'blocked',
          error: 'Conversation changed before queued startup.',
        });
        continue;
      }
      if (
        this.host.sessions
          .all()
          .filter(
            (s) => s.memberId === session.memberId && ['starting', 'running'].includes(s.status),
          ).length >= (this.host.store.get<Member>('member', session.memberId).maxSessions || 2)
      )
        continue;
      if (
        !session.readOnly &&
        this.host.store
          .leases()
          .some(
            (lease) =>
              lease.projectId === session.projectId && scopesOverlap(task.scope, lease.scopes),
          )
      )
        continue;
      try {
        this.reserve(session.id, session.memberId)();
      } catch {
        continue;
      }
      this.host.store.put('conversationQueue', { ...item, status: 'starting' });
      try {
        await this.host.sessions.send(session.id, item.prompt);
        this.host.store.put('conversationQueue', { ...item, status: 'started' });
      } catch (error) {
        this.host.store.put('conversationQueue', {
          ...item,
          status: 'blocked',
          error: redact(error),
        });
        this.host.mesh.ask(
          session.projectId,
          session.memberId,
          `Conversation ${session.title} needs attention`,
          redact(error),
        );
      }
    }
  }
  addAccount(provider: Member['provider'] = 'codex') {
    return this.host.store.transaction(() => {
      const members = this.host.store.members();
      const used = new Set(members.map((member) => member.name.toLowerCase()));
      const name = names.find((name) => !used.has(name.toLowerCase()));
      if (!name) throw new DomainError('This workspace already has its maximum team size.');
      const member = this.host.store.addMember({
        name,
        provider,
        integration: provider === 'claude' ? 'external' : 'native',
        role: roles[members.length % roles.length],
      });
      return this.host.store.updateMember(member.id, { managed: true });
    });
  }
  join(memberId?: string, projectId?: string) {
    const members = this.host.store
      .members()
      .filter((member) => member.account && (!memberId || member.id === memberId));
    for (const project of this.host.store
      .projects()
      .filter((project) => !projectId || project.id === projectId))
      for (const member of members)
        if (groupMembers(this.host.store, project.id).some((entry) => entry.id === member.id))
          this.host.mesh.ensureMember(project.id, member.id);
  }
  async model(memberId: string, task: Task) {
    await this.plugins(memberId);
    return chooseModel(await readModels(await this.host.client(memberId)), task);
  }
  private plugins(memberId: string): Promise<void> {
    const existing = this.pluginSync.get(memberId);
    if (existing) return existing;
    if (Date.now() - (this.pluginChecked.get(memberId) || 0) < 60_000) return Promise.resolve();
    const pending = this.sharePlugins(memberId)
      .catch((error) =>
        this.host.log(`Plugin sharing needs attention: ${redact(error)}`, null, memberId, 'system'),
      )
      .then(() => {
        this.pluginChecked.set(memberId, Date.now());
      })
      .finally(() => this.pluginSync.delete(memberId));
    this.pluginSync.set(memberId, pending);
    return pending;
  }
  async ready(memberId: string) {
    if (this.host.closing) return;
    let pending = this.onboarding.get(memberId);
    if (!pending) {
      pending = this.onboard(memberId).finally(() => this.onboarding.delete(memberId));
      this.onboarding.set(memberId, pending);
    }
    await pending;
  }
  private async onboard(memberId: string) {
    const member = this.host.store.get<Member>('member', memberId);
    if (!member.account) return;
    if (member.provider === 'claude' || member.integration === 'external') return;
    this.join(memberId);
    // Await on the next turn too; login does not start model work.
    await this.shareSkills(memberId);
    await this.plugins(memberId);
    const caps = await readCapabilities(await this.host.client(memberId), this.host.defaultCwd);
    this.host.store.updateMember(memberId, {
      skills: caps.skills,
      plugins: caps.plugins,
      capabilitiesError: caps.errors.join('; ') || undefined,
    });
    this.publish(memberId);
  }
  publish(memberId: string) {
    const member = this.host.store.get<Member>('member', memberId);
    const digest = createHash('sha256')
      .update(JSON.stringify([member.skills, member.plugins]))
      .digest('hex');
    const previous = this.host.store
      .all<{ id: string; digest: string }>('capabilitySnapshot')
      .find((record) => record.id === memberId);
    if (previous?.digest === digest) return;
    this.host.store.put('capabilitySnapshot', {
      id: memberId,
      digest,
      skills: member.skills,
      plugins: member.plugins,
      at: new Date().toISOString(),
    });
    for (const project of this.host.store
      .projects()
      .filter((project) =>
        groupMembers(this.host.store, project.id).some((member) => member.id === memberId),
      ))
      this.host.mesh.post({
        projectId: project.id,
        authorId: memberId,
        kind: 'system',
        content: `Shared capabilities: skills [${member.skills.slice(0, 40).join(', ') || 'none'}]; plugins [${member.plugins.slice(0, 40).join(', ') || 'none'}]. Teammates can learn from these capability inventories. Executable plugins require a human install; service authorization remains personal.`,
      });
  }
  async sharePlugins(memberId: string) {
    // Capability inventories are shared automatically; executable plugins and service
    // authorization always remain personal and require an explicit human install.
    this.publish(memberId);
  }
  shareSkills(memberId: string): Promise<void> {
    const member = this.host.store.get<Member>('member', memberId);
    if (member.provider && member.provider !== 'codex') return Promise.resolve();
    const existing = this.syncing.get(memberId);
    if (existing) return existing;
    if (Date.now() - (this.lastSync.get(memberId) || 0) < 60_000) return Promise.resolve();
    const pending = this.sync(memberId)
      .then(() => {
        this.lastSync.set(memberId, Date.now());
      })
      .finally(() => this.syncing.delete(memberId));
    this.syncing.set(memberId, pending);
    return pending;
  }
  private async sync(memberId: string) {
    if (
      this.host.sessions
        .all()
        .some((s) => s.memberId === memberId && ['starting', 'running'].includes(s.status)) ||
      this.host.running.has(memberId)
    )
      return;
    let copied = 0;
    const member = this.host.store.get<Member>('member', memberId);
    for (const source of this.host.store.members().filter(
      (source) =>
        (!source.provider || source.provider === 'codex') &&
        source.id !== memberId &&
        source.account &&
        this.host.store.projects().some((project) => {
          const ids = groupMembers(this.host.store, project.id).map((member) => member.id);
          return ids.includes(source.id) && ids.includes(memberId);
        }),
    )) {
      try {
        const skills = source.runnerId
          ? await (await this.host.client(source.id)).request('relay/skills/export', {})
          : await exportSkills(this.host.home(source.id));
        if (!skills.length) continue;
        const receipts: { name: string; digest: string; status: string }[] = member.runnerId
          ? await (await this.host.client(memberId)).request('relay/skills/install', skills)
          : await installSkills(this.host.home(memberId), skills);
        for (const receipt of receipts) {
          this.host.store.put('skillReceipt', {
            id: `${memberId}:${source.id}:${receipt.digest}`,
            memberId,
            sourceMemberId: source.id,
            ...receipt,
          });
          if (receipt.status === 'installed') copied++;
        }
      } catch (error) {
        this.host.log(
          `Team skill sharing needs attention: ${redact(error)}`,
          null,
          memberId,
          'system',
        );
      }
    }
    if (copied)
      for (const project of this.host.store
        .projects()
        .filter((project) =>
          groupMembers(this.host.store, project.id).some((member) => member.id === memberId),
        ))
        this.host.mesh.post({
          projectId: project.id,
          authorId: memberId,
          kind: 'system',
          content: `Received ${copied} versioned team skills. Existing skills and credentials were preserved.`,
        });
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([
      ...this.syncing.values(),
      ...this.pluginSync.values(),
      ...this.onboarding.values(),
      ...(this.dispatching ? [this.dispatching] : []),
    ]);
  }
}

/** A bounded snapshot. Never follow links or redistribute account/configuration files. */
export async function skillFiles(directory: string) {
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error('Linked skill directories cannot be shared.');
  const files: { name: string; content: Buffer }[] = [];
  let bytes = 0;
  async function walk(relative: string, depth: number) {
    if (depth > 8) throw new Error('Skill nesting exceeds its limit.');
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Skill contains a symbolic link.');
      if (
        /^(?:\.|node_modules$|auth\.json$|config\.toml$|credentials|.*(?:token|secret|password|private.?key))/i.test(
          entry.name,
        )
      )
        continue;
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        await walk(name, depth + 1);
        continue;
      }
      if (
        !entry.isFile() ||
        !/\.(?:md|txt|json|ya?ml|py|[cm]?js|ts|sh|ps1|css|html)$/i.test(entry.name)
      )
        continue;
      const stat = await lstat(path.join(directory, name));
      if (stat.size > 256 * 1024) throw new Error('Skill file exceeds 256 KB.');
      const content = await readFile(path.join(directory, name));
      bytes += content.length;
      if (bytes > 2 * 1024 * 1024 || files.length >= 128)
        throw new Error('Skill exceeds sharing budget.');
      if (
        content.includes(0) ||
        /\b(?:sk-|gh[opusr]_)[A-Za-z0-9_-]{10,}|-----BEGIN .*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(
          content.toString('utf8'),
        )
      )
        throw new Error('Skill may contain credentials.');
      files.push({ name, content });
    }
  }
  await walk('', 0);
  files.sort((a, b) => a.name.localeCompare(b.name));
  if (!files.some((file) => file.name === 'SKILL.md')) throw new Error('SKILL.md is required.');
  return files;
}
