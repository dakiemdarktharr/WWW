import path from 'node:path';
import { readdir, mkdir, writeFile, rename, lstat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { skillFiles } from './autonomy.ts';
import { privateDirectory } from './security.ts';
import { validateRunnerFiles, type RunnerFile } from './runner-files.ts';
export interface SharedSkill {
  name: string;
  files: RunnerFile[];
}
export async function exportSkills(home: string): Promise<SharedSkill[]> {
  const base = path.join(home, 'skills'),
    result: SharedSkill[] = [];
  let bytes = 0;
  for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      entry.name.startsWith('.') ||
      entry.name.startsWith('mesh-')
    )
      continue;
    try {
      const files = (await skillFiles(path.join(base, entry.name))).map((file) => ({
        path: file.name.split(path.sep).join('/'),
        data: file.content.toString('base64'),
        hash: createHash('sha256').update(file.content).digest('hex'),
      }));
      // Share complete prose-only skills. A skill requiring scripts remains an inventory
      // recommendation, rather than installing executable code as part of onboarding.
      if (files.some((file) => !/\.(?:md|txt)$/i.test(file.path))) continue;
      const size = files.reduce((sum, file) => sum + Buffer.byteLength(file.data), 0);
      if (bytes + size > 2_800_000 || result.length >= 32) break;
      result.push({ name: entry.name, files });
      bytes += size;
    } catch {
      /* Ineligible skills are not exported. */
    }
  }
  return result;
}
export async function installSkills(home: string, raw: unknown, machineImport = false) {
  if (!Array.isArray(raw) || raw.length > 32 || Buffer.byteLength(JSON.stringify(raw)) > 3_000_000)
    throw new Error('Invalid team skills payload.');
  const root = path.join(home, 'skills');
  await privateDirectory(home);
  await privateDirectory(root);
  const result: { name: string; digest: string; status: string }[] = [];
  for (const skill of raw) {
    if (!skill || typeof skill.name !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(skill.name))
      throw new Error('Invalid skill name.');
    const files = validateRunnerFiles(skill.files);
    if (!files.some((file) => file.path === 'SKILL.md')) throw new Error('Missing SKILL.md.');
    for (const file of files) {
      if (!machineImport && !/\.(?:md|txt)$/i.test(file.path))
        throw new Error('Executable skill content requires an explicit human import.');
      if (
        file.path
          .split('/')
          .some(
            (part) =>
              part.startsWith('.') || /token|secret|password|private.?key|config\.toml/i.test(part),
          )
      )
        throw new Error('Private skill files cannot be shared.');
      const content = Buffer.from(file.data, 'base64');
      if (
        content.includes(0) ||
        /\b(?:sk-|gh[opusr]_)[A-Za-z0-9_-]{10,}|-----BEGIN .*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(
          content.toString(),
        )
      )
        throw new Error('Skill may contain credentials.');
    }
    const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex'),
      prefix = `mesh-${skill.name}-`,
      name = machineImport ? skill.name : `${prefix}${digest.slice(0, 12)}`;
    const entries = await readdir(root);
    if (entries.some((entry) => entry === skill.name || entry.startsWith(prefix))) {
      result.push({ name: skill.name, digest, status: 'kept-existing' });
      continue;
    }
    const staging = path.join(root, `.incoming-${randomUUID()}`);
    await mkdir(staging, { mode: 0o700 });
    for (const file of files) {
      const target = path.join(staging, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(file.data, 'base64'), { mode: 0o600 });
    }
    // Verify exactly the bytes that will become executable skill material.
    await skillFiles(staging);
    if (
      await lstat(path.join(root, name))
        .then(() => true)
        .catch(() => false)
    )
      throw new Error('Skill destination changed.');
    await rename(staging, path.join(root, name));
    result.push({ name: skill.name, digest, status: 'installed' });
  }
  return result;
}
