import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { TeamPlan } from '../shared/types.ts';
import type { SharedDelivery } from '../server/group-sade.ts';
import { planSharedSadeCloud } from '../server/shared-sade-cloud-planner.ts';

const team: SharedDelivery['team'] = [
  ['Gemini', 'An', 'gemini'],
  ['Mây', 'Bình', 'codex'],
  ['Claude', 'Chi', 'claude'],
].map(([name, owner, provider], index) => ({
  id: randomUUID(),
  name,
  owner,
  provider,
  role: 'engineer',
  allowWrites: true,
  platform: 'win32',
  ownedByRequester: index === 0,
  ...(index === 1 ? { pairedPlatform: 'darwin' } : {}),
}));
function delivery(request: string, reference?: string): SharedDelivery {
  return {
    id: randomUUID(),
    grantId: team[0].id,
    groupId: randomUUID(),
    projectKey: 'b'.repeat(64),
    phase: 'plan',
    request,
    team,
    prerequisites: [],
    ...(reference ? { referencedMessage: { author: 'An', content: reference } } : {}),
  };
}
const decided = (decision: string) => async () => ({ decision });

test('Qwen confirms B as check-existing and preserves the exact file, commit, and teammate', async () => {
  const result = await planSharedSadeCloud(
    delivery(
      'Cái đó tui commit rồi mà sao ông commit y chang? Nhờ Mây kiểm tra bản đã có.',
      'Tui đã commit 4107e5e cho docs/contract.md rồi.',
    ),
    decided('plan'),
  );
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.kind, 'research');
  assert.equal(task.preferredMemberId, team[1].id);
  assert.deepEqual(task.scope, ['docs/contract.md']);
  assert.match(task.description, /4107e5e/);
});

test('Qwen retains both independent reviewers for C and asks for scope when it is missing', async () => {
  const message = 'Đây là code Gemini tạo, lấy Claude và ChatGPT check thử.';
  const missing = await planSharedSadeCloud(delivery(message), decided('question'));
  assert.equal(missing.kind, 'question');
  const result = await planSharedSadeCloud(
    delivery(message, 'Bản vá hiện tại là src/check.ts.'),
    decided('plan'),
  );
  assert.equal(result.kind, 'plan');
  const { tasks } = result.plan as TeamPlan;
  assert.equal(tasks.length, 2);
  for (const task of tasks) {
    assert.equal(task.kind, 'review');
    assert.deepEqual(task.scope, ['src/check.ts']);
  }
  assert.deepEqual(
    tasks.map(({ preferredMemberId }) => preferredMemberId),
    [team[2].id, team[1].id],
  );
});

test('Qwen preserves a scoped paired macOS verification request', async () => {
  const result = await planSharedSadeCloud(
    delivery('Nhờ Mây kiểm thử src/app.ts trên máy Mac đã ghép cặp.'),
    decided('plan'),
  );
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.preferredMemberId, team[1].id);
  assert.equal(task.requiredPlatform, 'darwin');
  assert.deepEqual(task.scope, ['src/app.ts']);
});

test('schema-valid Qwen cannot silently change a read into no work or supply another assignee', async () => {
  const request = delivery('Nho May cua Binh doc src/app.ts, dung sua.');
  const good = await planSharedSadeCloud(request, decided('plan'));
  assert.equal(good.kind, 'plan');
  assert.equal((good.plan as TeamPlan).tasks[0].preferredMemberId, team[1].id);
  const wrong = await planSharedSadeCloud(request, decided('no-work'));
  assert.equal(wrong.kind, 'blocked');
  const extra = await planSharedSadeCloud(request, async () => ({
    decision: 'plan',
    preferredMemberId: team[0].id,
  }));
  assert.equal(extra.kind, 'blocked');
});

test('reported or deferred work yields no tasks and a real scoped restatement can be resolved', async () => {
  const result = await planSharedSadeCloud(
    delivery('“Nhờ Mây sửa src/app.ts” là ví dụ cũ. Tin này chỉ báo tình hình.'),
    decided('no-work'),
  );
  assert.equal(result.kind, 'plan');
  assert.deepEqual((result.plan as TeamPlan).tasks, []);
  const request = delivery('Nhờ Mây đọc file.');
  request.clarification = { question: 'Tệp nào?', answer: 'Nhờ Mây đọc src/app.ts.' };
  const restated = await planSharedSadeCloud(request, decided('plan'));
  assert.equal(restated.kind, 'plan');
  assert.deepEqual((restated.plan as TeamPlan).tasks[0].scope, ['src/app.ts']);
});
