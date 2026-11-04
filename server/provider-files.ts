import path from 'node:path';
import { lstat, realpath, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { inside, normalizeScope } from './security.ts';
import { DomainError } from './store.ts';
import type { DynamicTool } from './codex.ts';
import { isPrivateCredentialPath } from './checkpoint.ts';

export const providerFileTools: DynamicTool[] = [
  {
    type: 'function',
    name: 'workspace_list_files',
    description: 'List up to 200 paths inside the assigned workspace. No shell execution.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'workspace_read_file',
    description:
      'Read a bounded text file in the project. Credential files and .git are forbidden.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'workspace_write_file',
    description:
      'Write a text file inside owned scopes after explicit human approval. Unavailable in read-only conversations.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string', maxLength: 100000 } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
];
export async function providerFileTool(
  name: string,
  args: any,
  policy: { cwd: string; readOnly: boolean; scopes: string[] },
  assertCurrent: () => void,
) {
  assertCurrent();
  if (!providerFileTools.some((tool) => tool.name === name))
    throw new DomainError('Unknown file tool.');
  const relative = normalizeScope(typeof args.path === 'string' ? args.path : '.');
  if (relative !== '.' && relative.split('/').some((part) => /[. ]$/.test(part)))
    throw new DomainError(
      'Ambiguous file names with trailing dots or spaces are not supported.',
      403,
    );
  if (
    relative.split('/').some((part) => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
  )
    throw new DomainError('Device paths are not supported.', 403);
  if (
    isPrivateCredentialPath(relative) ||
    relative
      .split('/')
      .some((part) =>
        /^\.(?:git|codex|gemini|claude)$|^\.env(?:\.|$)|^auth\.json$|^oauth_creds\.json$|^\.?credentials|private.?key|secret|token/i.test(
          part,
        ),
      )
  )
    throw new DomainError('Private files cannot be accessed through this tool.', 403);
  const root = await realpath(policy.cwd),
    target = path.resolve(root, relative);
  if (!inside(root, target)) throw new DomainError('File is outside the workspace.', 403);
  let cursor = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink()) throw new DomainError('Linked paths are not allowed.', 403);
  }
  assertCurrent();
  if (name === 'workspace_list_files') {
    const entries = await readdir(target, { withFileTypes: true });
    return {
      paths: entries
        .filter((entry) => !entry.isSymbolicLink() && !entry.name.startsWith('.'))
        .slice(0, 200)
        .map((entry) => ({
          path: path.posix.join(relative, entry.name),
          directory: entry.isDirectory(),
        })),
    };
  }
  if (name === 'workspace_read_file') {
    const info = await lstat(target);
    if (!info.isFile()) throw new DomainError('Read only regular files.');
    if (info.size > 100_000) throw new DomainError('Read a file smaller than 100 KB.');
    return { content: await readFile(target, 'utf8') };
  }
  if (policy.readOnly) throw new DomainError('This conversation is read-only.', 403);
  if (
    !policy.scopes.some((scope) => {
      const owned = normalizeScope(scope);
      return owned === '.' || relative === owned || relative.startsWith(`${owned}/`);
    })
  )
    throw new DomainError('This file is outside the task’s owned scopes.', 403);
  if (
    typeof args.content !== 'string' ||
    Buffer.byteLength(args.content) > 100_000 ||
    args.content.includes('\0')
  )
    throw new DomainError('Write at most 100 KB of text.');
  await mkdir(path.dirname(target), { recursive: true });
  assertCurrent();
  const previous = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (previous && !previous.isFile()) throw new DomainError('Write only regular files.');
  assertCurrent();
  await writeFile(target, args.content, { encoding: 'utf8', flag: 'w' });
  return { path: relative, bytes: Buffer.byteLength(args.content) };
}
