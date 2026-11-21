import { stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function resolveManagedCommand(provider: 'claude' | 'antigravity') {
  const name = provider === 'claude' ? 'claude' : 'agy';
  const override = process.env[`RELAY_${provider.toUpperCase()}_COMMAND`];
  const candidates = override
    ? [override]
    : [
        path.join(
          os.homedir(),
          '.local',
          'bin',
          name + (process.platform === 'win32' ? '.exe' : ''),
        ),
        ...(provider === 'antigravity' && process.platform === 'win32'
          ? [
              path.join(
                process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
                'agy',
                'bin',
                'agy.exe',
              ),
            ]
          : []),
        ...(provider === 'claude' && process.platform !== 'win32'
          ? [path.join(os.homedir(), '.claude', 'local', 'claude')]
          : []),
        ...(process.env.PATH || process.env.Path || '')
          .split(path.delimiter)
          .filter(Boolean)
          .map((dir) =>
            path.join(
              dir.replace(/^"|"$/g, ''),
              name + (process.platform === 'win32' ? '.exe' : ''),
            ),
          ),
      ];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || /\.(?:cmd|bat|ps1)$/i.test(candidate)) continue;
    if (
      await stat(candidate).then(
        (info) => info.isFile(),
        () => false,
      )
    )
      return candidate;
  }
  throw new Error(`Install the official ${name} CLI on this computer first.`);
}
