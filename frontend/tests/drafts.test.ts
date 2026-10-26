import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Drafts } from '../src/lib/drafts.ts';
import { createItem } from '../src/lib/editor.ts';
import type { Draft, DraftStorage } from '../src/lib/draft-storage.ts';

class MemoryDrafts implements DraftStorage {
  rows = new Map<string, Draft>();
  fail = false;
  async list(scope: string) {
    return [...this.rows.values()]
      .filter((row) => row.scope === scope)
      .map((row) => structuredClone(row));
  }
  async put(row: Draft) {
    if (this.fail) throw new Error('Quota exceeded');
    this.rows.set(row.id, structuredClone(row));
  }
  async remove(scope: string, id: string, token: string) {
    const row = this.rows.get(id);
    if (row?.scope !== scope || row.token !== token) return false;
    this.rows.delete(id);
    return true;
  }
}
function document(text = 'Local') {
  return { id: crypto.randomUUID(), title: 'Draft', nodes: [createItem(text)] };
}

test('each tab keeps a distinct draft, and scope excludes other servers and owners', async () => {
  const storage = new MemoryDrafts();
  const a = new Drafts(storage, () => {});
  const b = new Drafts(storage, () => {});
  await a.initialize('server', 'owner');
  await b.initialize('server', 'owner');
  const doc = document();
  a.update(doc, 0, true);
  b.update({ ...doc, title: 'Other tab' }, 0, true);
  await a.settle();
  await b.settle();
  assert.equal(storage.rows.size, 2);
  const reload = new Drafts(storage, () => {});
  await reload.initialize('server', 'owner');
  assert.equal(reload.records.length, 2);
  await reload.initialize('server', 'someone-else');
  assert.equal(reload.records.length, 0);
  await reload.initialize('different-server', 'owner');
  assert.equal(reload.records.length, 0);
});

test('queued acknowledgement cleanup cannot delete a newer edit', async () => {
  const storage = new MemoryDrafts();
  const drafts = new Drafts(storage, () => {});
  await drafts.initialize('server', 'owner');
  const doc = document();
  drafts.update(doc, 0, true);
  drafts.update(doc, 0, false);
  drafts.update({ ...doc, title: 'Newer' }, 1, true);
  await drafts.settle();
  const rows = [...storage.rows.values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].document.title, 'Newer');
  assert.equal(rows[0].baseRevision, 1);
  assert.equal(drafts.isDurable(doc.id), true);
});

test('token-based deletion preserves a draft changed after preview', async () => {
  const storage = new MemoryDrafts();
  const writer = new Drafts(storage, () => {});
  await writer.initialize('server', 'owner');
  const doc = document();
  writer.update(doc, 0, true);
  await writer.settle();
  const reader = new Drafts(storage, () => {});
  await reader.initialize('server', 'owner');
  const old = reader.records[0];
  writer.update({ ...doc, title: 'New edit from other tab' }, 0, true);
  await writer.settle();
  await assert.rejects(() => reader.discard(old), /changed in another tab/);
  assert.equal(storage.rows.size, 1);
  assert.equal(reader.records[0].document.title, 'New edit from other tab');
});

test('acknowledged identical content is pruned; distinct local versions remain', async () => {
  const storage = new MemoryDrafts();
  const writer = new Drafts(storage, () => {});
  await writer.initialize('server', 'owner');
  const doc = document();
  writer.update(doc, 3, true);
  await writer.settle();
  const reader = new Drafts(storage, () => {});
  await reader.initialize('server', 'owner');
  await reader.prune({ ...doc, revision: 4 });
  assert.equal(reader.records.length, 0);
  assert.equal(storage.rows.size, 0);
  writer.update({ ...doc, title: 'Different' }, 4, true, true);
  await writer.settle();
  await reader.refresh();
  await reader.prune({ ...doc, revision: 5 });
  assert.equal(reader.records.length, 1);
});

test('storage failures stay visible and retry persists the latest local snapshot', async () => {
  const storage = new MemoryDrafts();
  const drafts = new Drafts(storage, () => {});
  await drafts.initialize('server', 'owner');
  const doc = document();
  storage.fail = true;
  drafts.update(doc, 1, true);
  await drafts.settle();
  assert.match(drafts.error, /Quota/);
  assert.equal(drafts.isDurable(doc.id), false);
  storage.fail = false;
  await drafts.retry();
  assert.equal(drafts.error, '');
  assert.equal(drafts.isDurable(doc.id), true);
  assert.equal([...storage.rows.values()][0].document.title, 'Draft');
});

test('a failed read for a new identity never leaves the previous identity visible', async () => {
  const storage = new MemoryDrafts();
  const writer = new Drafts(storage, () => {});
  await writer.initialize('server', 'owner');
  writer.update(document(), 0, true);
  await writer.settle();
  const reader = new Drafts(storage, () => {});
  await reader.initialize('server', 'owner');
  assert.equal(reader.records.length, 1);
  storage.list = async () => {
    throw new Error('Read failed');
  };
  await reader.initialize('server', 'other');
  assert.equal(reader.records.length, 0);
  assert.match(reader.error, /Read failed/);
});
