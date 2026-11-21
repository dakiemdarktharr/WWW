import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { generateSadeDeck } from '../cloud/sade-deck.ts';
import { isSadeDeckRequest } from '../shared/sade-deck.ts';
import { SadeDecks } from '../server/sade-decks.ts';
import { Store } from '../server/store.ts';

const request = 'Tạo giúp mình file PPT về số liệu tuyển sinh năm qua';

test('PowerPoint intent allows direct creation and leaves deferrals and papers to their workflows', () => {
  for (const message of [
    request,
    '@Sade soạn bộ slide cho buổi họp tuần tới',
    'Put together a pitch deck for our campus cafe',
    'Give me a PowerPoint on fieldwork safety',
    'Tạo file ppt giới thiệu bài nghiên cứu này',
  ])
    assert.equal(isSadeDeckRequest(message), true, message);
  for (const message of [
    'Khoan làm slide về đợt tuyển sinh nhé',
    'How can I create slides with speaker notes?',
    'Hãy viết paper về loài chim ở đảo rồi làm slides',
    'Please archive the current PowerPoint',
  ])
    assert.equal(isSadeDeckRequest(message), false, message);
});

test('PowerPoint job leases deduplicate retries, isolate owners, and reject stale or corrupt output', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  let now = Date.parse('2026-11-21T08:00:00Z');
  const service = new SadeDecks(store, () => now);
  const id = randomUUID();
  const original = { action: 'start', id, prompt: request };
  const read = () => {
    const result = service.execute('owner', { action: 'read', id });
    assert('deck' in result);
    return result;
  };
  const start = service.execute('owner', original);
  assert('work' in start && start.work);
  const same = service.execute('owner', original);
  assert('deck' in same && !same.work);
  const duplicate = service.execute('owner', { ...original, id: randomUUID() });
  assert('deck' in duplicate && duplicate.deck.id === id);
  assert.deepEqual(service.execute('another-owner', { action: 'list' }), { decks: [] });
  assert.throws(() => service.execute('another-owner', { action: 'download', id }), {
    status: 404,
  });
  assert.equal(
    service.finish({ id, lease: start.work.lease, result: { status: 'authoring' } }).accepted,
    true,
  );
  assert.equal(read().deck.state, 'authoring');
  assert.equal(
    service.finish({ id, lease: start.work.lease, result: { status: 'retry' } }).accepted,
    true,
  );
  assert.equal(read().deck.state, 'retrying');
  now += 3000;
  const retry = read();
  assert(retry.work);
  assert.notEqual(retry.work.lease, start.work.lease);
  assert.equal(
    service.finish({ id, lease: start.work.lease, result: { status: 'retry' } }).accepted,
    false,
  );
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const result = {
    status: 'ready',
    title: 'Tuyển sinh',
    data: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sources: [
      { title: 'Source A', url: 'https://example.test/source-a' },
      { title: 'Source B', url: 'https://example.test/source-b' },
    ],
    worker: { provider: 'codex', sessionId: 'sess_deckfixture0001', report: 'Đã xuất PowerPoint.' },
  };
  assert.throws(
    () =>
      service.finish({
        id,
        lease: retry.work!.lease,
        result: { ...result, sha256: '0'.repeat(64) },
      }),
    { status: 400 },
  );
  assert.equal(service.finish({ id, lease: retry.work.lease, result }).accepted, true);
  assert.equal(read().deck.worker?.sessionId, result.worker.sessionId);
  const downloaded = service.execute('owner', { action: 'download', id });
  assert('data' in downloaded);
  assert.equal(downloaded.data, result.data);
});

test('a PowerPoint is delivered only after its assigned Codex session calls export and completes', async () => {
  const sources = ['https://example.test/annual', 'https://example.test/quarter'];
  const brief = {
    scope: 'Campus cafe in 2026',
    findings: [
      { fact: 'The cafe opened in March.', references: [1] },
      { fact: 'It served 350 students in Q3.', references: [2] },
      { fact: 'Orders were collected at two counters.', references: [1, 2] },
    ],
    sources: sources.map((url, index) => ({ url, title: 'Campus report ' + index })),
  };
  const title = 'Campus cafe in 2026';
  const args = {
    title,
    slides: ['Scope', 'Throughput', 'Operations'].map((label) => ({
      title: label,
      bullets: [
        { text: 'The cafe opened in March.', evidence: [1] },
        { text: 'It served 350 students in Q3.', evidence: [2] },
      ],
    })),
  };
  const sessionId = 'sess_deckfixture0001';
  const turn = 'turn_deckfixture0001';
  const call = 'exec_deckfixture0001';
  const calls: string[] = [];
  const duplicateCall = 'exec_deckfixture0002';
  let exported = 0;
  let audits = 0;
  const transport: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push((init?.method || 'GET') + ' ' + path);
    const body = init?.body && JSON.parse(String(init.body));
    if (path === '/v1/responses') {
      const searching = Boolean(body.tools);
      if (!searching) audits++;
      return Response.json({
        model: 'gpt-6-luna',
        status: 'completed',
        error: null,
        incomplete_details: null,
        usage: null,
        output: [
          ...(searching
            ? [{ type: 'web_search_call', action: { sources: sources.map((url) => ({ url })) } }]
            : []),
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: JSON.stringify(searching ? brief : { accepted: true }) },
            ],
          },
        ],
      });
    }
    if (path.endsWith('/events')) {
      assert.equal(body.events[0].type, 'agent.session.input.tool_result');
      assert.equal(body.events[0].turn_id, turn);
      assert.equal(body.events[0].call_id, exported === 0 ? call : duplicateCall);
      assert.equal(body.events[0].success, true);
      exported++;
      return new Response(null, { status: 204 });
    }
    if (path.endsWith('/turns/' + turn)) return Response.json({ id: turn, status: 'completed' });
    if (path.endsWith('/items'))
      return Response.json({
        data: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            turn_id: turn,
            content: [{ type: 'output_text', text: 'I exported the campus cafe slides.' }],
          },
        ],
      });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    const created = path === '/v1/agents/sessions';
    if (created) {
      assert.equal(body.environment.type, 'none');
      assert.equal(body.agent.model, 'gpt-6-luna');
      assert.equal(body.agent.tools[1].name, 'render_powerpoint');
    }
    return Response.json({
      id: sessionId,
      agent: { model: 'gpt-6-luna' },
      status: created ? 'in_progress' : exported === 2 ? 'idle' : 'requires_action',
      required_actions:
        created || exported === 2
          ? []
          : [
              {
                type: 'function_call',
                call_id: exported === 0 ? call : duplicateCall,
                turn_id: turn,
                name: 'render_powerpoint',
                arguments: args,
              },
            ],
    });
  };
  const result = await generateSadeDeck(
    {
      id: randomUUID(),
      lease: randomUUID(),
      date: '2026-11-21T08:00:00.000Z',
      prompt: 'Make a PowerPoint for the campus cafe year-in-review',
    },
    { apiKey: 'fixture', fetch: transport, pollMs: 1 },
  );
  assert.equal(result.worker.report, 'I exported the campus cafe slides.');
  assert.equal(result.worker.sessionId, sessionId);
  assert.equal(result.title, title);
  assert.equal(exported, 2);
  assert.equal(audits, 1);
  assert.equal(Buffer.from(result.data, 'base64').readUInt32LE(0), 0x04034b50);
  assert.equal(calls.at(-1), 'DELETE /v1/agents/sessions/' + sessionId);
});
