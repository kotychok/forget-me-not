import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/lib/workspace.ts';
import { createItem } from '../src/lib/editor.ts';
import { ApiError } from '../src/lib/api.ts';
import type { ListDocument, Document } from '../src/lib/api.ts';

function fakeApi() {
  const first: ListDocument = {
    id: crypto.randomUUID(),
    title: 'First',
    revision: 0,
    nodes: [createItem('Original')],
  };
  const second: ListDocument = {
    id: crypto.randomUUID(),
    title: 'Second',
    revision: 0,
    nodes: [],
  };
  const documents = new Map(
    [first, second].map((doc) => [doc.id, structuredClone(doc)]),
  );
  const gets: string[] = [];
  const transport = {
    lists: async () =>
      [...documents.values()].map((doc, position) => ({
        id: doc.id,
        title: doc.title,
        revision: doc.revision,
        position,
        itemCount: doc.nodes.length,
      })),
    get: async (id: string) => {
      gets.push(id);
      return structuredClone(documents.get(id)!);
    },
    create: async (title: string) => {
      const doc = { id: crypto.randomUUID(), title, revision: 0, nodes: [] };
      documents.set(doc.id, doc);
      return structuredClone(doc);
    },
    save: async (doc: Document, baseRevision: number) => {
      if (documents.get(doc.id)?.revision !== baseRevision)
        throw new ApiError(409, 'Conflict');
      const revision = baseRevision + 1;
      documents.set(doc.id, { ...structuredClone(doc), revision });
      return { revision };
    },
    delete: async (id: string, baseRevision: number) => {
      if (documents.get(id)?.revision !== baseRevision)
        throw new ApiError(409, 'Conflict');
      documents.delete(id);
    },
  };
  return { first, second, documents, gets, transport };
}

test('switching lists retains unsaved content, editor history, and independent save queues', async () => {
  const fixture = fakeApi();
  const workspace = new Workspace(() => {}, fixture.transport);
  try {
    await workspace.load(fixture.first.id);
    const first = workspace.current!;
    first.editor.setFocus({
      id: first.editor.state.nodes[0].id,
      mode: 'edit',
      start: 0,
      end: 0,
    });
    first.editor.edit('Local edit', 10, 10);
    first.sync.markDirty();
    assert.equal(workspace.hasUnsaved, true);
    await workspace.open(fixture.second.id);
    assert.notEqual(workspace.current, first);
    await workspace.open(fixture.first.id);
    assert.equal(workspace.current, first);
    assert.equal(first.editor.state.nodes[0].text, 'Local edit');
    assert.equal(first.editor.past.length, 1);
    assert.deepEqual(fixture.gets, [fixture.first.id, fixture.second.id]);
    await first.sync.flush();
    assert.equal(
      fixture.documents.get(fixture.first.id)!.nodes[0].text,
      'Local edit',
    );
    assert.equal(workspace.hasUnsaved, false);
    first.editor.undo();
    assert.equal(first.editor.state.nodes[0].text, 'Original');
  } finally {
    workspace.dispose();
  }
});

test('creating, renaming, and deleting flushes pending content through the API', async () => {
  const fixture = fakeApi();
  const workspace = new Workspace(() => {}, fixture.transport);
  try {
    await workspace.load(null);
    assert.equal(await workspace.create(), true);
    const id = workspace.selectedId!;
    workspace.rename('Renamed');
    assert.equal(workspace.title, 'Renamed');
    assert.equal(workspace.hasUnsaved, true);
    assert.equal(await workspace.removeCurrent(), true);
    assert.equal(fixture.documents.has(id), false);
    assert.notEqual(workspace.selectedId, id);
  } finally {
    workspace.dispose();
  }
});
