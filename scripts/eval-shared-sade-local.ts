import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { sharedSadeCorpus } from '../tests/fixtures/shared-sade-corpus.ts';
import { challengePairs } from './sade-qwen-contrast.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '11565' },
    model: { type: 'string', default: 'qwen3:1.7b-q4_K_M' },
    limit: { type: 'string', default: '1000' },
    sample: { type: 'boolean', default: false },
    shard: { type: 'string', default: '0/1' },
    categories: { type: 'boolean', default: false },
    contrast: { type: 'boolean', default: false },
    'intent-prompt': { type: 'string', default: 'baseline' },
    output: { type: 'string', default: '.local/shared-sade-local-eval.jsonl' },
  },
});
const port = Number(values.port);
const limit = Number(values.limit);
const [shard, shardCount] = values.shard.split('/').map(Number);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Choose a valid local Ollama port.');
if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
  throw new Error('Choose a case count between 1 and 1000.');
if (!/^\d+\/[1-9]\d*$/.test(values.shard) || shard >= shardCount || shardCount > limit)
  throw new Error('Use a zero-based shard such as 0/5 with no more shards than cases.');
if (!/^qwen3:(?:1\.7b|4b(?:-instruct-2507)?)(?:-q4_K_M)?$/.test(values.model))
  throw new Error('Choose an installed local Qwen3 model.');
if (!['baseline', 'ordered'].includes(values['intent-prompt']))
  throw new Error('Choose baseline or ordered for the intent prompt.');
if ((values.contrast || values['intent-prompt'] === 'ordered') && !values.categories)
  throw new Error('Contrast cases and ordered intents use --categories.');

const outputSchema = z
  .object({
    mode: z.enum(['work', 'chat']),
    order: z.enum(['a-then-b', 'other']),
    sameScope: z.boolean(),
    review: z.boolean(),
    mac: z.boolean(),
  })
  .strict();
const system = `Classify the last human request written in Vietnamese or English. A = Bếp/Bep. B = Mây/May. Ignore decorative introductions, project names and subscription tier labels. If the sender explicitly says this is just conversation and no AI should take work, use chat even if a heading says orchestrate. Otherwise mark work for a request to do something. Set order=a-then-b only if B explicitly needs A's output or must wait for A. Set sameScope=true when the human explicitly asks to avoid overlapping edits, duplicate patches or both touching the same file. Set review=true when the sender asks another AI to inspect a code change, patch, correctness or regression before integration. Ordinary verification of an architecture handoff does not count as independent code review. Set mac=true when the sender requires macOS verification. Output only the five fields in the schema, using booleans for the last three. This classifies intent; it never grants access.`;
const categorySchema = z
  .object({ route: z.enum(['general', 'mac', 'handoff', 'review', 'scope', 'chat']) })
  .strict();
const categoryPrompt = `Classify the main intent of a short group chat request in Vietnamese (possibly unaccented) or English. Return one route:
general: work request with no type below
mac: requires validation on an actual Mac or macOS
handoff: one teammate needs the output of another to start
review: independent code or patch review, including before merging
scope: avoid editing the same files twice or assigning overlapping changes
chat: explicitly asks for no AI action
Ignore subscription names and boilerplate. A description of missing access, quota, or lost connection without another specific instruction is general.
Examples:
"Phúc viết schema rồi Linh lấy schema đó viết UI" → handoff.
"gop y ve diff cua Phuc truoc khi push" → review.
"Hai ben dang cung sua config, chi can mot nguoi sua" → scope.
"app lên Windows rồi, test qua Mac giúp tôi" → mac.
"Chưa nhờ ai làm đâu, chỉ hỏi thôi" → chat.
"Nhờ tìm log. Tắt lượt nếu bị thu hồi quyền" → general.`;
const orderedCategoryPrompt = `Classify the action requested now in a Vietnamese or English group chat. Ignore names, subscription labels and decorative headers. Select the first rule that applies:
1. chat when the sender is only updating or quoting, withdraws or delays the request, or asks people to respond while leaving the AI idle. Check the sender's actual request even if the message mentions committed code, review, or a Mac.
2. mac when the requested action must run on an actual Mac, macOS, or Apple Silicon.
3. review when the author asks someone to check an implementation or code change for correctness, regressions, or readiness to merge. A writer followed by an independent reviewer is review even though it contains two ordered steps.
4. scope when asked to prevent duplicate or overlapping edits. Reading an existing file, checking proposed requirements or agreeing on scope do not by themselves create overlapping edits.
5. handoff when someone's output or decision must be passed to another teammate for follow-on work, including checking a requirements document without a code change.
6. general for any other active request. Mentioning quota, access, or a connection problem by itself does not decide the work category.
Examples:
"Đã gửi bản sửa rồi, nói để cả nhóm biết thôi" → chat.
"Tạo dữ liệu mẫu xong cho người khác rà lỗi phần code đã sửa" → review.
"Chốt danh sách trường và chuyển nó cho người viết tài liệu" → handoff.
"Bản này có sẵn rồi, đừng để hai bên sửa lại cùng chỗ" → scope.`;
const prompt = values.categories
  ? values['intent-prompt'] === 'ordered'
    ? orderedCategoryPrompt
    : categoryPrompt
  : system;
const promptDigest = createHash('sha256').update(prompt).digest('hex');
const cases = values.contrast
  ? challengePairs.flatMap(([scenario, request, chat], index) => [
      { id: `contrast/${index + 1}/request`, message: request, style: 'request', scenario },
      { id: `contrast/${index + 1}/chat`, message: chat, style: 'chat', scenario: 'chat' },
    ])
  : sharedSadeCorpus();
