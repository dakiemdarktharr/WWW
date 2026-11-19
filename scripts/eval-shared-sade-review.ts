import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { SharedGroups } from '../server/collaboration.ts';
import { groupReviewTool, sharedFinish, type SharedDelivery } from '../server/group-sade.ts';
import { reviewDigest } from '../server/sade.ts';
import { sharedGroupReviewPrompt } from '../server/shared-sade-worker.ts';
import { Store } from '../server/store.ts';
import type { SharedSadeRun } from '../shared/collaboration.ts';
import type { TaskDiff } from '../shared/types.ts';

// Only these fixed, synthetic function bodies are executed for the oracle.
// Model responses are parsed as verdict data and never executed.
const examples = [
  {
    id: 'capacity',
    file: 'src/capacity.js',
    params: 'capacity, booked',
    args: [10, 6],
    expected: 4,
    spec: 'Report available seats as capacity minus booked seats, never below zero.',
    clean: 'Math.max(0, capacity - booked)',
    defect: 'Math.max(0, capacity - booked - 1)',
    evidence: /off.by.one|subtract.+(one|1)|capacity.+booked.+-\s*1/i,
  },
  {
    id: 'refund',
    file: 'src/refund.js',
    params: 'requested, cutoff',
    args: [20, 20],
    expected: true,
    spec: 'A refund is allowed at or before the cutoff, including the exact cutoff.',
    clean: 'requested <= cutoff',
    defect: 'requested < cutoff',
    evidence: /equal|inclus|exact|<=|boundary/i,
  },
  {
    id: 'pagination',
    file: 'src/pagination.js',
    params: 'page, size',
    args: [0, 10],
    expected: 0,
    spec: 'Use zero-based page numbers. Page 0 begins at offset 0.',
    clean: 'page * size',
    defect: '(page + 1) * size',
    evidence: /off.by.one|zero.based|first page|page 0|page\s*\+\s*1/i,
  },
  {
    id: 'discount',
    file: 'src/discount.js',
    params: 'spend, minimum',
    args: [100, 100],
    expected: 10,
    spec: 'Return a ten percent discount rate when spend meets or exceeds the minimum.',
    clean: 'spend >= minimum ? 10 : 0',
    defect: 'spend > minimum ? 10 : 0',
    evidence: /equal|inclus|meet|>=|minimum|threshold/i,
  },
  {
    id: 'rounding',
    file: 'src/rounding.js',
    params: 'distance',
    args: [-1.9],
    expected: -1,
    spec: 'Drop the fractional part toward zero, including for negative values.',
    clean: 'Math.trunc(distance)',
    defect: 'Math.floor(distance)',
    evidence: /negative|floor|toward zero|trunc/i,
  },
  {
    id: 'label',
    file: 'src/label.js',
    params: 'value',
    args: ['  item  '],
    expected: 'item',
    spec: 'Remove whitespace at both ends while preserving interior whitespace.',
    clean: 'value.trim()',
    defect: 'value.trimStart()',
    evidence: /end|trail|trimstart|right|both/i,
  },
] as const;

const endpoint = 'http://127.0.0.1:11565';
const model = 'qwen3:4b-instruct-2507-q4_K_M';
const output = path.resolve(process.argv[2] || '.local/shared-sade-review.json');
const { type, name, description, inputSchema } = groupReviewTool;
const tools = [{ type, function: { name, description, parameters: inputSchema } }];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const local = (route: string, options: RequestInit = {}) => fetch(`${endpoint}${route}`, options);
const installed = (await (await local('/api/tags', { signal: AbortSignal.timeout(5000) })).json())
  .models;
const selected = installed.find((entry: { name: string }) => entry.name === model);
assert.ok(selected, 'Install Qwen in the local Ollama directory.');

