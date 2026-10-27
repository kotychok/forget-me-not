import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OutlineState } from '../src/lib/outline-state.ts';
import { ApiError } from '../src/lib/api.ts';
import type { OutlineView, ViewChange } from '../src/lib/api.ts';
function fixture() {
  let server: OutlineView = { collapsedItemIds: [], revision: 0 };
  const api = {
    getView: async (_id: string) => structuredClone(server),
    patchView: async (_id: string, revision: number, changes: ViewChange[]) => {
      if (revision !== server.revision) throw new ApiError(409, 'Conflict');
      const ids = new Set(server.collapsedItemIds);
      for (const change of changes)
        if (change.collapsed) ids.add(change.itemId);
        else ids.delete(change.itemId);
      server = { collapsedItemIds: [...ids], revision: revision + 1 };
      return structuredClone(server);
    },
  };
  return { api, read: () => server };
}
test('concurrent devices merge different branches and last successful command wins for the same branch', async () => {
  const { api, read } = fixture();
  const a = new OutlineState('list', api, () => {}, 100000);
  const b = new OutlineState('list', api, () => {}, 100000);
  try {
    await Promise.all([a.refresh(), b.refresh()]);
    a.set('A', true);
    b.set('B', true);
    await a.flush();
    await b.flush();
    assert.deepEqual(new Set(read().collapsedItemIds), new Set(['A', 'B']));
    a.set('A', false);
    await a.flush();
    b.set('A', true);
    await b.flush();
    assert.equal(read().collapsedItemIds.includes('A'), true);
  } finally {
    a.dispose();
    b.dispose();
  }
});
test('an acknowledgement cannot discard newer changes made during a save', async () => {
  const { api, read } = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const start = new Promise<void>((resolve) => (started = resolve));
  let first = true;
  const state = new OutlineState(
    'list',
    {
      ...api,
      patchView: async (...args) => {
        if (first) {
          first = false;
          started();
          await gate;
        }
        return api.patchView(...args);
      },
    },
    () => {},
    100000,
  );
  try {
    state.set('A', true);
    const flight = state.flush();
    await start;
    state.set('A', false);
    release();
    await flight;
    assert.deepEqual(read().collapsedItemIds, []);
    assert.equal(state.dirty, false);
  } finally {
    state.dispose();
  }
});
test('lost replies remain retryable without losing remote or queued local preferences', async () => {
  const { api, read } = fixture();
  let lost = true;
  const state = new OutlineState(
    'list',
    {
      ...api,
      patchView: async (...args) => {
        const result = await api.patchView(...args);
        if (lost) {
          lost = false;
          throw new Error('Lost reply');
        }
        return result;
      },
    },
    () => {},
    100000,
  );
  try {
    state.set('A', true);
    await state.flush();
    assert.equal(state.dirty, true);
    assert.match(state.error, /Lost reply/);
    state.set('B', true);
    await state.retry();
    assert.deepEqual(new Set(read().collapsedItemIds), new Set(['A', 'B']));
    assert.equal(state.dirty, false);
  } finally {
    state.dispose();
  }
});
