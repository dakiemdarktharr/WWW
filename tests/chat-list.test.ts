import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatList } from '../shared/chat-list.ts';
import type { WorkspaceState } from '../shared/types.ts';
import type { SharedGroup } from '../shared/collaboration.ts';

test('home merges project and shared chats, ranks latest activity and keeps unused chats last', () => {
  const state = {
    projects: [
      { id: 'p', name: 'Project', createdAt: '2026-11-01T00:00:00Z' },
      { id: 'empty', name: 'New empty project', createdAt: '2026-11-09T00:00:00Z' },
    ],
    messages: [
      { id: 'm', projectId: 'p', content: 'Project update', createdAt: '2026-11-06T00:00:00Z' },
    ],
    sessions: [],
    tasks: [],
    workflows: [],
  } as unknown as WorkspaceState;
  const groups = [
    {
      id: 'g',
      name: 'Shared',
      createdAt: '2026-11-01T00:00:00Z',
      lastMessageAt: '2026-11-07T00:00:00Z',
      lastMessagePreview: 'New message',
    },
    { id: 'e', name: 'Empty group', createdAt: '2026-11-08T00:00:00Z' },
  ] as SharedGroup[];
  assert.deepEqual(
    chatList(state, groups).map((row) => row.id),
    ['g', 'p', 'empty', 'e'],
  );
  state.sessions = [
    { id: 's', projectId: 'p', updatedAt: '2026-11-08T01:00:00Z' },
  ] as WorkspaceState['sessions'];
  assert.deepEqual(
    chatList(state, groups).map((row) => row.id),
    ['p', 'g', 'empty', 'e'],
  );
  assert.equal(chatList(state, groups)[1].preview, 'New message');
  assert.equal(chatList(state, groups).at(-1)?.active, false);
});
