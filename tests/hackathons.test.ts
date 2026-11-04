import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import { createHackathonProject, hackathonInput } from '../server/hackathons.ts';
import type { Workspace } from '../server/service.ts';
import type { Project } from '../shared/types.ts';

const input = {
  memberId: randomUUID(),
  name: 'Project',
  competitionName: 'Challenge',
  competitionUrl: 'https://example.org/challenge',
  goal: 'Build the project.',
};

test('hackathon deadline explicitly normalizes omission and null without inventing a date', () => {
  assert.equal(hackathonInput.parse(input).deadline, null);
  assert.equal(hackathonInput.parse({ ...input, deadline: null }).deadline, null);
  assert.equal(
    hackathonInput.parse({ ...input, deadline: '2027-08-14T18:45:00+07:00' }).deadline,
    '2027-08-14T11:45:00.000Z',
  );
  for (const deadline of ['', '2027-08-14', '2027-08-14T18:45:00', '2027-02-29T18:45:00Z'])
    assert.equal(hackathonInput.safeParse({ ...input, deadline }).success, false);
});

test('created repositories and stored project metadata preserve no deadline and the chosen instant', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-deadline-'));
  const store = new Store(':memory:');
  const previous = process.env.RELAY_PROJECTS_DIR;
  process.env.RELAY_PROJECTS_DIR = path.join(directory, 'projects');
  try {
    const dataDir = path.join(directory, 'private');
    await mkdir(dataDir);
    const member = store.addMember({ name: 'Deadline tester', role: 'researcher' });
    const host = {
      store,
      dataDir,
      log() {},
      autonomy: { join() {} },
      mesh: { post() {} },
    } as unknown as Workspace;
    for (const [name, deadline, expected] of [
      ['No date', undefined, null],
      ['Explicit none', null, null],
      ['Timed', '2027-08-14T18:45:00+07:00', '2027-08-14T11:45:00.000Z'],
    ] as const) {
      const project = await createHackathonProject(host, {
        ...input,
        memberId: member.id,
        name,
        ...(deadline === undefined ? {} : { deadline }),
      });
      assert.equal(store.get<Project>('project', project.id).competition?.deadline, expected);
      assert.ok(
        (await readFile(path.join(project.path, 'README.md'), 'utf8')).includes(
          `Deadline: ${expected ?? 'No deadline'}\n`,
        ),
      );
    }
  } finally {
    if (previous === undefined) delete process.env.RELAY_PROJECTS_DIR;
    else process.env.RELAY_PROJECTS_DIR = previous;
    store.close();
    if (
      path.dirname(directory) === os.tmpdir() &&
      path.basename(directory).startsWith('kivuno-deadline-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});

function convert(tz: string, fields: Record<string, string>) {
  const module = pathToFileURL(path.resolve('src/deadline.ts')).href;
  const script = `import { deadlineFromForm, deadlineToLocalInput } from ${JSON.stringify(module)};
    const values = ${JSON.stringify(fields)};
    try { const iso = deadlineFromForm({ get: key => values[key] ?? null });
      process.stdout.write(JSON.stringify({ iso, local: deadlineToLocalInput(iso) }));
    } catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); }`;
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('No deadline ignores stale hidden date values and serializes null', () => {
  assert.equal(
    convert('Asia/Ho_Chi_Minh', {
      deadlineMode: 'none',
      deadlineLocal: 'invalid',
      deadlineOriginal: '2027-08-14T18:45:00Z',
    }).iso,
    null,
  );
  assert.match(
    convert('UTC', { deadlineMode: 'scheduled', deadlineLocal: '' }).error,
    /valid deadline/,
  );
});

test('local deadline input converts in the user timezone and roundtrips without a UTC display shift', () => {
  assert.deepEqual(
    convert('Asia/Ho_Chi_Minh', { deadlineMode: 'scheduled', deadlineLocal: '2027-08-14T18:45' }),
    { iso: '2027-08-14T11:45:00.000Z', local: '2027-08-14T18:45:00' },
  );
  assert.deepEqual(
    convert('America/New_York', { deadlineMode: 'scheduled', deadlineLocal: '2027-01-15T18:45' }),
    { iso: '2027-01-15T23:45:00.000Z', local: '2027-01-15T18:45:00' },
  );
});

test('nonexistent daylight-saving times reject and unchanged repeated times retain the original instant', () => {
  assert.match(
    convert('America/New_York', { deadlineMode: 'scheduled', deadlineLocal: '2027-03-14T02:30' })
      .error,
    /does not exist/,
  );
  assert.equal(
    convert('America/New_York', {
      deadlineMode: 'scheduled',
      deadlineLocal: '2026-11-01T01:30',
      deadlineOriginal: '2026-11-01T06:30:00.123Z',
    }).iso,
    '2026-11-01T06:30:00.123Z',
  );
});
