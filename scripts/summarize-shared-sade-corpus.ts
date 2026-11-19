import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { sharedSadeCorpus } from '../tests/fixtures/shared-sade-corpus.ts';

type Intent = {
  mode: 'work' | 'chat';
  order: 'a-then-b' | 'other';
  sameScope: boolean;
  review: boolean;
  mac: boolean;
};
type Result = {
  id: string;
  model: string;
  modelDigest: string;
  promptDigest: string;
  milliseconds: number;
  pass: boolean;
  expected: Intent;
  result?: Intent;
  error?: string;
};

const folder = process.argv[2];
assert.ok(folder, 'Pass the directory containing the downloaded corpus artifacts.');
const inputs = (await readdir(folder, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && /^corpus-\d+\.jsonl$/.test(entry.name))
  .map((entry) => path.join(entry.parentPath, entry.name));
const corpus = new Map(sharedSadeCorpus().map((item) => [item.id, item]));
const rows: Result[] = (await Promise.all(inputs.map((file) => readFile(file, 'utf8')))).flatMap(
  (content) =>
    content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
);
assert.equal(rows.length, corpus.size, 'The artifacts must cover the entire corpus.');
assert.equal(new Set(rows.map((row) => row.id)).size, corpus.size, 'Duplicate message IDs.');
const [sample] = rows;
assert.ok(
  sample.modelDigest &&
    sample.promptDigest &&
    rows.every(
      ({ model, modelDigest, promptDigest }) =>
        model === sample.model &&
        modelDigest === sample.modelDigest &&
        promptDigest === sample.promptDigest,
    ),
  'All rows must use the same model and prompt.',
);

function route(intent?: Intent) {
  if (!intent) return 'error';
  if (intent.mode === 'chat') return 'chat';
  if (intent.order === 'a-then-b') return 'handoff';
  if (intent.sameScope) return 'scope';
  if (intent.review) return 'review';
  if (intent.mac) return 'mac';
  return 'general';
}

type Counts = Record<string, { total: number; passed: number }>;
const byStyle: Counts = {};
const byScenario: Counts = {};
const byTeam: Counts = {};
const confusion: Record<string, Record<string, number>> = {};
for (const row of rows) {
  const item = corpus.get(row.id);
  assert.ok(item, `Unknown case ${row.id}.`);
  const expected = route(row.expected);
  const fixtureRoute = ['platform', 'no-platform'].includes(item.scenario)
    ? 'mac'
    : ['chat', 'handoff', 'review', 'scope'].includes(item.scenario)
      ? item.scenario
      : 'general';
  assert.equal(expected, fixtureRoute, `Unexpected label for ${row.id}.`);
  const observed = route(row.result);
  assert.equal(row.pass, expected === observed, `Inconsistent score for ${row.id}.`);
  const team = item.providers
    .map((provider, index) => `${provider} / ${item.subscriptions[index]}`)
    .join(' → ');
  const groups: [Counts, string][] = [
    [byStyle, item.style],
    [byScenario, item.scenario],
    [byTeam, team],
  ];
  for (const [counts, key] of groups) {
    const group = (counts[key] ??= { total: 0, passed: 0 });
    group.total++;
    group.passed += Number(row.pass);
  }
  const predictions = (confusion[expected] ??= {});
  predictions[observed] = (predictions[observed] ?? 0) + 1;
}

const durations = rows.map(({ milliseconds }) => milliseconds).sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      model: sample.model,
      modelDigest: sample.modelDigest,
      promptDigest: sample.promptDigest,
      total: rows.length,
      passed: rows.filter(({ pass }) => pass).length,
      errors: rows.filter(({ error }) => error).length,
      p50Ms: durations[Math.floor(durations.length * 0.5)],
      p95Ms: durations[Math.floor(durations.length * 0.95)],
      byStyle,
      byScenario,
      byTeam,
      confusion,
    },
    null,
    2,
  ),
);