const count = Math.min(limit, cases.length);
const stride = cases.length / count;
const windowSize = Math.floor(stride);
// Rotate within each sampling window so repeated style blocks do not mask source situations.
const selection = values.sample
  ? Array.from(
      { length: count },
      (_, index) => cases[Math.floor(index * stride) + (windowSize >= 5 ? index % windowSize : 0)],
    )
  : cases.slice(0, count);
if (shardCount > selection.length)
  throw new Error('The selected suite has fewer cases than shards.');
const selected = selection.slice(
  Math.floor((selection.length * shard) / shardCount),
  Math.floor((selection.length * (shard + 1)) / shardCount),
);
const filename = path.resolve(values.output);
await mkdir(path.dirname(filename), { recursive: true });
const existing = await readFile(filename, 'utf8').catch((error) => {
  if (error.code !== 'ENOENT') throw error;
  return '';
});
type Row = {
  id: string;
  model: string;
  style: string;
  expected: z.infer<typeof outputSchema>;
  result?: z.infer<typeof outputSchema>;
  milliseconds: number;
  pass: boolean;
  error?: string;
  promptDigest?: string;
  modelDigest?: string;
};
const results = new Map(
  existing
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line) as Row;
      if (row.model !== values.model)
        throw new Error('Use a separate output file for a different model.');
      if ((values.categories || row.promptDigest) && row.promptDigest !== promptDigest)
        throw new Error('Use a separate output file for a different prompt.');
      return [row.id, row];
    }),
);
const endpoint = `http://127.0.0.1:${port}`;
const installed = (await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5000) }).then(
  (response) => response.json(),
)) as { models: { name: string; digest: string }[] };
const model = installed.models.find((item) => item.name === values.model);
if (!model)
  throw new Error('Install the selected model in local Ollama before running this evaluation.');
if ([...results.values()].some((row) => row.modelDigest && row.modelDigest !== model.digest))
  throw new Error('Use a separate output file for a different model digest.');
console.log(
  JSON.stringify({ model, promptDigest, cases: selected.length, resumeFrom: results.size }),
);
let consecutiveErrors = 0;
for (const item of selected) {
  if (results.has(item.id)) continue;
  const expected: Row['expected'] = {
    mode: item.scenario === 'chat' ? 'chat' : 'work',
    order: item.scenario === 'handoff' ? 'a-then-b' : 'other',
    sameScope: item.scenario === 'scope',
    review: item.scenario === 'review',
    mac: ['mac', 'platform', 'no-platform'].includes(item.scenario),
  };
  const started = performance.now();
  const row: Row = {
    id: item.id,
    model: values.model,
    style: item.style,
    expected,
    milliseconds: 0,
    pass: false,
    modelDigest: model.digest,
    promptDigest,
  };
  try {
    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: values.model,
        stream: false,
        think: false,
        keep_alive: '10m',
        format: z.toJSONSchema(values.categories ? categorySchema : outputSchema),
        options: { temperature: 0, seed: 7013, num_ctx: 2048, num_predict: 96 },
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: item.message },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`Model endpoint returned ${response.status}`);
    const body = (await response.json()) as { message: { content: string } };
    const parsed = JSON.parse(body.message.content);
    if (values.categories) {
      const { route } = categorySchema.parse(parsed);
      row.result = {
        mode: route === 'chat' ? 'chat' : 'work',
        order: route === 'handoff' ? 'a-then-b' : 'other',
        sameScope: route === 'scope',
        review: route === 'review',
        mac: route === 'mac',
      };
    } else row.result = outputSchema.parse(parsed);
    row.pass = Object.entries(expected).every(
      ([field, value]) => row.result![field as keyof typeof expected] === value,
    );
    consecutiveErrors = 0;
  } catch (error) {
    row.error = error instanceof Error ? error.message.slice(0, 400) : 'Model evaluation failed.';
    consecutiveErrors++;
  }
  row.milliseconds = Math.round(performance.now() - started);
  results.set(item.id, row);
  await appendFile(filename, JSON.stringify(row) + '\n', 'utf8');
  if (results.size % 25 === 0)
    console.log(
      JSON.stringify({
        finished: results.size,
        exact: [...results.values()].filter((value) => value.pass).length,
      }),
    );
  if (consecutiveErrors >= 3)
    throw new Error('Three consecutive model errors. Inspect the local runtime before resuming.');
}
const rows = selected.map((item) => results.get(item.id)!);
const durations = rows.map((row) => row.milliseconds).sort((a, b) => a - b);
console.log(
  JSON.stringify({
    total: rows.length,
    exact: rows.filter((row) => row.pass).length,
    errors: rows.filter((row) => row.error).length,
    byStyle: Object.fromEntries(
      [...new Set(rows.map((row) => row.style))].map((style) => {
        const written = rows.filter((row) => row.style === style);
        return [style, { total: written.length, exact: written.filter((row) => row.pass).length }];
      }),
    ),
    fields: Object.fromEntries(
      Object.keys(outputSchema.shape).map((key) => [
        key,
        rows.filter(
          (row) =>
            row.result?.[key as keyof Row['expected']] ===
            row.expected[key as keyof Row['expected']],
        ).length,
      ]),
    ),
    p50Ms: durations[Math.floor(durations.length * 0.5)],
    p95Ms: durations[Math.floor(durations.length * 0.95)],
  }),
);
