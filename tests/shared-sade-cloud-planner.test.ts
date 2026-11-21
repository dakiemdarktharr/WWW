import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { SharedGroup } from '../shared/collaboration.ts';
import type { TeamPlan } from '../shared/types.ts';
import { assertSharedHandoffPlan, type SharedDelivery } from '../server/group-sade.ts';
import { planSharedSadeCloud } from '../server/shared-sade-cloud-planner.ts';
import { sharedSadeEvidencePlanChoices } from '../server/shared-sade-responses-plan.ts';
import { resolveSharedSadeReadAssignment } from '../server/shared-sade-assignment.ts';
import {
  resolveSharedSadeHandoffAssignment,
  sharedSadeExplicitHandoffReview,
} from '../server/shared-sade-handoff-assignment.ts';

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

test('an explicit hold and a literal one-file copy edit do not call a provider', async () => {
  const unavailable = async () => assert.fail('This decision must be verified locally.');
  const hold = await planSharedSadeCloud(
    delivery(
      'Sade ơi, thôi tạm dừng làm dashboard bán hàng cho gian dao cắt giấy. Người giữ file đang sửa định dạng tiền, có bản sạch rồi tính tiếp.',
    ),
    unavailable,
  );
  assert.equal(hold.kind, 'plan');
  assert.deepEqual((hold.plan as TeamPlan).tasks, []);
  assert.match((hold.plan as TeamPlan).summary, /tạm hoãn/);

  const request = delivery(
    'Only change the heading in ui/takings/summary.tsx. Leave the rest of the current sales dashboard for the existing owner.',
  );
  const missing = await planSharedSadeCloud(request, unavailable);
  assert.equal(missing.kind, 'question');
  assert.match(missing.summary, /summary\.tsx.*nội dung gì/);

  const given = await planSharedSadeCloud(
    { ...request, clarification: { question: missing.summary, answer: 'Use “Daily takings”.' } },
    unavailable,
  );
  assert.equal(given.kind, 'plan');
  const [task] = (given.plan as TeamPlan).tasks;
  assert.deepEqual(task.scope, ['ui/takings/summary.tsx']);
  assert.match(task.description, /Daily takings/);

  const narrow = await planSharedSadeCloud(
    delivery('Chỉ đổi nhãn trong orders/empty.tsx thành “Bản 1.5”. Giữ nguyên phần còn lại.'),
    unavailable,
  );
  assert.equal(narrow.kind, 'plan');
  assert.deepEqual((narrow.plan as TeamPlan).tasks[0].scope, ['orders/empty.tsx']);
  assert.match((narrow.plan as TeamPlan).tasks[0].description, /Bản 1\.5/);
});

test('a combined hold and current request still needs a grounded interpretation', async () => {
  let calls = 0;
  const result = await planSharedSadeCloud(
    delivery('Sade ơi, khoan sửa phần thanh toán. Nhờ Mây của Bình đọc docs/settlement.md.'),
    async () => {
      calls++;
      return { decision: 'question' };
    },
  );
  assert.equal(calls, 1);
  assert.notEqual(result.kind === 'plan' && (result.plan as TeamPlan).tasks.length, 0);
});

test('a shop name containing an action word does not override a hold', async () => {
  const result = await planSharedSadeCloud(
    delivery(
      'Sade, khoan mo viec dashboard cho tiem sua thuyen. Dot phieu tra hang dang can doi soat.',
    ),
    async () => assert.fail('This hold has no separate active instruction.'),
  );
  assert.equal(result.kind, 'plan');
  assert.deepEqual((result.plan as TeamPlan).tasks, []);
  assert.match((result.plan as TeamPlan).summary, /tạm hoãn/);
});

test('the published owner Minh is distinct from the Vietnamese first-person possessive', () => {
  const group: Pick<SharedGroup, 'people' | 'teammates'> = {
    people: ['Linh', 'Minh'].map((name) => ({ id: name, name, state: 'active' })),
    teammates: ['Linh', 'Minh'].map((ownerId) => ({
      name: 'Lúa',
      localId: randomUUID(),
      ownerId,
      provider: 'codex',
    })),
  };
  for (const [qualifier, ownerId] of [
    ['Minh', 'Minh'],
    ['mình', 'Linh'],
  ]) {
    const assignment = resolveSharedSadeReadAssignment(
      `Nhờ Lúa của ${qualifier} đọc handoff/stock-check.md và báo chỗ xác nhận tồn kệ. Chỉ đọc thôi.`,
      'Linh',
      group,
    );
    assert.equal(assignment?.scope, 'handoff/stock-check.md');
    assert.deepEqual(
      assignment?.candidates.map((entry) => entry.ownerId),
      [ownerId],
    );
  }
});

const handoffGroup: Pick<SharedGroup, 'people' | 'teammates'> = {
  people: team.map(({ owner }) => ({ id: owner, name: owner, state: 'active' })),
  teammates: team.map(({ id, name, owner, provider }) => ({
    localId: id,
    name,
    ownerId: owner,
    provider: provider as SharedGroup['teammates'][number]['provider'],
  })),
};

test('a reply can pin a read-only Git history check to one named teammate, commit and file', async () => {
  const request =
    'Khoan giao sửa. Nhờ Mây của Bình tra lịch sử Git xác nhận commit trong tin mình reply có đụng tới tệp đó chưa. Nếu không thấy thì báo mình.';
  const reference = 'Bên mình đã đẩy b7c09fd cho src/orders/confirm.ts.';
  const result = await planSharedSadeCloud(delivery(request, reference), decided('plan'));
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.kind, 'research');
  assert.equal(task.preferredMemberId, team[1].id);
  assert.deepEqual(task.scope, ['src/orders/confirm.ts']);
  assert.match(task.description, /lịch sử Git.*b7c09fd.*chưa có commit/);

  const ambiguous = await planSharedSadeCloud(
    delivery(request, reference + ' Commit d6c71bb cũng liên quan.'),
    decided('plan'),
  );
  assert.equal(ambiguous.kind, 'question');
});

test('a Git method before the read verb preserves the account and the exact linked commit', async () => {
  const request =
    'Bình nhờ Mây dùng Git đọc đúng tệp ở commit trong tin mình reply. Gắn lại lẫy rồi thì dấu bạc còn không? Chỉ đọc và báo mình, đừng sửa.';
  const reference = 'Commit 2e08bf1 chỉnh lẫy ở repairs/locks/savesSilverLatch.ts.';
  const result = await planSharedSadeCloud(delivery(request, reference), decided('plan'));
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.kind, 'research');
  assert.equal(task.preferredMemberId, team[1].id);
  assert.deepEqual(task.scope, ['repairs/locks/savesSilverLatch.ts']);
  assert.match(task.description, /2e08bf1/);
  assert.match(task.description, /dấu bạc/);

  const broadened = await planSharedSadeCloud(
    delivery(request + ' Nhờ Claude sửa repairs/locks/other.ts.', reference),
    decided('plan'),
  );
  assert.notEqual(broadened.kind, 'plan');
});

