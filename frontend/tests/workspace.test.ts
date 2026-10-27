import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/lib/workspace.ts';
import type { Portable } from '../src/lib/portable.ts';
import type { Draft, DraftStorage } from '../src/lib/draft-storage.ts';
import type { Item } from '../src/lib/editor.ts';
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
    session: async () => ({ serverId: 'server', ownerId: 'owner' }),
    exportJson: async () => ({
      schemaVersion: 1 as const,
      lists: [...documents.values()].map(({ id, title, nodes }) => ({
        id,
        title,
        nodes,
      })),
    }),
    importJson: async (source: Portable) =>
      source.lists.map((list) => {
        function copy(item: Item): Item {
          return {
            ...item,
            id: crypto.randomUUID(),
            children: item.children.map(copy),
          };
        }
        const document = {
          id: crypto.randomUUID(),
          title: list.title,
          nodes: list.nodes.map(copy),
          revision: 0,
        };
        documents.set(document.id, document);
        return {
          id: document.id,
          title: document.title,
          revision: 0,
          position: documents.size - 1,
          itemCount: document.nodes.length,
        };
      }),
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

class MemoryStorage implements DraftStorage {
  rows = new Map<string, Draft>();
  fail = false;
  async list(scope: string) {
    return [...this.rows.values()].filter((row) => row.scope === scope);
  }
  async put(row: Draft) {
    if (this.fail) throw new Error('Storage failed');
    this.rows.set(row.id, structuredClone(row));
  }
  async remove(scope: string, id: string, token: string) {
    const row = this.rows.get(id);
    if (row?.scope !== scope || row.token !== token) return false;
    this.rows.delete(id);
    return true;
  }
}
test('loading the server preserves local edits as a draft; recovery creates a separate list', async () => {
  const fixture = fakeApi();
  const storage = new MemoryStorage();
  const workspace = new Workspace(() => {}, fixture.transport, storage);
  try {
    await workspace.load(fixture.first.id);
    const original = workspace.current!;
    original.editor.setFocus({
      id: original.editor.state.nodes[0].id,
      mode: 'edit',
      start: 0,
      end: 0,
    });
    original.editor.edit('Local change', 12, 12);
    original.sync.markDirty();
    await fixture.transport.save(
      {
        ...fixture.first,
        nodes: [{ ...fixture.first.nodes[0], text: 'Server change' }],
      },
      0,
    );
    await workspace.loadServerVersion();
    assert.equal(
      workspace.current!.editor.state.nodes[0].text,
      'Server change',
    );
    assert.equal(workspace.drafts!.records.length, 1);
    assert.equal(
      workspace.drafts!.records[0].document.nodes[0].text,
      'Local change',
    );
    await workspace.recoverDraft(workspace.drafts!.records[0]);
    assert.notEqual(workspace.selectedId, fixture.first.id);
    assert.equal(workspace.current!.editor.state.nodes[0].text, 'Local change');
    assert.equal(
      fixture.documents.get(fixture.first.id)!.nodes[0].text,
      'Server change',
    );
    assert.equal(workspace.drafts!.records.length, 0);
  } finally {
    workspace.dispose();
  }
});
test('a storage failure blocks loading another version without discarding local content', async () => {
  const fixture = fakeApi();
  const storage = new MemoryStorage();
  const workspace = new Workspace(() => {}, fixture.transport, storage);
  try {
    await workspace.load(fixture.first.id);
    const original = workspace.current!;
    original.editor.setFocus({
      id: original.editor.state.nodes[0].id,
      mode: 'edit',
      start: 0,
      end: 0,
    });
    original.editor.edit('Keep me', 7, 7);
    storage.fail = true;
    original.sync.markDirty();
    await assert.rejects(() => workspace.loadServerVersion(), /Storage failed/);
    assert.equal(workspace.current, original);
    assert.equal(workspace.current!.editor.state.nodes[0].text, 'Keep me');
  } finally {
    workspace.dispose();
  }
});

test('search overlays local edits without flushing and opens nested hits without changing history', async () => {
  const f = fakeApi();
  const child = createItem('Nested needle');
  f.documents.get(f.second.id)!.nodes = [createItem('Parent')];
  f.documents.get(f.second.id)!.nodes[0].children.push(child);
  const workspace = new Workspace(() => {}, f.transport);
  try {
    await workspace.load(f.first.id);
    const original = workspace.current!;
    original.editor.setFocus({
      id: f.first.nodes[0].id,
      mode: 'edit',
      start: 0,
      end: 0,
    });
    original.editor.edit('Local needle', 12, 12);
    original.sync.markDirty();
    const past = structuredClone(original.editor.past);
    const source = await workspace.searchSource();
    assert.equal(
      source.find((d) => d.id === f.first.id)!.nodes[0].text,
      'Local needle',
    );
    assert.equal(f.documents.get(f.first.id)!.nodes[0].text, 'Original');
    await workspace.openSearchHit(
      {
        listId: f.second.id,
        title: 'Second',
        itemId: child.id,
        text: child.text,
        ancestors: ['Parent'],
      },
      'needle',
    );
    assert.equal(workspace.current!.editor.state.focus.id, child.id);
    assert.deepEqual(original.editor.past, past);
    assert.equal(original.sync.dirty, true);
    await workspace.open(f.first.id);
    assert.equal(workspace.current, original);
    const missing = {
      listId: f.second.id,
      title: 'Second',
      itemId: crypto.randomUUID(),
      text: 'needle',
      ancestors: [],
    };
    await assert.rejects(workspace.openSearchHit(missing, 'needle'), /removed/);
    assert.equal(workspace.selectedId, f.first.id);
  } finally {
    workspace.dispose();
  }
});

test('search can activate a list created after the sidebar was loaded and rejects changed matches', async () => {
  const f = fakeApi();
  const workspace = new Workspace(() => {}, f.transport);
  try {
    await workspace.load(f.first.id);
    const remote = {
      id: crypto.randomUUID(),
      title: 'New remote list',
      revision: 0,
      nodes: [createItem('Remote needle')],
    };
    f.documents.set(remote.id, remote);
    const hit = {
      listId: remote.id,
      title: remote.title,
      itemId: remote.nodes[0].id,
      text: 'Remote needle',
      ancestors: [],
    };
    await assert.rejects(workspace.openSearchHit(hit, 'absent'), /changed/);
    assert.equal(workspace.selectedId, f.first.id);
    await workspace.openSearchHit(hit, 'needle');
    assert.equal(workspace.selectedId, remote.id);
    assert.ok(workspace.lists.some((list) => list.id === remote.id));
  } finally {
    workspace.dispose();
  }
});
