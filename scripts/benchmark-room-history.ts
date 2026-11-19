import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Mesh } from '../server/mesh.ts';
import { Store } from '../server/store.ts';

// Run against a disposable in-memory workspace with: node --import tsx scripts/benchmark-room-history.ts
function medianMs(operation: () => void) {
  for (let i = 0; i < 5; i++) operation();
  const samples = Array.from({ length: 31 }, () => {
    const start = performance.now();
    operation();
    return performance.now() - start;
  });
  return Number(samples.sort((a, b) => a - b)[15].toFixed(3));
}

const store = new Store(':memory:');
try {
  const member = store.addMember({ name: 'Benchmark', role: 'engineer' });
  for (let i = 0; i < 20; i++)
    store.put('project', { id: `p${i}`, name: 'Room', memberIds: [member.id] });
  const mesh = new Mesh({ store });
  mesh.ensureMember('p0', member.id);
  store.transaction(() => {
    for (let i = 1; i <= 40_000; i++)
      store.put('message', {
        id: `m${i}`,
        sequence: i + 1,
        projectId: `p${i % 20}`,
        authorId: null,
        taskId: null,
        kind: 'system',
        content: 'x'.repeat(160),
      });
  });
  const readMs = medianMs(() => {
    const page = mesh.readRoom('p0', member.id, { after: 39_501, limit: 20 });
    assert.equal(page.unread, 2001);
    assert.equal(page.messages.length, 20);
    assert.equal(page.messages[0].sequence, 39_521);
  });
  const appendMs = medianMs(() => {
    store.message({
      projectId: 'p1',
      authorId: null,
      taskId: null,
      kind: 'system',
      content: 'append',
    });
  });
  console.log(
    JSON.stringify({ node: process.version, platform: process.platform, readMs, appendMs }),
  );
} finally {
  store.close();
}