test('a copy edit preserves an exact file declared with the assignee before replacement', async () => {
  const input = delivery(
    'Schedule one wording edit for Chi’s Claude in pages/intake/LoadingHint.tsx. Replace “Wait here” with “Use the side entrance”. Keep all other wording intact.',
  );
  const result = await planSharedSadeCloud(input, decided('plan'));
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.preferredMemberId, team[2].id);
  assert.deepEqual(task.scope, ['pages/intake/LoadingHint.tsx']);
  assert.match(task.description, /Wait here.*Use the side entrance/);

  const outOfScope = await planSharedSadeCloud(
    { ...input, request: input.request + ' Also edit pages/intake/OtherHint.tsx.' },
    decided('plan'),
  );
  assert.notEqual(outOfScope.kind, 'plan');
});

test('an assign command with quoted copy changes keeps the named teammate and exact file', async () => {
  const result = await planSharedSadeCloud(
    delivery(
      'Assign a text edit to Chi’s Claude in pages/desk/WindowCue.tsx. Swap “Wait here” for “Collect at the counter”. Keep the other labels in this file unchanged.',
    ),
    decided('plan'),
  );
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.preferredMemberId, team[2].id);
  assert.deepEqual(task.scope, ['pages/desk/WindowCue.tsx']);
  assert.match(task.description, /Wait here.*Collect at the counter/);
});

test('an informational signal is offered for status sharing and withheld for a current assignment', async () => {
  const status = 'Các bảng đã chuyển kho rồi. Chỉ báo nhóm để mọi người biết.';
  const confirmed = 'Các bảng đã chuyển kho rồi. Mình chỉ báo cả nhóm để nắm tình hình thôi.';
  const payloads: string[] = [];
  for (const request of [confirmed, status + ' Nhờ Claude của Chi đọc docs/desk/board.md.']) {
    await planSharedSadeCloud(delivery(request), async ({ messages }) => {
      payloads.push(messages[1].content);
      return { decision: 'no-work' };
    });
  }
  assert.equal(JSON.parse(payloads[0]).informationalUpdate, true);
  assert.equal(JSON.parse(payloads[1]).informationalUpdate, undefined);
});

test('a test and independent reviewer wait for both implementation branches', async () => {
  const writer = { ...team[1], id: randomUUID(), name: 'Antigravity', owner: 'Dũng' };
  const inputs = delivery(
    'Cần chốt vụ trả đồ trễ. Nhờ Gemini của An soạn tiêu chí ở docs/loans/late-returns.md. Sau khi tiêu chí ấy hoàn tất, giao Mây của Bình chỉnh ui/LateLoanBadge.tsx nhưng hỏi mình chọn phong cách trước khi sửa, và nhờ Antigravity của Dũng sửa loan/backend/lateReturns.ts. Hai nhánh song song. Khi hai nhánh xong, Gemini của An thêm test vào qa/lateReturns.spec.ts và Claude của Chi rà soát độc lập hai tệp triển khai, chỉ góp ý.',
  );
  inputs.team = [...inputs.team, writer];
  const choices = async ({
    questions = [],
  }: Parameters<Parameters<typeof planSharedSadeCloud>[1]>[0]) => {
    assert.ok(questions.every(({ name }) => !/^graph_after_[45]_/u.test(name)));
    return {
      decision: 'plan',
      selections: Object.fromEntries(
        questions.map(({ name, choices }) => [name, choices[0].value]),
      ),
    };
  };
  const result = await planSharedSadeCloud(inputs, async (input) => {
    assert.equal(JSON.parse(input.messages[1].content).laterRequesterCheckpoint, true);
    return choices(input);
  });
  assert.equal(result.kind, 'plan');
  const [spec, ui, api, qa, review] = (result.plan as TeamPlan).tasks;
  assert.deepEqual(ui.dependsOn, [spec.key]);
  assert.deepEqual(api.dependsOn, [spec.key]);
  assert.equal(ui.preferredMemberId, team[1].id);
  assert.match(ui.askBeforeEditing ?? '', /phong cách/);
  assert.deepEqual(qa.dependsOn, [ui.key, api.key]);
  assert.deepEqual(review.dependsOn, [ui.key, api.key]);
  assert.equal(review.preferredMemberId, team[2].id);
  assert.deepEqual(review.scope, [ui.scope[0], api.scope[0]]);

  const needsAnswerBeforeAnyAssignment = await planSharedSadeCloud(
    {
      ...inputs,
      request: inputs.request.replace('trước khi sửa', 'trước khi giao bất kỳ việc nào'),
    },
    async (input) => {
      assert.equal(JSON.parse(input.messages[1].content).laterRequesterCheckpoint, undefined);
      return { decision: 'question' };
    },
  );
  assert.equal(needsAnswerBeforeAnyAssignment.kind, 'question');

  const byAuthor = {
    ...inputs,
    request: inputs.request.replace('Claude của Chi rà soát', 'Mây của Bình rà soát'),
  };
  assert.notEqual((await planSharedSadeCloud(byAuthor, choices)).kind, 'plan');
});

test('a scoped copy edit can mention a spare part alongside another parallel edit', async () => {
  const message =
    'Hai việc này có thể chạy song song. Nhờ Mây của Bình rút gọn lời nhắc pin xanh dự phòng trong equipment/batteries/SpareBatteryTip.tsx. Giao Claude của Chi chỉnh mức chứa trong bins/stock/limitsPartsPerBin.ts. Mỗi người chỉ đụng tệp đã giao.';
  const choose = async ({
    questions = [],
  }: Parameters<Parameters<typeof planSharedSadeCloud>[1]>[0]) => ({
    decision: 'plan',
    ...(questions.length
      ? {
          selections: Object.fromEntries(
            questions.map(({ name, choices }) => [name, choices[0].value]),
          ),
        }
      : {}),
  });
  const result = await planSharedSadeCloud(delivery(message), choose);
  assert.equal(result.kind, 'plan');
  assert.deepEqual(
    (result.plan as TeamPlan).tasks.map(({ scope, preferredMemberId, dependsOn }) => [
      scope,
      preferredMemberId,
      dependsOn,
    ]),
    [
      [['equipment/batteries/SpareBatteryTip.tsx'], team[1].id, []],
      [['bins/stock/limitsPartsPerBin.ts'], team[2].id, []],
    ],
  );

  const undeclaredBackup = await planSharedSadeCloud(
    delivery(message + ' Cho Gemini của An làm tài khoản dự phòng.'),
    choose,
  );
  assert.notEqual(undeclaredBackup.kind, 'plan');
});