async function evaluate(example: (typeof examples)[number], version: 'clean' | 'defect') {
  const oracle = runInNewContext(
    `((${example.params}) => ${example[version]})(...args)`,
    { args: example.args },
    { timeout: 1000 },
  );
  assert.equal(
    oracle === example.expected,
    version === 'clean',
    `Oracle mismatch for ${example.id}`,
  );
  const body = `export function calculate(${example.params}) {\n  return ${example[version]};\n}`;
  const file = example.file;
  const diff: TaskDiff = {
    files: [file],
    diff: `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,3 @@\n${body
      .split('\n')
      .map((line) => `+${line}`)
      .join('\n')}\n`,
    stat: '1 file changed',
    truncated: false,
  };
  const store = new Store(':memory:');
  try {
    const owners = [
      { id: 'author', name: 'An' },
      { id: 'reviewer', name: 'Bình' },
    ];
    const groups = new SharedGroups(store, (id) => owners.find((owner) => owner.id === id) || null);
    const ids = [randomUUID(), randomUUID()];
    const grants = [randomUUID(), randomUUID()];
    const groupId = randomUUID();
    const projectKey = 'a'.repeat(64);
    const call = (index: number, request: object) =>
      groups.execute(owners[index], request, ids[index]);
    for (const [index, id] of ids.entries())
      store.put('desktopDevice', {
        id,
        owner: owners[index],
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        revoked: false,
        tokenHash: 'fixture-private-token-hash',
      });
    call(0, { action: 'create', id: groupId, name: 'Review quality fixture' });
    call(0, { action: 'invite', groupId, account: owners[1].id });
    call(1, { action: 'accept', groupId });
    for (const [index, grant] of grants.entries()) {
      const localId = randomUUID();
      call(index, {
        action: 'teammates',
        groupId,
        teammates: [{ localId, provider: index ? 'codex' : 'gemini', name: owners[index].name }],
      });
      call(index, {
        action: 'sade-grant',
        id: grant,
        groupId,
        projectKey,
        teammateId: localId,
        projectName: 'Review fixture',
        platform: 'win32',
        role: index ? 'reviewer' : 'engineer',
        allowWrites: !index,
        turns: index ? 1 : 2,
      });
    }
    const poll = (index: number, active: string[] = []) =>
      call(index, { action: 'sade-poll', grants: [grants[index]], active }) as {
        delivery?: SharedDelivery;
        reviews: { jobId: string; digest: string }[];
      };
    const finish = (index: number, id: string, result: object) =>
      call(index, { action: 'sade-finish', jobId: id, result });
    const state = () =>
      (call(0, { action: 'read', groupId }) as { sadeRuns: SharedSadeRun[] }).sadeRuns[0].state;
    call(0, {
      action: 'message',
      groupId,
      id: randomUUID(),
      content: `Implement the requested behavior in ${file}.`,
      sade: { projectKey },
    });
    const planner = poll(0).delivery!;
    finish(0, planner.id, {
      kind: 'plan',
      plan: {
        summary: 'Implement and verify the requested project behavior.',
        tasks: [
          {
            key: 'implement',
            title: `Implement ${example.id}`,
            kind: 'code',
            scope: [file],
            description: `Implement the requested behavior in ${file}.`,
            acceptance: example.spec,
            effort: 1,
            stage: 'implementation',
            dependsOn: [],
            preferredMemberId: grants[0],
          },
        ],
      },
    });
    const writer = poll(0).delivery!;
    const integrate = () =>
      finish(0, writer.id, {
        kind: 'done',
        revision: 'b'.repeat(40),
        summary: 'Simulated local integration after approval.',
      });
    finish(0, writer.id, { kind: 'change', diff, summary: 'Synthetic change ready for review.' });
    assert.throws(integrate, /independent review/);
    const review = poll(1).delivery!;
    assert.equal(review.grantId, grants[1]);
    assert.equal(review.phase, 'review');
    assert.deepEqual(review.review, diff);
    const prompt = sharedGroupReviewPrompt(review);
    assert.doesNotMatch(prompt, /fixture-private-token-hash/);
    const started = performance.now();
    let verdict: string | undefined;
    let summary: string | undefined;
    let error: string | undefined;
    let gate = false;
    try {
      const response = await local('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          tools,
          stream: false,
          think: false,
          keep_alive: '45s',
          messages: [{ role: 'user', content: prompt }],
          options: { temperature: 0, seed: 7013, num_ctx: 4096, num_predict: 520 },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
      const { message } = await response.json();
      assert.equal(message.tool_calls?.length, 1, 'expected one review tool call');
      const tool = message.tool_calls[0].function;
      assert.equal(tool.name, groupReviewTool.name);
      const result = sharedFinish.parse({ ...tool.arguments, kind: 'review' });
      assert.ok(result.kind === 'review');
      verdict = result.verdict;
      summary = result.summary;
      assert.throws(() => finish(0, review.id, result), /grant/);
      finish(1, review.id, result);
      if (verdict === 'changes') {
        assert.equal(state(), 'blocked');
        assert.throws(integrate, /no longer running/);
      } else {
        assert.deepEqual(poll(0, [writer.id]).reviews, [
          { jobId: writer.id, digest: reviewDigest(diff) },
        ]);
        integrate();
        assert.equal(state(), 'done');
      }
      assert.equal(poll(1).delivery, undefined);
      gate = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    return {
      id: example.id,
      version,
      verdict,
      summary,
      gate,
      error,
      correct: verdict === (version === 'clean' ? 'approved' : 'changes'),
      grounded:
        version === 'defect' && verdict === 'changes' && example.evidence.test(summary || ''),
      promptSha256: hash(prompt),
      diffDigest: reviewDigest(diff),
      milliseconds: Math.round(performance.now() - started),
    };
  } finally {
    store.close();
  }
}

await mkdir(path.dirname(output), { recursive: true });
const rows = [];
for (const example of examples) {
  for (const version of ['clean', 'defect'] as const) {
    const row = await evaluate(example, version);
    rows.push(row);
    console.log(
      JSON.stringify({
        id: row.id,
        version,
        verdict: row.verdict,
        correct: row.correct,
        gate: row.gate,
        error: row.error,
      }),
    );
  }
}
await writeFile(
  output,
  JSON.stringify(
    { model, digest: selected.digest, toolsSha256: hash(JSON.stringify(tools)), rows },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    total: rows.length,
    correct: rows.filter((row) => row.correct).length,
    grounded: rows.filter((row) => row.grounded).length,
    gate: rows.filter((row) => row.gate).length,
    missedDefects: rows.filter((row) => row.version === 'defect' && row.verdict === 'approved')
      .length,
    wrongChanges: rows.filter((row) => row.version === 'clean' && row.verdict === 'changes').length,
  }),
);
