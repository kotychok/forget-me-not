import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChanges } from '../src/lib/incremental.ts';
import type { Batch } from '../src/lib/incremental.ts';
import { createItem, Editor, locate } from '../src/lib/editor.ts';
import type { Item, Command } from '../src/lib/editor.ts';
import type { Document } from '../src/lib/api.ts';
import { sameDocument } from '../src/lib/documents.ts';
function doc(nodes: Item[]): Document {
  return { id: crypto.randomUUID(), title: 'Test', nodes };
}
// Independent small reference interpreter used to check planner output, not its implementation.
function apply(base: Document, batch: Batch): Document {
  const result = structuredClone(base);
  if (batch.title !== undefined) result.title = batch.title;
  for (const op of batch.ops) {
    if (op.type === 'update') {
      const item = locate(result.nodes, op.itemId)!.item;
      Object.assign(item, op.changes);
      if (op.changes.dueDate === null) delete item.dueDate;
    } else if (op.type === 'remove') {
      const found = locate(result.nodes, op.itemId)!;
      found.siblings.splice(found.index, 1);
    } else {
      let item: Item;
      if (op.type === 'move') {
        const found = locate(result.nodes, op.itemId)!;
        item = found.siblings.splice(found.index, 1)[0];
      } else item = { ...structuredClone(op.item), children: [] };
      const group =
        op.parentId === null
          ? result.nodes
          : locate(result.nodes, op.parentId)!.item.children;
      group.splice(
        op.afterId === null
          ? 0
          : group.findIndex((n) => n.id === op.afterId) + 1,
        0,
        item,
      );
    }
  }
  return result;
}
test('one branch move leaves descendants off the wire and deleted roots do not renumber siblings on wire', () => {
  const a = createItem('A'),
    b = createItem('B');
  b.children = [createItem('child')];
  const base = doc([
    a,
    b,
    ...Array.from({ length: 998 }, () => createItem('sibling')),
  ]);
  const target = structuredClone(base);
  target.nodes[0].children.push(target.nodes.splice(1, 1)[0]);
  const batch = planChanges(base, target, 2, crypto.randomUUID())!;
  assert.equal(batch.ops.length, 1);
  assert.equal(batch.ops[0].type, 'move');
  assert.ok(sameDocument(apply(base, batch), target));
  const removed = structuredClone(base);
  removed.nodes.shift();
  const deletion = planChanges(base, removed, 2, crypto.randomUUID())!;
  assert.deepEqual(deletion.ops, [{ type: 'remove', itemId: a.id }]);
});
test('children can escape an obsolete parent without a move for every following root', () => {
  const a = createItem('A'),
    child = createItem('child');
  a.children = [child];
  const base = doc([
    a,
    ...Array.from({ length: 999 }, () => createItem('root')),
  ]);
  const target = {
    ...structuredClone(base),
    nodes: [structuredClone(child), ...structuredClone(base.nodes.slice(1))],
  };
  const batch = planChanges(base, target, 0, crypto.randomUUID())!;
  assert.equal(batch.ops.length, 2);
  assert.ok(sameDocument(apply(base, batch), target));
});
test('field clears, new parents, nested creation, deletion and title changes preserve the complete target', () => {
  const a = createItem('A');
  a.note = 'Note';
  a.tags = ['Tag'];
  a.dueDate = '2026-11-02';
  const base = doc([a, createItem('Delete')]);
  const target = structuredClone(base);
  target.title = 'Renamed';
  delete target.nodes[0].note;
  delete target.nodes[0].tags;
  delete target.nodes[0].dueDate;
  const parent = createItem('New parent');
  parent.children = [target.nodes[0], createItem('New child')];
  target.nodes = [parent];
  const batch = planChanges(base, target, 0, crypto.randomUUID())!;
  assert.ok(sameDocument(apply(base, batch), target));
  assert.equal(planChanges(base, base, 0, crypto.randomUUID()), undefined);
});
test('planner follows varied editor changes and undo/redo without depending on keypress history', () => {
  let base = doc(Array.from({ length: 20 }, (_, i) => createItem(`Item ${i}`)));
  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };
  const commands: Command[] = [
    'indent',
    'outdent',
    'up',
    'down',
    'add',
    'delete',
    'convert',
    'complete',
  ];
  for (let round = 0; round < 250; round++) {
    const editor = new Editor(base.nodes);
    const flat = (nodes: Item[]): Item[] =>
      nodes.flatMap((n) => [n, ...flat(n.children)]);
    for (let step = 0; step < 4; step++) {
      const items = flat(editor.state.nodes);
      const item = items[random() % items.length];
      if (!item) break;
      editor.setFocus({ id: item.id, mode: 'navigate', start: 0, end: 0 });
      editor.execute(commands[random() % commands.length]);
      if (random() % 3 === 0) editor.edit(`Changed ${random()}`, 0, 0);
      if (random() % 7 === 0) editor.undo();
    }
    const target = { ...base, nodes: structuredClone(editor.state.nodes) };
    if (!sameDocument(base, target)) {
      const batch = planChanges(base, target, round, crypto.randomUUID());
      assert.ok(batch, `missing plan at round ${round}`);
      assert.ok(
        sameDocument(apply(base, batch), target),
        `wrong plan at round ${round}`,
      );
    }
    base = target;
    if (!base.nodes.length) base = doc([createItem('Restart')]);
  }
});
