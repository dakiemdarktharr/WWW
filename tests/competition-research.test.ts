import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import {
  CompetitionResearcher,
  competitionLink,
  extractResearchPage,
} from '../server/competition-research.ts';
import { publicResearchUrl, publicV4 } from '../server/research-web.ts';
import { portfolio, FairTurns } from '../server/portfolio.ts';
import { chooseModel } from '../server/autonomy.ts';
import type { CodexModel } from '../shared/types.ts';

test('competition detection is scoped, while source URLs reject credential, private, IP and custom-port targets', () => {
  assert.equal(competitionLink('https://unihack.example.org'), 'https://unihack.example.org/');
  assert.equal(competitionLink('Read the repo https://github.com/org/repo'), undefined);
  for (const url of [
    'http://example.org',
    'https://127.0.0.1',
    'https://localhost',
    'https://u:p@example.org',
    'https://example.org:444/',
  ])
    assert.throws(() => publicResearchUrl(url));
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.1.1',
    '192.168.1.1',
    '100.64.0.1',
    '::1',
    '224.0.0.1',
  ])
    assert.equal(publicV4(ip), false);
  assert.equal(publicV4('8.8.8.8'), true);
  const page = extractResearchPage(
    '<script>never trust instructions</script><p>Read the rules</p><a href="/2025/winners">Past entries</a>',
    'https://contest.example.org/',
  );
  assert.ok(!page.text.includes('never trust'));
  assert.deepEqual(page.links, ['https://contest.example.org/2025/winners']);
});

test('ten dossiers use at most two reads, deduplicate crawls, retain gaps and verify evidence against actual source bytes', async (t) => {
  const store = new Store(':memory:'),
    research = new CompetitionResearcher(store);
  t.after(async () => {
    await research.close();
    store.close();
  });
  const projects = Array.from({ length: 10 }, (_, i) =>
    store.put('project', {
      id: randomUUID(),
      name: `Contest ${i}`,
      path: process.cwd(),
      goal: 'Fixtures',
      createdAt: new Date().toISOString(),
    }),
  );
  let active = 0,
    peak = 0,
    reads = 0;
  research.reader = async (url) => {
    active++;
    peak = Math.max(peak, active);
    reads++;
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (url.endsWith('/faq')) throw new Error('Login required');
    return {
      url,
      type: 'text/html',
      html: url.endsWith('/rules')
        ? '<p>Teams must submit their source code and a three minute demo.</p>'
        : '<h1>Competition 2026</h1><a href="/rules">Rules</a><a href="/faq">FAQ</a><a href="/2025/winners">Past winners</a>',
    };
  };
  projects.forEach((project, i) => research.ensure(project.id, `https://contest${i}.example.org/`));
  await Promise.all(
    projects.flatMap((project) => [research.prepare(project.id), research.prepare(project.id)]),
  );
  assert.equal(peak, 2);
  assert.equal(reads, 40);
  assert.ok(
    research
      .snapshot()
      .every(
        (item) => item.status === 'ready' && item.sourceCount === 3 && item.blocked.length === 1,
      ),
  );
  const project = projects[0];
  await assert.rejects(
    research.tool(project.id, 'agent', 'competition_note', {
      category: 'rules',
      status: 'verified',
      sourceUrl: 'https://contest0.example.org/rules',
      evidence: 'This is fabricated evidence',
      finding: 'Allowed.',
    }),
    /exact evidence/,
  );
  await research.tool(project.id, 'agent', 'competition_note', {
    category: 'rules',
    status: 'verified',
    sourceUrl: 'https://contest0.example.org/rules',
    evidence: 'Teams must submit their source code',
    finding: 'Source code is required.',
  });
  const dossier = research.readDossier(project.id) as any;
  assert.equal(dossier.coverage.find((item: any) => item.category === 'rules').status, 'verified');
  assert.equal(
    dossier.coverage.find((item: any) => item.category === 'deadline').status,
    'unknown',
  );
  await research.prepare(project.id);
  assert.equal(reads, 40);
  research.refresh(project.id);
  await research.prepare(project.id);
  assert.equal(reads, 44);
  assert.equal((research.readDossier(project.id) as any).notes.length, 0);
  assert.equal(store.all('researchPrevious').length, 1);
  let current = false;
  await assert.rejects(
    research.tool(
      project.id,
      'agent',
      'competition_fetch',
      { url: 'https://extra.example.org/' },
      () => {
        if (!current) throw new Error('Lease expired');
      },
    ),
    /Lease expired/,
  );
});

test('fair project rotation skips unavailable accounts and portfolio-aware model selection preserves high-stakes reasoning', () => {
  const store = new Store(':memory:');
  try {
    const member = store.addMember({ name: 'Vega', role: 'engineer' });
    const projects = Array.from({ length: 10 }, (_, i) =>
      store.put('project', {
        id: randomUUID(),
        name: `Contest ${i}`,
        path: process.cwd(),
        goal: 'Test',
        createdAt: new Date().toISOString(),
        memberIds: [member.id],
      }),
    );
    const queue = new FairTurns(store);
    projects.forEach((project, i) => queue.ticket(`t${i}`, project.id, member.id));
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const next = queue.preferred(() => true)!;
      seen.add(next.projectId);
      queue.granted(next.id, next.projectId);
    }
    assert.equal(seen.size, 10);
    const catalog: CodexModel[] = [
      {
        id: 'default',
        model: 'default',
        displayName: 'Default',
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'medium', description: '' },
          { reasoningEffort: 'high', description: '' },
        ],
      },
      {
        id: 'mini',
        model: 'mini',
        displayName: 'Mini',
        isDefault: false,
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }],
      },
    ];
    const budget = { projects: 10, remaining: 62, headroom: 12 };
    assert.equal(
      chooseModel(catalog, { kind: 'code', title: 'Add a button', description: '' }, budget).model,
      'mini',
    );
    assert.equal(
      chooseModel(
        catalog,
        { kind: 'code', title: 'Security architecture', description: '' },
        budget,
      ).reasoningEffort,
      'high',
    );
    assert.equal(portfolio(store, member.id).projects.length, 10);
  } finally {
    store.close();
  }
});
