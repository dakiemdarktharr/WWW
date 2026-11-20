import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, lstat, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);
export const privateKeyHeader = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/;
export const secret = () => randomBytes(32).toString('hex');
export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function redact(input: unknown): string {
  return String(input ?? '')
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[opsu]_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
      '[REDACTED]',
    )
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|password|secret)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi,
      '$1[REDACTED]',
    )
    .slice(0, 20000);
}
export function safeDetails(input: unknown): unknown {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') return redact(input);
  if (Array.isArray(input)) return input.slice(0, 100).map(safeDetails);
  if (typeof input === 'object')
    return Object.fromEntries(
      Object.entries(input)
        .slice(0, 100)
        .map(([key, value]) => [
          key,
          /token|secret|password|authorization|api.?key/i.test(key)
            ? '[REDACTED]'
            : safeDetails(value),
        ]),
    );
  return input;
}
export function normalizeScope(value: string): string {
  const scope = value.trim().replaceAll('\\', '/').replace(/\/+$/, '');
  if (!scope || scope === '.' || scope === '*') return '.';
  if (
    scope.startsWith('/') ||
    scope.includes(':') ||
    /[\x00-\x1f*?\[\]]/.test(scope) ||
    scope.split('/').some((p) => !p || p === '..' || p === '.' || /^\.(?:git|relay)$/i.test(p))
  ) {
    throw new Error(
      'Scope must be a relative file or directory, without wildcards, .., .git or .relay. Use . for the whole project.',
    );
  }
  return scope;
}
export function scopesOverlap(a: string[], b: string[]): boolean {
  return a.some((x) =>
    b.some((y) => {
      const aa = x.toLowerCase(),
        bb = y.toLowerCase();
      return (
        aa === '.' || bb === '.' || aa === bb || aa.startsWith(bb + '/') || bb.startsWith(aa + '/')
      );
    }),
  );
}
export function inside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}
export async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error('Private storage must not be a symbolic link.');
  if (process.platform === 'win32') {
    const { stdout } = await exec('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      windowsHide: true,
    });
    const sid = stdout.match(/S-1-5-\d+(?:-\d+)+/)?.[0];
    if (!sid)
      throw new Error('Cannot determine the Windows user for credential directory permissions.');
    await exec(
      'icacls.exe',
      [await realpath(directory), '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`],
      { windowsHide: true },
    );
  } else await chmod(directory, 0o700);
}