test('bounded evidence choices admit exact disjoint work and decline incomplete interpretations', () => {
  const request =
    'Please ask Mây of Bình to inspect screens/visitor/arrival.ts. Please have Claude of Chi update docs/transport/access.md. The two tasks may run independently.';
  const options = sharedSadeEvidencePlanChoices(delivery(request));
  assert.ok(options);
  assert.equal(options.compile({ exact_scoped_plan: 'no_match' }), undefined);
  const selected = options.compile({ exact_scoped_plan: 'plan_1' });
  assert.equal(selected?.kind, 'plan');
  if (selected?.kind !== 'plan') return;
  assert.deepEqual(
    (selected.plan as TeamPlan).tasks.map(({ kind, scope, preferredMemberId, dependsOn }) => [
      kind,
      scope[0],
      preferredMemberId,
      dependsOn,
    ]),
    [
      ['research', 'screens/visitor/arrival.ts', team[1].id, []],
      ['code', 'docs/transport/access.md', team[2].id, []],
    ],
  );
  assert.equal(
    sharedSadeEvidencePlanChoices(delivery(request + ' Only edit after approval.')),
    undefined,
  );
  assert.equal(
    sharedSadeEvidencePlanChoices(
      delivery(request + ' Also ask Claude of Chi to update missing/limits.json.'),
    ),
    undefined,
  );
});

test('a read from a cited commit must preserve the exact revision', async () => {
  const request = delivery(
    'Nhờ Claude của Chi xem đúng commit trong tin mình reply. Trong Git đọc file đó để xác nhận chế độ bắt đầu có hiện nhãn khách chưa. Trả lời kết quả thôi, đừng sửa.',
    'Lượt cập nhật nhãn khách ghi `f3e78a2` cùng tệp `screens/GuestMode.tsx`.',
  );
  const planned = await planSharedSadeCloud(request, async ({ questions }) => {
    assert.ok(questions?.some(({ name }) => name === 'evidence_route'));
    return { decision: 'plan', selections: { evidence_route: 'commit' } };
  });
  assert.equal(planned.kind, 'plan');
  const [task] = (planned.plan as TeamPlan).tasks;
  assert.equal(task.preferredMemberId, team[2].id);
  assert.deepEqual(task.scope, ['screens/GuestMode.tsx']);
  assert.match(task.description, /commit f3e78a2\b/);

  const declined = await planSharedSadeCloud(request, async () => ({
    decision: 'plan',
    selections: { evidence_route: 'no_match' },
  }));
  assert.equal(declined.kind, 'question');
});

test('a separate historical read clause preserves its verification target without widening scope', async () => {
  const reference = 'Bản vá trong commit c61aef4 cho win/profile/locksBadgeOnResume.ts.';
  const opening = 'Nhờ Claude của Chi xem đúng commit trong tin mình đang trả lời.';
  const request = delivery(
    `${opening} Đọc file được nêu ở commit đó để kiểm chốt huy hiệu sau khởi động lại. Báo lại thôi, không sửa.`,
    reference,
  );
  const result = await planSharedSadeCloud(request, decided('plan'));
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.kind, 'research');
  assert.deepEqual(task.scope, ['win/profile/locksBadgeOnResume.ts']);
  assert.match(task.description, /commit c61aef4/);
  assert.match(task.description, /chốt huy hiệu/);
  const wider = await planSharedSadeCloud(
    {
      ...request,
      request: `${opening} Đọc docs/unrelated.md ở commit đó để kiểm thông số. Báo lại thôi.`,
    },
    decided('plan'),
  );
  assert.notEqual(wider.kind, 'plan');
});

test('a revoked exact grant is named in the clarification without dispatch', async () => {
  const input = delivery(
    'Bình đã tắt chia sẻ Mây của project này. Tôi cần đúng Mây của Bình đọc ui/checkin/preservesTicketType.ts. Hỏi tôi có cấp quyền hiện tại trước khi giao.',
  );
  input.team = input.team.filter(({ owner }) => owner !== 'Bình');
  const result = await planSharedSadeCloud(input, decided('question'));
  assert.equal(result.kind, 'question');
  assert.match(result.summary, /quyền.*Mây của Bình.*dự án này/);

  const revoked = await planSharedSadeCloud(
    {
      ...input,
      request:
        'Bình vừa thu hồi quyền dùng Mây của dự án này. Tôi cần đúng Mây của Bình đọc ui/side-door/copiesTicketLetter.ts. Xin hỏi tôi về việc cấp lại quyền trước khi giao.',
    },
    decided('question'),
  );
  assert.equal(revoked.kind, 'question');
  assert.match(revoked.summary, /quyền.*Mây của Bình.*dự án này/);
});

test('a same-tag condition gates edits to the inspected file and exact criterion', async () => {
  const request =
    'Nhờ Gemini của An kiểm tra quy tắc mở buổi sáng trong src/booking/opensMorning.ts tại Git tag booking-4.1.8. Nếu kiểm chứng ở tag này cho thấy ngưỡng 7h còn thiếu, giao Claude của Chi bổ sung đúng tệp đó. Nếu đã có hoặc chưa đủ bằng chứng, không mở bước sửa.';
  const result = await planSharedSadeCloud(delivery(request), decided('plan'));
  assert.equal(result.kind, 'plan');
  const [verification, write] = (result.plan as TeamPlan).tasks;
  assert.equal(verification.kind, 'research');
  assert.equal(verification.preferredMemberId, team[0].id);
  assert.match(verification.description, /Git tag booking-4\.1\.8/);
  assert.match(verification.description, /ngưỡng 7h/);
  assert.equal(write.kind, 'code');
  assert.equal(write.preferredMemberId, team[2].id);
  assert.deepEqual(write.scope, ['src/booking/opensMorning.ts']);
  assert.deepEqual(write.dependsOn, [verification.key]);
  assert.equal(write.editIfMissingAfter, verification.key);

  for (const inconsistent of [
    request.replace('tại Git tag booking-4.1.8', 'tại Git HEAD'),
    request.replace('đúng tệp đó', 'src/booking/other.ts'),
  ]) {
    const rejected = await planSharedSadeCloud(delivery(inconsistent), decided('plan'));
    assert.ok(
      rejected.kind !== 'plan' ||
        (rejected.plan as TeamPlan).tasks.every(({ kind }) => kind !== 'code'),
    );
  }
});

