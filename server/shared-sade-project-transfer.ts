import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  sadeProjectChunkBytes,
  sadeProjectFileMaxBytes,
  type SadeProjectArtifact,
} from '../shared/sade-project.ts';
import type { Task } from '../shared/types.ts';
import { git } from './git.ts';
import { resolveProviderPath } from './provider-files.ts';
import { DomainError, type Store } from './store.ts';

export type ProjectOutput = Omit<SadeProjectArtifact, 'id'>;
export const projectTransferAck = z.strictObject({
  jobId: z.uuid(),
  path: z.string().min(1).max(300),
  part: z.int().min(0).max(15),
});
export const projectInputChunk = z.strictObject({
  action: z.literal('project-input-chunk'),
  jobId: z.uuid(),
  fileId: z.string().regex(/^[a-f0-9]{64}$/),
  part: z.int().min(0).max(15),
  data: z
    .string()
    .min(1)
    .max(Math.ceil(sadeProjectChunkBytes / 3) * 4),
});
export const projectOutputChunk = projectTransferAck.extend({
  action: z.literal('project-output-chunk'),
});

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const parts = (bytes: number) => Math.ceil(bytes / sadeProjectChunkBytes);
const kind = 'sharedSadeProjectInputChunk';
const chunkId = (jobId: string, fileId: string, part: number) => jobId + ':' + fileId + ':' + part;
type Chunk = { id: string; data: string };

export function nextProjectInput(store: Store, jobId: string, inputs: SadeProjectArtifact[]) {
  for (const file of inputs)
    for (let part = 0; part < parts(file.bytes); part++)
      if (!store.lookup(kind, chunkId(jobId, file.id, part))) return { fileId: file.id, part };
}

export function saveProjectInput(
  store: Store,
  request: z.infer<typeof projectInputChunk>,
  file: SadeProjectArtifact,
) {
  const expected =
    request.part === parts(file.bytes) - 1
      ? file.bytes - request.part * sadeProjectChunkBytes
      : sadeProjectChunkBytes;
  const bytes = Buffer.from(request.data, 'base64');
  if (
    request.part >= parts(file.bytes) ||
    bytes.length !== expected ||
    bytes.toString('base64') !== request.data
  )
    throw new DomainError('Invalid input artifact chunk.', 400);
  const id = chunkId(request.jobId, file.id, request.part);
  const prior = store.lookup<Chunk>(kind, id);
  if (prior && prior.data !== request.data)
    throw new DomainError('Input artifact chunk changed.', 409);
  if (!prior) store.put(kind, { id, data: request.data });
}

export async function installProjectInputs(
  store: Store,
  jobId: string,
  worktree: string,
  inputs: SadeProjectArtifact[],
  current: () => void,
) {
  for (const file of inputs) {
    const data = Buffer.concat(
      Array.from({ length: parts(file.bytes) }, (_, part) =>
        Buffer.from(store.get<Chunk>(kind, chunkId(jobId, file.id, part)).data, 'base64'),
      ),
    );
    if (hash(data) !== file.sha256 || data.length !== file.bytes)
      throw new DomainError('A prerequisite file failed checksum verification.');
    const { target } = await resolveProviderPath(worktree, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    current();
    await writeFile(target, data);
  }
}

export function discardProjectInputs(store: Store, jobId: string, inputs: SadeProjectArtifact[]) {
  for (const file of inputs)
    for (let part = 0; part < parts(file.bytes); part++)
      store.remove(kind, chunkId(jobId, file.id, part));
}

export function nextProjectOutput(files: ProjectOutput[], offsets: Record<string, number>) {
  const file = files.find((entry) => (offsets[entry.path] || 0) < parts(entry.bytes));
  return file ? { ...file, part: offsets[file.path] || 0 } : undefined;
}

export async function outputsFromWorktree(
  task: Task,
  expected: string[],
  inputs: SadeProjectArtifact[],
  current: () => void,
) {
  const worktree = task.worktree!;
  const tracked = await git(worktree, [
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    task.baseCommit || 'HEAD',
  ]);
  const untracked = await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']);
  const inputsByPath = new Map(inputs.map((file) => [file.path, file]));
  for (const file of new Set((tracked + untracked).split('\0').filter(Boolean))) {
    if (expected.includes(file)) continue;
    const input = inputsByPath.get(file);
    const { target } = await resolveProviderPath(worktree, file);
    if (input && hash(await readFile(target)) === input.sha256) continue;
    // A compiler can use scratch files within owned output directories. Only declared files are exportable.
    if (!input && task.scope.some((scope) => scope !== '.' && file.startsWith(scope + '/')))
      continue;
    throw new DomainError('Changed file outside the assigned scope: ' + file + '.');
  }
  const result: ProjectOutput[] = [];
  for (const file of expected) {
    current();
    const { target } = await resolveProviderPath(worktree, file);
    const info = await lstat(target).catch(() => undefined);
    if (!info?.isFile() || !info.size || info.size > sadeProjectFileMaxBytes)
      throw new DomainError('Missing or oversized deliverable: ' + file + '.');
    const data = await readFile(target);
    if (data.length !== info.size)
      throw new DomainError('Deliverable file changed during verification.');
    result.push({ path: file, bytes: data.length, sha256: hash(data) });
  }
  current();
  return result;
}

export async function readProjectOutputChunk(worktree: string, file: ProjectOutput, part: number) {
  if (part >= parts(file.bytes)) throw new DomainError('Invalid deliverable part.', 400);
  const { target } = await resolveProviderPath(worktree, file.path);
  const offset = part * sadeProjectChunkBytes;
  const data = Buffer.alloc(Math.min(sadeProjectChunkBytes, file.bytes - offset));
  const handle = await open(target, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== file.bytes)
      throw new DomainError('Deliverable changed before transfer.');
    const { bytesRead } = await handle.read(data, 0, data.length, offset);
    if (bytesRead !== data.length) throw new DomainError('Incomplete local deliverable chunk.');
    return { data: data.toString('base64') };
  } finally {
    await handle.close();
  }
}
