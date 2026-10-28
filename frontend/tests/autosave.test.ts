import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Autosave } from '../src/lib/autosave.ts';
import { ApiError } from '../src/lib/api.ts';
import type { Document, ListDocument } from '../src/lib/api.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('edits during a save stay dirty and the next save uses acknowledged revision', async () => {
  const first = deferred<{ revision: number }>();
  const second = deferred<{ revision: number }>();
  const document: Document = { id: 'list', title: 'First', nodes: [] };
  const calls: { title: string; revision: number }[] = [];
  const queue = new Autosave(
    7,
    () => document,
    {
      save: async (doc, revision) => {
        calls.push({ title: doc.title, revision });
        return calls.length === 1 ? first.promise : second.promise;
      },
      get: async () => ({ ...document, revision: 7 }),
    },
    () => {},
    10000,
  );
  queue.markDirty();
  const saving = queue.flush();
  document.title = 'Second';
  queue.markDirty();
  assert.equal(queue.status, 'saving');
  assert.equal(calls.length, 1);
  first.resolve({ revision: 8 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.dirty, true);
  assert.equal(queue.status, 'saving');
  assert.deepEqual(calls, [
    { title: 'First', revision: 7 },
    { title: 'Second', revision: 8 },
  ]);
  second.resolve({ revision: 9 });
  assert.equal(await saving, true);
  assert.equal(queue.dirty, false);
  assert.equal(queue.status, 'saved');
  queue.dispose();
});

test('conflicts preserve local content and pause autosave', async () => {
  const document: Document = { id: 'list', title: 'Local', nodes: [] };
  let calls = 0;
  const queue = new Autosave(
    1,
    () => document,
    {
      save: async () => {
        calls++;
        throw new ApiError(409, 'Conflict');
      },
      get: async () => ({ ...document, revision: 2 }),
    },
    () => {},
    10000,
  );
  queue.markDirty();
  assert.equal(await queue.flush(), false);
  assert.equal(queue.status, 'conflict');
  document.title = 'More local changes';
  queue.markDirty();
  assert.equal(await queue.flush(), false);
  assert.equal(calls, 1);
  assert.equal(document.title, 'More local changes');
  assert.equal(queue.dirty, true);
  queue.dispose();
});

test('lost save response is reconciled before newer local changes are sent', async () => {
  const document: Document = { id: 'list', title: 'First', nodes: [] };
  let remote: ListDocument = { ...document, revision: 0 };
  let calls = 0;
  const revisions: number[] = [];
  const queue = new Autosave(
    0,
    () => document,
    {
      save: async (doc, revision) => {
        calls++;
        revisions.push(revision);
        remote = { ...structuredClone(doc), revision: revision + 1 };
        if (calls === 1) throw new Error('Response lost');
        return { revision: remote.revision };
      },
      get: async () => remote,
    },
    () => {},
    10000,
  );
  queue.markDirty();
  await queue.flush();
  assert.equal(queue.status, 'error');
  document.title = 'Second';
  queue.markDirty();
  assert.equal(await queue.retry(), true);
  assert.deepEqual(revisions, [0, 1]);
  assert.equal(queue.revision, 2);
  assert.equal(queue.dirty, false);
  queue.dispose();
});

test('retry refuses to overwrite a different newer server snapshot', async () => {
  const document: Document = { id: 'list', title: 'Local', nodes: [] };
  const queue = new Autosave(
    0,
    () => document,
    {
      save: async () => {
        throw new Error('Network');
      },
      get: async () => ({
        id: 'list',
        title: 'External',
        nodes: [],
        revision: 2,
      }),
    },
    () => {},
    10000,
  );
  queue.markDirty();
  await queue.flush();
  assert.equal(await queue.retry(), false);
  assert.equal(queue.status, 'conflict');
  assert.equal(document.title, 'Local');
  queue.dispose();
});

test('pausing during a write waits for acknowledgement without sending queued newer content', async () => {
  const first = deferred<{ revision: number }>();
  const document: Document = { id: 'list', title: 'First', nodes: [] };
  let calls = 0;
  const queue = new Autosave(
    0,
    () => document,
    {
      save: async (_doc, revision) => {
        calls++;
        return calls === 1 ? first.promise : { revision: revision + 1 };
      },
      get: async () => ({ ...document, revision: 1 }),
    },
    () => {},
    10000,
  );
  queue.markDirty();
  const saving = queue.flush();
  const paused = queue.pause();
  document.title = 'Newer';
  queue.markDirty();
  first.resolve({ revision: 1 });
  await paused;
  await saving;
  assert.equal(calls, 1);
  assert.equal(queue.dirty, true);
  assert.equal(await queue.retry(), false);
  queue.resume();
  assert.equal(await queue.flush(), true);
  assert.equal(calls, 2);
  assert.equal(queue.revision, 2);
  queue.dispose();
});

test('lost-response reconciliation distinguishes note changes from identical item text', async () => {
  const document: Document = {
    id: 'list',
    title: 'Notes',
    nodes: [
      {
        id: 'item',
        kind: 'item',
        text: 'Same text',
        note: 'Local note',
        completed: false,
        children: [],
      },
    ],
  };
  const queue = new Autosave(
    0,
    () => document,
    {
      save: async () => {
        throw new Error('Lost response');
      },
      get: async () => ({
        ...structuredClone(document),
        revision: 1,
        nodes: [{ ...document.nodes[0], note: 'Other note' }],
      }),
    },
    () => {},
    100000,
  );
  try {
    queue.markDirty();
    await queue.flush();
    await queue.retry();
    assert.equal(queue.status, 'conflict');
    assert.equal(document.nodes[0].note, 'Local note');
  } finally {
    queue.dispose();
  }
});

test('lost-response reconciliation distinguishes tags even when text and note match', async () => {
  const document: Document = {
    id: 'list',
    title: 'Tags',
    nodes: [
      {
        id: 'item',
        kind: 'item',
        text: 'Same text',
        tags: ['local'],
        completed: false,
        children: [],
      },
    ],
  };
  const queue = new Autosave(
    0,
    () => document,
    {
      save: async () => {
        throw new Error('Lost response');
      },
      get: async () => ({
        ...structuredClone(document),
        revision: 1,
        nodes: [{ ...document.nodes[0], tags: ['remote'] }],
      }),
    },
    () => {},
    100000,
  );
  try {
    queue.markDirty();
    await queue.flush();
    await queue.retry();
    assert.equal(queue.status, 'conflict');
    assert.deepEqual(document.nodes[0].tags, ['local']);
  } finally {
    queue.dispose();
  }
});
