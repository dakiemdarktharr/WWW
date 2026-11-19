import path from 'node:path';
import { lstat, readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { git } from './git.ts';
import { inside, normalizeScope, scopesOverlap } from './security.ts';
import { DomainError } from './store.ts';
import { isPrivateCredentialPath } from './checkpoint.ts';

export interface RunnerFile {
  path: string;
  data: string;
  hash: string;
}
type SnapshotLimits = { file: number; total: number; scanCredentials?: boolean };
const inlineLimits: SnapshotLimits = { file: 512 * 1024, total: 2 * 1024 * 1024 };
export const machineSnapshotLimits: SnapshotLimits = {
  file: 4 * 1024 * 1024,
  total: 8 * 1024 * 1024,
  scanCredentials: true,
};
export const machineChunkBytes = 768 * 1024;
export const machinePacketBytes = 16 * 1024 * 1024;
export const machineSnapshotProtocol = 'snapshot-chunks/1';
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function checkCredentials(data: Buffer) {
  if (
    /\b(?:sk-|gh[opusr]_)[A-Za-z0-9_-]{10,}|-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/.test(
      data.toString(),
    )
  )
    throw new DomainError(
      'Repository snapshot may contain credentials. Remove secrets before remote execution.',
    );
}
export function snapshotDigest(files: RunnerFile[]) {
  return digest(Buffer.from(JSON.stringify(files.map(({ path, hash }) => [path, hash]))));
}
function safeFile(name: string) {
  if (
    isPrivateCredentialPath(name) ||
    name.includes('\\') ||
    name.startsWith('/') ||
    name
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '..' ||
          part === '.' ||
          /^(?:\.git|\.relay|\.env(?:\..*)?|\.ssh|\.aws|\.npmrc|\.pypirc|auth\.json|credentials.*|.*\.pem|.*\.key)$/i.test(
            part,
          ),
      )
  )
    throw new DomainError('Private or invalid runner file path.');
  normalizeScope(name);
  return name;
}
async function regularParents(root: string, name: string) {
  const base = path.resolve(root);
  let current = path.resolve(root, name);
  if (!inside(base, current)) throw new DomainError('Runner path escaped repository.');
  while (true) {
    const info = await lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink()) throw new DomainError('Runner path contains a symbolic link.');
    if (current === base) break;
    current = path.dirname(current);
  }
}
export async function exportRunnerFiles(
  root: string,
  limits = inlineLimits,
): Promise<RunnerFile[]> {
  const names = (await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean);
  let bytes = 0;
  const output: RunnerFile[] = [];
  for (const name of [...new Set(names)].sort()) {
    try {
      safeFile(name);
    } catch {
      continue;
    }
    const location = path.resolve(root, name);
    if (!inside(root, location)) throw new DomainError('Runner path escaped repository.');
    await regularParents(root, name);
    const stat = await lstat(location).catch(() => null);
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new DomainError('Remote execution requires regular repository files.');
    if (stat.size > limits.file)
      throw new DomainError(
        `A runner source file exceeds ${limits.file / 1024} KiB. Keep large data in its existing storage.`,
      );
    const data = await readFile(location);
    bytes += data.length;
    checkCredentials(data);
    if (bytes > limits.total || output.length >= 2000)
      throw new DomainError(
        `Remote source snapshot exceeds ${limits.total / 1024 ** 2} MiB or 2,000 files.`,
      );
    output.push({ path: name, data: data.toString('base64'), hash: digest(data) });
  }
  return output;
}
export function validateRunnerFiles(raw: unknown, limits = inlineLimits): RunnerFile[] {
  if (!Array.isArray(raw) || raw.length > 2000) throw new DomainError('Invalid runner snapshot.');
  let bytes = 0;
  const names = new Set<string>();
  return raw.map((file) => {
    if (
      !file ||
      typeof file.path !== 'string' ||
      typeof file.data !== 'string' ||
      typeof file.hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.hash)
    )
      throw new DomainError('Invalid runner file.');
    safeFile(file.path);
    const key = file.path.toLowerCase();
    if (names.has(key)) throw new DomainError('Duplicate runner path.');
    names.add(key);
    const data = Buffer.from(file.data, 'base64');
    bytes += data.length;
    if (
      data.length > limits.file ||
      bytes > limits.total ||
      data.toString('base64') !== file.data ||
      digest(data) !== file.hash
    )
      throw new DomainError('Runner snapshot integrity check failed.');
    if (limits.scanCredentials) checkCredentials(data);
    return { path: file.path, data: file.data, hash: file.hash };
  });
}
export async function applyRunnerFiles(
  root: string,
  before: RunnerFile[],
  after: RunnerFile[],
  scopes: string[],
  guard: () => void,
  limits = inlineLimits,
) {
  validateRunnerFiles(after, limits);
  const initial = new Map(before.map((file) => [file.path, file]));
  const final = new Map(after.map((file) => [file.path, file]));
  const changes = [...new Set([...initial.keys(), ...final.keys()])].filter(
    (name) => initial.get(name)?.hash !== final.get(name)?.hash,
  );
  for (const name of changes) {
    safeFile(name);
    if (!scopesOverlap([name], scopes))
      throw new DomainError(`Remote change outside its owned scope: ${name}`);
    await regularParents(root, name);
    const actual = await readFile(path.join(root, name)).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if ((actual ? digest(actual) : undefined) !== initial.get(name)?.hash)
      throw new DomainError(
        'Repository changed while the remote turn ran. Inspect before recovery.',
      );
  }
  for (const name of changes) {
    guard();
    const target = path.join(root, name),
      file = final.get(name);
    if (file) {
      await mkdir(path.dirname(target), { recursive: true });
      guard();
      await writeFile(target, Buffer.from(file.data, 'base64'));
    } else await unlink(target);
  }
}