test('named independent reviewers receive the same referenced commit and exact pair of files', async () => {
  const request =
    'Vui lòng nhờ Mây của Bình và Claude của Chi mỗi người một lượt rà soát độc lập. Xem cùng commit trong tin trước và cả hai tệp. Chỉ đọc, không merge hoặc sửa.';
  const reference = 'Bản vá 6af03cb gồm src/rules/check.ts và tests/rules-check.test.ts.';
  const result = await planSharedSadeCloud(delivery(request, reference), decided('plan'));
  assert.equal(result.kind, 'plan');
  assert.deepEqual(
    (result.plan as TeamPlan).tasks.map(
      ({ kind, scope, dependsOn, preferredMemberId, description }) => ({
        kind,
        scope,
        dependsOn,
        preferredMemberId,
        pinsCommit: description.includes('6af03cb'),
      }),
    ),
    [team[1].id, team[2].id].map((preferredMemberId) => ({
      kind: 'review',
      scope: ['src/rules/check.ts', 'tests/rules-check.test.ts'],
      dependsOn: [],
      preferredMemberId,
      pinsCommit: true,
    })),
  );

  const authorConflict = await planSharedSadeCloud(
    delivery(
      request,
      'Bản vá 6af03cb do Claude của Chi viết. Phạm vi src/rules/check.ts và tests/rules-check.test.ts.',
    ),
    decided('plan'),
  );
  assert.equal(authorConflict.kind, 'question');
  const scopeConflict = await planSharedSadeCloud(
    delivery(request, reference + ' Còn docs/release.md.'),
    decided('plan'),
  );
  assert.equal(scopeConflict.kind, 'question');

  const listedFiles = await planSharedSadeCloud(
    delivery(
      'Cần hai lượt xem riêng. Nhờ Mây của Bình và Claude của Chi rà soát độc lập đúng commit tôi đang trả lời. Đọc cả hai tệp ghi ở đó, mỗi người gửi nhận định riêng và giữ nguyên tệp.',
      'Commit 8a43ed1 cập nhật src/doors/matchesExitLight.ts và tests/exit-light.test.ts.',
    ),
    async () => ({ decision: 'plan', selections: { evidence_route: 'review' } }),
  );
  assert.equal(listedFiles.kind, 'plan');
  assert.equal((listedFiles.plan as TeamPlan).tasks.length, 2);
  assert.ok(
    (listedFiles.plan as TeamPlan).tasks.every(
      ({ kind, scope, description }) =>
        kind === 'review' && scope.length === 2 && description.includes('8a43ed1'),
    ),
  );
});

test('a casual handoff pins both writers and waits to test until the backend is complete', async () => {
  const request =
    'Sade ơi, nhờ Gemini của mình soạn hợp đồng thẻ thư viện ở docs/library-pass.md trước nhé. ' +
    'Khi có hợp đồng rồi, mới chuyển cho Mây của Bình làm giao diện src/library/PassPanel.tsx. ' +
    'Sade tự giao backend ở src/library/admit.ts theo hợp đồng, sau đó giao tests/library-admission.test.ts sau khi backend hoàn tất. ' +
    'Khi giao diện và backend đã xong, nhờ một người khác chỉ đọc đúng hai tệp nguồn coi thông báo lỗi có lộ số thẻ không.';
  const handoff = resolveSharedSadeHandoffAssignment(request, team[0].owner, handoffGroup);
  assert.deepEqual(
    handoff?.producer.candidates.map(({ teammateId }) => teammateId),
    [team[0].id],
  );
  assert.deepEqual(
    handoff?.receiver.candidates.map(({ teammateId }) => teammateId),
    [team[1].id],
  );
  assert.ok(handoff?.deliverables);
  assert.equal(handoff.deliverables.codebase.afterBackend, true);
  const assignments = {
    producer: { grantId: team[0].id, scope: handoff.producer.scope },
    receiver: { grantId: team[1].id, scope: handoff.receiver.scope },
  };
  const directive = sharedSadeExplicitHandoffReview(request);
  assert.equal(directive?.exactFrontendAndBackend, true);
  assert.match(directive.brief, /thông báo lỗi.*số thẻ/);
  const result = await planSharedSadeCloud(
    {
      ...delivery(request),
      handoffAssignments: assignments,
      handoffDeliverables: handoff.deliverables,
    },
    decided('plan'),
  );
  assert.equal(result.kind, 'plan');
  const plan = result.plan as TeamPlan;
  assert.deepEqual(
    plan.tasks.map(({ key, kind, scope, dependsOn }) => ({ key, kind, scope, dependsOn })),
    [
      { key: 'architecture', kind: 'code', scope: ['docs/library-pass.md'], dependsOn: [] },
      {
        key: 'frontend',
        kind: 'code',
        scope: ['src/library/PassPanel.tsx'],
        dependsOn: ['architecture'],
      },
      {
        key: 'backend',
        kind: 'code',
        scope: ['src/library/admit.ts'],
        dependsOn: ['architecture'],
      },
      {
        key: 'codebase',
        kind: 'code',
        scope: ['tests/library-admission.test.ts'],
        dependsOn: ['backend'],
      },
      {
        key: 'defensive-review',
        kind: 'review',
        scope: ['src/library/PassPanel.tsx', 'src/library/admit.ts'],
        dependsOn: ['frontend', 'backend'],
      },
    ],
  );
  assert.equal(plan.tasks[0].preferredMemberId, team[0].id);
  assert.equal(plan.tasks[1].preferredMemberId, team[1].id);
  assert.match(plan.tasks[1].acceptance, /ask.*style.*let the frontend harness choose/);
  assert.equal(plan.tasks[1].askBeforeEditing, undefined);

  const premature = structuredClone(plan);
  premature.tasks.find(({ key }) => key === 'codebase')!.dependsOn = ['architecture'];
  assert.throws(
    () => assertSharedHandoffPlan(premature, assignments, handoff.deliverables, true),
    /tests must wait/,
  );
});

