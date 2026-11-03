import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Member, Project } from '../shared/types.ts';
import type { Workspace } from './service.ts';
import { git } from './git.ts';
import { inside, privateDirectory } from './security.ts';
import { DomainError } from './store.ts';

export const hackathonInput = z
  .object({
    memberId: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    competitionName: z.string().trim().min(1).max(100),
    competitionUrl: z
      .url()
      .max(2000)
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      }, 'Use an HTTPS competition URL without credentials.'),
    deadline: z.iso.datetime({ offset: true }).nullable().optional(),
    goal: z.string().trim().min(1).max(16000),
  })
  .strict();
const slug = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 38) || 'project';
const creating = new WeakMap<Workspace, Set<string>>();

export async function createHackathonProject(
  host: Workspace,
  raw: unknown,
  assertCurrent: () => void = () => {},
) {
  assertCurrent();
  const input = hackathonInput.parse(raw);
  const member = host.store.get<Member>('member', input.memberId);
  const repositoryName = `NoSleepClub_${slug(input.competitionName)}_${slug(input.name)}`;
  const locks = creating.get(host) || new Set<string>();
  creating.set(host, locks);
  if (
    locks.has(repositoryName.toLowerCase()) ||
    host.store
      .projects()
      .some((project) => project.repositoryName?.toLowerCase() === repositoryName.toLowerCase())
  )
    throw new DomainError('This hackathon project already exists or is being created.');
  if (host.store.projects().length >= 30)
    throw new DomainError('The free workspace supports up to 30 projects.');
  locks.add(repositoryName.toLowerCase());
  try {
    const root = path.resolve(
      process.env.RELAY_PROJECTS_DIR || path.join(host.dataDir, '..', 'projects'),
    );
    if (inside(host.dataDir, root))
      throw new DomainError('Project repositories must be outside private account storage.');
    await privateDirectory(root);
    const id = randomUUID();
    const target = path.join(root, member.id, id);
    await mkdir(target, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(target, 'README.md'),
      `# ${input.name}\n\n${input.goal}\n\nCompetition: ${input.competitionName}\n${input.competitionUrl}\n\nOwner: ${member.name}\nDeadline: ${input.deadline || 'Not set'}\n`,
    );
    await git(target, ['init', '-b', 'main']);
    await git(target, ['add', 'README.md']);
    await git(target, [
      '-c',
      `user.name=${member.owner?.name || 'NoSleepClub RELAY'}`,
      '-c',
      `user.email=${member.owner?.email || 'relay@localhost.invalid'}`,
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Initialize hackathon workspace',
    ]);
    assertCurrent();
    const project = host.store.put('project', {
      id,
      name: input.name,
      path: target,
      goal: input.goal,
      createdAt: new Date().toISOString(),
      ownerMemberId: member.id,
      repositoryName,
      competition: {
        name: input.competitionName,
        url: input.competitionUrl,
        deadline: input.deadline || null,
      },
    } satisfies Project);
    host.log(`Created ${repositoryName} for ${member.name}.`, null, member.id, 'project', id);
    host.mesh.post({
      projectId: id,
      authorId: member.id,
      kind: 'system',
      content: `${member.name} created ${input.name} for ${input.competitionName}. Conversations share this project's MESH group. GitHub repository name: ${repositoryName}. The remote repository has not been created or connected.`,
    });
    return project;
  } finally {
    locks.delete(repositoryName.toLowerCase());
  }
}
