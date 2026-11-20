import { z } from 'zod';
import type { MachineCommand } from './machine-checks.ts';
import { safeRunnerFile } from './runner-files.ts';

export const pairedTestFile = z
  .string()
  .min(1)
  .max(300)
  .refine((value) => {
    if (!/^[\p{L}\p{M}\p{N}_. -]+(?:\/[\p{L}\p{M}\p{N}_. -]+)*\.(?:[cm]?[jt]s)$/u.test(value))
      return false;
    if (value.split('/').some((part) => part.trim() !== part || part.startsWith('-'))) return false;
    try {
      return safeRunnerFile(value) === value;
    } catch {
      return false;
    }
  }, 'Choose one exact project-relative Node test file.');

export function pairedTestRecipe(file: string): MachineCommand {
  return {
    command: 'node',
    args: [
      '--permission',
      '--allow-fs-read=.',
      '--test',
      '--test-isolation=none',
      '--',
      pairedTestFile.parse(file),
    ],
    timeoutMs: 30_000,
  };
}