test('sequential work waits for the requester’s style choice and reviews the two named files independently', async () => {
  const request =
    'Chia việc cho trang cấp máy chiếu nhé. Gemini soạn contract ở docs/projector/loans.md trước. ' +
    'Có contract rồi thì Mây của Bình viết apps/loans/DevicePanel.tsx, hãy hỏi mình chọn phong cách trước khi dựng UI, không được tự chọn. ' +
    'Cũng đợi contract xong rồi sửa bước xác thực thiết bị ở server/loans/validateDevice.ts. ' +
    'Phần tests/device-validation.test.ts đợi bước xác thực thiết bị xong mới viết. ' +
    'Cuối cùng nhờ người khác review hai tệp DevicePanel.tsx và validateDevice sau khi cả hai xong, coi thông báo lỗi và nút làm lại có nhất quán không.';
  const handoff = resolveSharedSadeHandoffAssignment(request, team[0].owner, handoffGroup);
  assert.ok(handoff?.deliverables);
  assert.deepEqual(
    handoff.producer.candidates.map(({ teammateId }) => teammateId),
    [team[0].id],
  );
  assert.deepEqual(
    handoff.receiver.candidates.map(({ teammateId }) => teammateId),
    [team[1].id],
  );
  const assignments = {
    producer: { grantId: team[0].id, scope: handoff.producer.scope },
    receiver: { grantId: team[1].id, scope: handoff.receiver.scope },
  };
  const directive = sharedSadeExplicitHandoffReview(request, {
    ...assignments,
    ...handoff.deliverables,
  });
  assert.equal(directive?.exactFrontendAndBackend, true);
  assert.match(directive.brief, /thông báo lỗi và nút làm lại/);
  const result = await planSharedSadeCloud(
    {
      ...delivery(request),
      handoffAssignments: assignments,
      handoffDeliverables: handoff.deliverables,
    },
    decided('plan'),
  );
  assert.equal(result.kind, 'plan');
  const plan = result.plan as TeamPlan;
  assert.deepEqual(
    plan.tasks.map(({ key, kind, scope, dependsOn }) => ({ key, kind, scope, dependsOn })),
    [
      { key: 'architecture', kind: 'code', scope: ['docs/projector/loans.md'], dependsOn: [] },
      {
        key: 'frontend',
        kind: 'code',
        scope: ['apps/loans/DevicePanel.tsx'],
        dependsOn: ['architecture'],
      },
      {
        key: 'backend',
        kind: 'code',
        scope: ['server/loans/validateDevice.ts'],
        dependsOn: ['architecture'],
      },
      {
        key: 'codebase',
        kind: 'code',
        scope: ['tests/device-validation.test.ts'],
        dependsOn: ['backend'],
      },
      {
        key: 'defensive-review',
        kind: 'review',
        scope: ['apps/loans/DevicePanel.tsx', 'server/loans/validateDevice.ts'],
        dependsOn: ['frontend', 'backend'],
      },
    ],
  );
  assert.deepEqual(
    plan.tasks.slice(0, 2).map(({ preferredMemberId }) => preferredMemberId),
    [team[0].id, team[1].id],
  );
  assert.match(
    plan.tasks[1].acceptance,
    /ask the requester which frontend style to use and wait for their choice/,
  );
  assert.match(plan.tasks[1].askBeforeEditing ?? '', /phong cách/);
  assert.doesNotMatch(plan.tasks[1].acceptance, /harness choose/);

  const missingScope = request.replace('và validateDevice sau khi', 'và legacyDevice sau khi');
  const accentedScope = request.replace('tệp DevicePanel.tsx và', 'tệp DevicePánel.tsx và');
  const wrongOrder = request.replace(
    'đợi bước xác thực thiết bị xong mới viết.',
    'đợi bản nháp xong mới viết.',
  );
  const reviewWrites = request.replace(
    'có nhất quán không.',
    'có nhất quán không, rồi sửa lỗi luôn.',
  );
  for (const invalid of [missingScope, accentedScope, wrongOrder, reviewWrites]) {
    const unresolved = resolveSharedSadeHandoffAssignment(invalid, team[0].owner, handoffGroup);
    assert.ok(unresolved);
    assert.equal(unresolved.deliverables, undefined);
  }
});

