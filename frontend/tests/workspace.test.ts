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

test('authentication pause preserves history and same-owner retry reconciles before saving', async () => {
  const f = fakeApi();
  let authenticated = false;
  const save = f.transport.save;
  f.transport.save = async (...args) => {
    if (!authenticated) throw new ApiError(401, 'Sign in');
    return save(...args);
  };
  const workspace = new Workspace(() => {}, f.transport, new MemoryStorage());
  try {
    await workspace.load(f.first.id);
    const session = workspace.current!;
    session.editor.edit('Pending login', 0, 0);
    session.sync.markDirty();
    await session.sync.flush();
    assert.equal(session.sync.status, 'error');
    const history = structuredClone(session.editor.past);
    await workspace.pauseForAuthentication();
    assert.equal(await session.sync.flush(), false);
    assert.equal(
      workspace.localEdits().lists[0].nodes[0].text,
      'Pending login',
    );
    authenticated = true;
    await workspace.resumeAfterAuthentication();
    assert.equal(session.sync.status, 'saved');
    assert.equal(f.documents.get(f.first.id)!.nodes[0].text, 'Pending login');
    assert.deepEqual(session.editor.past, history);
  } finally {
    workspace.dispose();
  }
});

test('explicit draft-preserving logout waits for durable drafts and blocks on storage failure', async () => {
  const f = fakeApi();
  const storage = new MemoryStorage();
  const workspace = new Workspace(() => {}, f.transport, storage);
  try {
    await workspace.load(f.first.id);
    const session = workspace.current!;
    session.editor.edit('Keep for this owner', 0, 0);
    session.sync.markDirty();
    await workspace.prepareLogout(true);
    assert.ok(workspace.drafts?.isDurable(f.first.id));
    assert.equal(session.sync.dirty, true);
    assert.equal(f.documents.get(f.first.id)!.nodes[0].text, 'Original');
    storage.fail = true;
    session.editor.edit('New pending text', 0, 0);
    session.sync.markDirty();
    await assert.rejects(workspace.prepareLogout(true));
    assert.equal(session.editor.state.nodes[0].text, 'New pending text');
  } finally {
    workspace.dispose();
  }
});

test('a restored installation cannot replay cached edits even when owner and revision match', async () => {
  const f = fakeApi();
  let serverId = 'original-installation';
  f.transport.session = async () => ({ serverId, ownerId: 'owner' });
  const workspace = new Workspace(() => {}, f.transport, new MemoryStorage());
  try {
    await workspace.load(f.first.id);
    const session = workspace.current!;
    session.editor.edit('Old browser changes', 0, 0);
    session.sync.markDirty();
    await workspace.pauseForAuthentication();
    serverId = 'restored-installation';
    await assert.rejects(
      workspace.resumeAfterAuthentication(),
      /Installation identity changed/,
    );
    assert.equal(session.sync.dirty, true);
    assert.equal(f.documents.get(f.first.id)!.nodes[0].text, 'Original');
    assert.equal(
      workspace.localEdits().lists[0].nodes[0].text,
      'Old browser changes',
    );
    await workspace.prepareLogout(true);
    assert.ok(workspace.drafts?.isDurable(f.first.id));
  } finally {
    workspace.dispose();
  }
});

test('remote polling replaces only clean navigation sessions and resets undo while preserving focus and collapse', async () => {
  const f = fakeApi();
  const w = new Workspace(() => {}, f.transport);
  try {
    await w.load(f.first.id);
    const old = w.current!;
    const id = old.editor.state.nodes[0].id;
    old.editor.edit('Saved local history', 0, 0);
    old.sync.markDirty();
    await old.sync.flush();
    old.editor.setFocus({ id, mode: 'navigate', start: 0, end: 0 });
    old.collapsed.add(id);
    const server = f.documents.get(f.first.id)!;
    server.nodes[0].text = 'From phone';
    server.revision++;
    await w.refreshRemote();
    assert.notEqual(w.current, old);
    assert.equal(w.current!.editor.state.nodes[0].text, 'From phone');
    assert.equal(w.current!.editor.state.focus.id, id);
    assert.equal(w.current!.editor.past.length, 0);
    assert.equal(w.current!.editor.future.length, 0);
    assert.equal(w.current!.collapsed.has(id), true);
    const gets = f.gets.length;
    await w.refreshRemote();
    assert.equal(f.gets.length, gets, 'unchanged revisions need no full fetch');
  } finally {
    w.dispose();
  }
});

test('polling preserves dirty content, modal drafts and a deleted cached list', async () => {
  const f = fakeApi();
  const w = new Workspace(() => {}, f.transport);
  try {
    await w.load(f.first.id);
    const local = w.current!;
    w.setInteractionBlocked(local, true);
    f.documents.get(f.first.id)!.revision++;
    f.documents.get(f.first.id)!.nodes[0].text = 'Remote';
    await w.refreshRemote();
    assert.equal(w.current, local);
    assert.equal(local.remoteChanged, true);
    assert.equal(local.editor.state.nodes[0].text, 'Original');
    w.setInteractionBlocked(local, false);
    local.editor.edit('Local', 0, 0);
    local.sync.markDirty();
    await w.refreshRemote();
    assert.equal(w.current, local);
    assert.equal(local.editor.state.nodes[0].text, 'Local');
    f.documents.delete(f.first.id);
    await w.refreshRemote();
    assert.equal(w.current, local);
    assert.ok(w.lists.some((list) => list.id === f.first.id));
    assert.equal(local.remoteChanged, true);
  } finally {
    w.dispose();
  }
});

test('a local edit made during a remote fetch wins over background replacement', async () => {
  const f = fakeApi();
  const get = f.transport.get;
  let release: (() => void) | undefined;
  let fetching: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    fetching = resolve;
  });
  const w = new Workspace(() => {}, f.transport);
  try {
    await w.load(f.first.id);
    const local = w.current!;
    f.documents.get(f.first.id)!.revision++;
    f.transport.get = async (id) => {
      fetching!();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return get(id);
    };
    const polling = w.refreshRemote();
    await started;
    local.editor.edit('Typed while fetching', 0, 0);
    local.sync.markDirty();
    release!();
    await polling;
    assert.equal(w.current, local);
    assert.equal(local.editor.state.nodes[0].text, 'Typed while fetching');
    assert.equal(local.remoteChanged, true);
  } finally {
    w.dispose();
  }
});

test('a delayed index cannot undo a completed workspace operation', async () => {
  const f = fakeApi();
  const w = new Workspace(() => {}, f.transport);
  try {
    await w.load(f.first.id);
    const summaries = await f.transport.lists();
    let release: ((value: typeof summaries) => void) | undefined;
    f.transport.lists = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const polling = w.refreshRemote();
    await w.create();
    const created = w.selectedId;
    release!(summaries);
    await polling;
    assert.ok(w.lists.some((list) => list.id === created));
    assert.equal(w.selectedId, created);
  } finally {
    w.dispose();
  }
});

test('an index older than our latest acknowledgement never resets local history', async () => {
  const f = fakeApi();
  const w = new Workspace(() => {}, f.transport);
  try {
    await w.load(f.first.id);
    const stale = await f.transport.lists();
    const session = w.current!;
    session.editor.edit('Saved locally', 0, 0);
    session.sync.markDirty();
    await session.sync.flush();
    const gets = f.gets.length;
    f.transport.lists = async () => stale;
    await w.refreshRemote();
    assert.equal(w.current, session);
    assert.equal(session.editor.past.length, 1);
    assert.equal(f.gets.length, gets);
  } finally {
    w.dispose();
  }
});