test('The hosted decision confirms B as check-existing and preserves the exact file, commit, and teammate', async () => {
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

test('The hosted decision retains both independent reviewers for C and asks for scope when it is missing', async () => {
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

test('The hosted decision preserves a scoped paired macOS verification request', async () => {
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

test('a schema-valid hosted decision cannot silently change a read into no work or supply another assignee', async () => {
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

test('a named read preserves a reporting condition without granting conditional edits', async () => {
  const result = await planSharedSadeCloud(
    delivery(
      'Mây bên Bình coi giúp src/config/locale.ts. Chỉ đọc, báo lại nếu thiếu mã locale thì default đang lấy từ đâu.',
    ),
    decided('plan'),
  );
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.preferredMemberId, team[1].id);
  assert.equal(task.kind, 'research');
  assert.deepEqual(task.scope, ['src/config/locale.ts']);
  assert.match(task.description, /thiếu mã locale/);

  const conflict = await planSharedSadeCloud(
    delivery(
      'Nhờ Mây đọc src/config/session.ts. Chỉ đọc, báo lại nếu thấy thiếu session thì sửa mặc định.',
    ),
    decided('plan'),
  );
  assert.equal(conflict.kind, 'question');
});

test('reported or deferred work yields no tasks and a real scoped restatement can be resolved', async () => {
  const result = await planSharedSadeCloud(
    delivery('“Nhờ Mây sửa src/app.ts” là ví dụ cũ. Tin này chỉ báo tình hình.'),
    decided('no-work'),
  );
  assert.equal(result.kind, 'plan');
  assert.deepEqual((result.plan as TeamPlan).tasks, []);
  const future = await planSharedSadeCloud(
    delivery(
      'Bản in đã bàn giao cho ca sáng. Tôi báo để cả nhóm biết, hôm khác nếu có bản mới tôi sẽ nhờ ai đó review sau.',
    ),
    decided('no-work'),
  );
  assert.equal(future.kind, 'plan');
  assert.deepEqual((future.plan as TeamPlan).tasks, []);
  const deferred = await planSharedSadeCloud(
    delivery(
      'Please postpone the planned edit in docs/desk/letter.md. I will send a go-ahead separately. There is no current assignment.',
      'Draft: Mây could edit docs/desk/letter.md later.',
    ),
    decided('no-work'),
  );
  assert.equal(deferred.kind, 'plan');
  assert.deepEqual((deferred.plan as TeamPlan).tasks, []);
  const request = delivery('Nhờ Mây đọc file.');
  request.clarification = { question: 'Tệp nào?', answer: 'Nhờ Mây đọc src/app.ts.' };
  const restated = await planSharedSadeCloud(request, decided('plan'));
  assert.equal(restated.kind, 'plan');
  assert.deepEqual((restated.plan as TeamPlan).tasks[0].scope, ['src/app.ts']);
});

test('a paired run targets the requested OS while preserving the named Windows worker', async () => {
  const result = await planSharedSadeCloud(
    delivery(
      'Bình đang dùng Windows. Nhờ Mây bên Bình sửa tests/audio/output.test.ts và chạy test trên macOS.',
    ),
    decided('plan'),
  );
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.preferredMemberId, team[1].id);
  assert.equal(task.requiredPlatform, 'darwin');
  assert.deepEqual(task.scope, ['tests/audio/output.test.ts']);
});

test('a paired test-only request binds the one file, account and authorized machine', async () => {
  const request = delivery(
    'Lan đồng ý cho mượn Mac của Lan rồi. Nhờ Mây của Bình chạy tests/panels/contrast.test.ts trên máy đó. Chỉ chạy bài test thôi. Đừng sửa tệp hay chạy bài khác.',
  );
  request.team = team.map((member) =>
    member.id === team[1].id ? { ...member, pairedMachineName: 'Mac của Lan' } : member,
  );
  const result = await planSharedSadeCloud(request, decided('plan'));
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.deepEqual(task.scope, ['tests/panels/contrast.test.ts']);
  assert.equal(task.preferredMemberId, team[1].id);
  assert.equal(task.requiredPairedMachineName, 'Mac của Lan');
  assert.equal(task.requiredPlatform, 'darwin');
  assert.equal(task.testOnly, true);

  const separated = await planSharedSadeCloud(
    {
      ...request,
      request:
        'Lan đã đồng ý cho dùng Mac của Lan để chạy đúng một bài thử. Giữ Mây của Bình làm người chạy. Trên Mac đó dùng công cụ chạy riêng checks/window/resize.test.ts, chỉ báo kết quả, đừng chỉnh test hay đụng mã nguồn.',
    },
    decided('plan'),
  );
  assert.equal(separated.kind, 'plan');
  const [scoped] = (separated.plan as TeamPlan).tasks;
  assert.deepEqual(scoped.scope, ['checks/window/resize.test.ts']);
  assert.equal(scoped.preferredMemberId, team[1].id);
  assert.equal(scoped.requiredPairedMachineName, 'Mac của Lan');
  assert.equal(scoped.testOnly, true);

  const named = {
    ...request,
    request:
      'Lan cho nhóm dùng Mac của Lan để chạy bài test này. Nhờ Mây của Bình chạy riêng checks/window/sort-order.test.ts trên đúng máy của Lan. Báo thứ tự đọc sau khi chuyển bộ lọc. Test-only, giữ nguyên tệp và mã nguồn.',
  };
  const namedRun = await planSharedSadeCloud(named, decided('plan'));
  assert.equal(namedRun.kind, 'plan');
  const [namedTask] = (namedRun.plan as TeamPlan).tasks;
  assert.equal(namedTask.requiredPairedMachineName, 'Mac của Lan');
  assert.equal(namedTask.testOnly, true);
  assert.deepEqual(namedTask.scope, ['checks/window/sort-order.test.ts']);

  const differentMachine = await planSharedSadeCloud(
    { ...named, request: named.request.replace('trên đúng máy của Lan', 'trên đúng máy của Ly') },
    decided('plan'),
  );
  assert.notEqual(differentMachine.kind, 'plan');

  const denied = await planSharedSadeCloud({ ...request, team }, decided('question'));
  assert.equal(denied.kind, 'question');
  assert.match(denied.summary, /quyền chạy đúng kiểm thử/);
});

test('a read after a teammate status update uses only the currently nominated account', async () => {
  const snapshot = delivery(
    'Claude của Chi giao giấy ghi ca cho quầy rồi. Riêng vụ đặt chỗ, dùng Mây của Bình đọc screens/arrival/keepsBookingHintAfterClear.ts và báo có còn lời nhắc không. Đừng sửa.',
  );
  const chooseRead = async () => ({
    decision: 'plan',
    selections: { evidence_route: 'read' },
  });
  const result = await planSharedSadeCloud(snapshot, chooseRead);
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.preferredMemberId, team[1].id);
  assert.deepEqual(task.scope, ['screens/arrival/keepsBookingHintAfterClear.ts']);

  const extraAction = await planSharedSadeCloud(
    {
      ...snapshot,
      request: snapshot.request.replace(
        'Claude của Chi giao giấy ghi ca cho quầy rồi',
        'Giao Claude của Chi cập nhật docs/arrival/shift.md',
      ),
    },
    chooseRead,
  );
  assert.notEqual(extraAction.kind, 'plan');
});

test('current approval supplies authority for a single referenced edit', async () => {
  const reference =
    'Đề xuất bổ sung quy tắc giữ ba lượt vào docs/check-in/queue-rules.md. Chờ mình xác nhận rồi mới sửa.';
  const request =
    'Ok, mình duyệt sửa nội dung đó rồi. Cho Claude của Chi cập nhật đúng file ở tin mình reply, giữ nguyên phần ghi chú dành cho khách.';
  const approved = await planSharedSadeCloud(delivery(request, reference), decided('plan'));
  assert.equal(approved.kind, 'plan');
  const [task] = (approved.plan as TeamPlan).tasks;
  assert.deepEqual(task.scope, ['docs/check-in/queue-rules.md']);
  assert.equal(task.preferredMemberId, team[2].id);
  assert.equal(task.kind, 'code');
  assert.match(task.description, /ba lượt/);
  assert.match(task.description, /giữ nguyên phần ghi chú/);

  const conflict = await planSharedSadeCloud(
    delivery(request, reference.replace('ba lượt', 'ba lượt rồi publish')),
    decided('plan'),
  );
  assert.equal(conflict.kind, 'question');
});

test('a confirmed current edit binds only the labeled file in a multi-file reply', async () => {
  const request =
    'Ok giờ mình chốt khu phía tây rồi. Nhờ Claude của Chi chỉ đổi địa điểm lấy thẻ trong file visitor instructions ở tin mình reply. File kho vật tư để nguyên.';
  const reference =
    'Visitor instructions là docs/tickets/collect.md. Danh sách kho vật tư là ops/supplies/inventory.md.';
  const approved = await planSharedSadeCloud(delivery(request, reference), decided('plan'));
  assert.equal(approved.kind, 'plan');
  const [task] = (approved.plan as TeamPlan).tasks;
  assert.equal(task.kind, 'code');
  assert.equal(task.preferredMemberId, team[2].id);
  assert.deepEqual(task.scope, ['docs/tickets/collect.md']);
  assert.match(task.description, /khu phía tây/);

  const denied = delivery(request, reference);
  denied.team = team.map((member) =>
    member.id === team[2].id ? { ...member, allowWrites: false } : member,
  );
  const result = await planSharedSadeCloud(denied, decided('question'));
  assert.equal(result.kind, 'question');
  assert.match(result.summary, /quyền ghi/);

  const literal = await planSharedSadeCloud(
    delivery(
      request.replace('chốt khu phía tây rồi', 'chốt nhãn “Lấy thẻ ở khu Tây” rồi'),
      reference,
    ),
    decided('plan'),
  );
  assert.equal(literal.kind, 'plan');
  assert.match((literal.plan as TeamPlan).tasks[0].description, /Lấy thẻ ở khu Tây/);
});

test('an explicit future quota policy preserves the selected primary and scope', async () => {
  const message = 'Nhờ Mây bên Bình đọc docs/playback/preroll.md để xác minh giá trị mặc định.';
  const delegated = await planSharedSadeCloud(
    delivery(message + ' Nếu Mây hết quota thì nhờ Claude của Chi đọc thay đúng file đó.'),
    decided('plan'),
  );
  assert.equal(delegated.kind, 'plan');
  const [task] = (delegated.plan as TeamPlan).tasks;
  assert.equal(task.fallbackMemberId, team[2].id);
  assert.equal(task.preferredMemberId, team[1].id);
  assert.deepEqual(task.scope, ['docs/playback/preroll.md']);

  const hold = await planSharedSadeCloud(
    delivery(message + ' Nếu Mây chạm giới hạn sử dụng thì chờ đến khi có lượt mới.'),
    decided('plan'),
  );
  assert.equal(hold.kind, 'plan');
  const [waiting] = (hold.plan as TeamPlan).tasks;
  assert.equal(waiting.preferredMemberId, team[1].id);
  assert.equal(waiting.fallbackMemberId, undefined);
  assert.equal(waiting.waitForProviderQuota, true);

  const wrongCondition = await planSharedSadeCloud(
    delivery(message + ' Nếu Gemini hết quota thì nhờ Claude của Chi đọc thay đúng file đó.'),
    decided('plan'),
  );
  assert.equal(wrongCondition.kind, 'question');

  const named = await planSharedSadeCloud(
    delivery(
      'Could Bình’s Mây read docs/night-light/preset.md to check the default? If Bình’s account runs out of quota, give exactly that read to Chi’s Claude instead. Otherwise keep it with Bình.',
    ),
    decided('plan'),
  );
  assert.equal(named.kind, 'plan');
  const [namedTask] = (named.plan as TeamPlan).tasks;
  assert.equal(namedTask.fallbackMemberId, team[2].id);
  assert.equal(namedTask.preferredMemberId, team[1].id);
  assert.deepEqual(namedTask.scope, ['docs/night-light/preset.md']);

  const explicit = await planSharedSadeCloud(
    delivery(
      'Have Bình’s Mây inspect docs/registers/latch.md for the default. If that exact account hits its provider quota, give Chi’s Claude the same read. Keep the file unchanged.',
    ),
    decided('plan'),
  );
  assert.equal(explicit.kind, 'plan');
  const [explicitTask] = (explicit.plan as TeamPlan).tasks;
  assert.equal(explicitTask.preferredMemberId, team[1].id);
  assert.equal(explicitTask.fallbackMemberId, team[2].id);
  assert.equal(explicitTask.fallbackOnProviderQuota, true);
  assert.deepEqual(explicitTask.scope, ['docs/registers/latch.md']);

  const unaccented = await planSharedSadeCloud(
    delivery(
      'Gemini cua An doc docs/fixtures/hinge.md xem ban le co giu khong. Het quota thi giu viec cho Gemini cua An, doi co luot roi xem tiep. Dung chuyen qua tai khoan khac.',
    ),
    decided('plan'),
  );
  assert.equal(unaccented.kind, 'plan');
  const [unaccentedTask] = (unaccented.plan as TeamPlan).tasks;
  assert.equal(unaccentedTask.preferredMemberId, team[0].id);
  assert.equal(unaccentedTask.waitForProviderQuota, true);
  assert.equal(unaccentedTask.fallbackMemberId, undefined);

  const conditionalSuffix = await planSharedSadeCloud(
    delivery(
      'Have Bình’s Mây inspect docs/phone/preset.md and report the default. Please give the same read to Chi’s Claude only if Mây is out of quota. Keep Mây as the assignee in all other cases. No file changes.',
    ),
    decided('plan'),
  );
  assert.equal(conditionalSuffix.kind, 'plan');
  const [fallbackTask] = (conditionalSuffix.plan as TeamPlan).tasks;
  assert.equal(fallbackTask.preferredMemberId, team[1].id);
  assert.equal(fallbackTask.fallbackMemberId, team[2].id);
  assert.equal(fallbackTask.fallbackOnProviderQuota, true);
  assert.deepEqual(fallbackTask.scope, ['docs/phone/preset.md']);

  const automatic = await planSharedSadeCloud(
    delivery(
      'Cho Gemini cua An coi docs/night-light/preset.md giup minh. Neu lai het quota thi giao bat ky ai co quyen du an nay doc thay, phan con lai cu giu nguyen.',
    ),
    decided('plan'),
  );
  assert.equal(automatic.kind, 'plan');
  assert.equal((automatic.plan as TeamPlan).tasks[0].fallbackMemberId, 'auto');
});

test('a quota policy cannot widen read-only fallback or remove an approval condition', async () => {
  const write = 'Ask Gemini of An to edit docs/panel/entry.md to add the desk hours.';
  const readFallback = await planSharedSadeCloud(
    delivery(write + ' If Gemini is out of quota, give the same read to Chi’s Claude.'),
    decided('plan'),
  );
  assert.equal(readFallback.kind, 'question');

  const requiresApproval = await planSharedSadeCloud(
    delivery(write + ' Only proceed if I confirm and you have quota, do not reassign.'),
    decided('plan'),
  );
  assert.equal(requiresApproval.kind, 'question');
});

test('a bounded option can confirm one active edit without treating the preceding context as work', async () => {
  const request = delivery(
    'The welcome banner still has the old pickup wording. Please ask Claude of Chi to edit screens/PickupNotice.tsx so the greeting reflects the desk hours. The note appears under the doorway icon.',
  );
  const result = await planSharedSadeCloud(request, async ({ questions }) => {
    assert.deepEqual(
      questions?.map(({ name }) => name),
      ['single_scoped_operation'],
    );
    return { decision: 'plan', selections: { single_scoped_operation: 'matches_scoped_action' } };
  });
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.kind, 'code');
  assert.equal(task.preferredMemberId, team[2].id);
  assert.deepEqual(task.scope, ['screens/PickupNotice.tsx']);

  const abstained = await planSharedSadeCloud(request, async () => ({
    decision: 'plan',
    selections: { single_scoped_operation: 'no_match' },
  }));
  assert.equal(abstained.kind, 'question');

  const gated = await planSharedSadeCloud(
    { ...request, request: request.request + ' Wait for my approval before the edit.' },
    async ({ questions }) => {
      assert.ok(!questions?.some(({ name }) => name === 'single_scoped_operation'));
      return { decision: 'question' };
    },
  );
  assert.notEqual(gated.kind, 'plan');
});

test('a request to edit after sign-off cannot dispatch a writer before approval', async () => {
  for (const request of [
    'Please have Claude of Chi change screens/PickupNotice.tsx once I sign off.',
    'The pickup hours have changed. Could Chi’s Claude edit screens/PickupNotice.tsx only after I confirm? The update is for next week.',
    'Nhờ Claude của Chi sửa screens/PickupNotice.tsx sau khi mình duyệt.',
  ]) {
    const result = await planSharedSadeCloud(delivery(request), async ({ questions }) => {
      assert.ok(!questions?.some(({ name }) => name === 'single_scoped_operation'));
      return { decision: 'plan' };
    });
    assert.equal(result.kind, 'question', request);
  }
});

test('a scoped text replacement treats quoted text as data', async () => {
  const request =
    'Chi ơi nhờ Claude chỉnh nhãn trong màn hình tải báo cáo. Trong src/reports/DownloadButton.tsx đổi chữ “All exports” thành “Tải báo cáo đã chọn” nha. Cái đó thôi.';
  const result = await planSharedSadeCloud(delivery(request), decided('plan'));
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.equal(task.kind, 'code');
  assert.equal(task.preferredMemberId, team[2].id);
  assert.deepEqual(task.scope, ['src/reports/DownloadButton.tsx']);
  assert.match(task.description, /All exports/);
  assert.match(task.description, /Tải báo cáo đã chọn/);

  const inline = await planSharedSadeCloud(
    delivery(
      'Could Chi’s Claude change “All exports” to “Report downloads” in src/reports/BatchList.tsx? That one label is all I need right now.',
    ),
    decided('plan'),
  );
  assert.equal(inline.kind, 'plan');
  const [inlineTask] = (inline.plan as TeamPlan).tasks;
  assert.deepEqual(inlineTask.scope, ['src/reports/BatchList.tsx']);
  assert.match(inlineTask.description, /Report downloads/);

  const bounded = await planSharedSadeCloud(
    delivery(
      'Please give Chi’s Claude a tiny text edit in screens/ParcelPanel.tsx. Replace “Label missing” with “Print a new label”. Keep the rest of the screen and file as they are.',
    ),
    decided('plan'),
  );
  assert.equal(bounded.kind, 'plan');
  const [boundedTask] = (bounded.plan as TeamPlan).tasks;
  assert.deepEqual(boundedTask.scope, ['screens/ParcelPanel.tsx']);
  assert.equal(boundedTask.preferredMemberId, team[2].id);
  assert.match(boundedTask.description, /Print a new label/);

  const quoted = await planSharedSadeCloud(
    delivery(
      'FYI, đây là yêu cầu cũ “Nhờ Claude sửa src/reports/DownloadButton.tsx”. Hôm nay chỉ báo tình hình.',
    ),
    decided('no-work'),
  );
  assert.equal(quoted.kind, 'plan');
  assert.deepEqual((quoted.plan as TeamPlan).tasks, []);
});

test('scoped parallel reads preserve individual questions and exact teammates', async () => {
  const result = await planSharedSadeCloud(
    delivery(
      'Cần hai lượt đọc song song. Gemini đọc src/cache/mode.ts để xác minh cache mode. Claude đọc docs/cache.md để xác minh giới hạn bộ nhớ. Chỉ hai lượt đọc, không thay đổi gì.',
    ),
    decided('plan'),
  );
  assert.equal(result.kind, 'plan');
  const { tasks } = result.plan as TeamPlan;
  assert.deepEqual(
    tasks.map(({ preferredMemberId }) => preferredMemberId),
    [team[0].id, team[2].id],
  );
  assert.deepEqual(
    tasks.map(({ scope }) => scope),
    [['src/cache/mode.ts'], ['docs/cache.md']],
  );
  assert.ok(tasks.every(({ kind, dependsOn }) => kind === 'research' && !dependsOn.length));
});

test('an explicit ordinal read selects only the named prior file', async () => {
  const result = await planSharedSadeCloud(
    delivery(
      'Hai tệp trên thì tệp thứ hai thôi. Mây đọc và coi ngưỡng retry mặc định.',
      'Hai tệp là docs/job-stop.md và docs/job-retry.md.',
    ),
    decided('plan'),
  );
  assert.equal(result.kind, 'plan');
  const [task] = (result.plan as TeamPlan).tasks;
  assert.deepEqual(task.scope, ['docs/job-retry.md']);
  assert.equal(task.kind, 'research');
  assert.match(task.description, /ngưỡng retry/);
});

test('Luna can confirm one grounded read without acquiring authority to edit or change scope', async () => {
  const request =
    'For the morning handover, the account I want is Bình’s Mây. I need a short explanation from a read of docs/returns/cutoff.md.';
  const exactRead = await planSharedSadeCloud(delivery(request), async ({ questions }) => {
    assert.equal(questions?.length, 1);
    assert.equal(questions[0].name, 'evidence_route');
    assert.deepEqual(
      questions[0].choices.map(({ value }) => value),
      ['read', 'no_match'],
    );
    return { decision: 'plan', selections: { evidence_route: 'read' } };
  });
  assert.equal(exactRead.kind, 'plan');
  const [task] = (exactRead.plan as TeamPlan).tasks;
  assert.equal(task.kind, 'research');
  assert.equal(task.preferredMemberId, team[1].id);
  assert.deepEqual(task.scope, ['docs/returns/cutoff.md']);

  const declined = await planSharedSadeCloud(delivery(request), async () => ({
    decision: 'plan',
    selections: { evidence_route: 'no_match' },
  }));
  assert.equal(declined.kind, 'question');

  const conditionalEdit = await planSharedSadeCloud(
    delivery(request + ' Edit that document if the cutoff is incorrect.'),
    async ({ questions }) => {
      assert.equal(questions, undefined);
      return { decision: 'plan' };
    },
  );
  assert.equal(conditionalEdit.kind, 'question');
});
