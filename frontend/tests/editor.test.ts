import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, createItem, locate, visibleItems } from '../src/lib/editor.ts';
import type { Item } from '../src/lib/editor.ts';

function fixture() {
  const a = createItem('A');
  const b = createItem('B');
  const child = createItem('Child', 'task');
  b.children.push(child);
  const c = createItem('C');
  const editor = new Editor([a, b, c]);
  editor.setFocus({ id: b.id, mode: 'edit', start: 1, end: 1 });
  return { editor, a, b, c, child };
}

function assertTree(nodes: Item[]) {
  const ids = new Set<string>();
  function visit(items: Item[]) {
    for (const item of items) {
      assert.ok(!ids.has(item.id), 'duplicate ID or cycle');
      ids.add(item.id);
      assert.match(
        item.id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      assert.ok(item.kind === 'task' || !item.completed);
      visit(item.children);
    }
  }
  visit(nodes);
}

test('indent and outdent preserve the whole branch and restore cursor through history', () => {
  const { editor, a, b, c, child } = fixture();
  const original = structuredClone(editor.state);
  assert.ok(editor.execute('indent'));
  assert.equal(locate(editor.state.nodes, b.id)!.parent!.id, a.id);
  assert.equal(locate(editor.state.nodes, child.id)!.parent!.id, b.id);
  assert.deepEqual(
    editor.state.nodes.map((n) => n.id),
    [a.id, c.id],
  );
  assert.ok(editor.execute('outdent'));
  assert.deepEqual(editor.state, original);
  assert.ok(editor.undo());
  assert.equal(locate(editor.state.nodes, b.id)!.parent!.id, a.id);
  assert.ok(editor.undo());
  assert.deepEqual(editor.state, original);
  assert.ok(editor.redo());
  assert.equal(editor.state.focus.start, 1);
  assertTree(editor.state.nodes);
});

test('add creates a sibling after the branch without splitting existing text', () => {
  const { editor, b, child } = fixture();
  editor.execute('add');
  assert.equal(editor.state.nodes[1].id, b.id);
  assert.equal(editor.state.nodes[1].text, 'B');
  assert.equal(editor.state.nodes[1].children[0].id, child.id);
  assert.equal(editor.state.nodes[2].id, editor.state.focus.id);
  assert.equal(editor.state.focus.mode, 'edit');
});

test('moving branches keeps descendants; boundary operations do not add history', () => {
  const { editor, b, child } = fixture();
  editor.execute('up');
  assert.equal(editor.state.nodes[0].id, b.id);
  assert.equal(editor.state.nodes[0].children[0].id, child.id);
  const count = editor.past.length;
  assert.equal(editor.execute('up'), false);
  assert.equal(editor.execute('indent'), false);
  assert.equal(editor.execute('outdent'), false);
  assert.equal(editor.past.length, count);
  editor.execute('down');
  assert.equal(editor.state.nodes[1].id, b.id);
});

test('deleting a branch skips its descendants and chooses next visible item', () => {
  const { editor, b, c, child } = fixture();
  editor.execute('delete');
  assert.equal(locate(editor.state.nodes, b.id), null);
  assert.equal(locate(editor.state.nodes, child.id), null);
  assert.equal(editor.state.focus.id, c.id);
  editor.undo();
  assert.equal(locate(editor.state.nodes, child.id)!.parent!.id, b.id);
});

test('last-item deletion and adding into an empty list remain undoable', () => {
  const item = createItem('Only item');
  const editor = new Editor([item]);
  editor.execute('delete');
  assert.equal(editor.state.focus.id, null);
  assert.equal(editor.state.nodes.length, 0);
  editor.execute('add');
  assert.equal(editor.state.nodes.length, 1);
  editor.undo();
  assert.equal(editor.state.nodes.length, 0);
  editor.undo();
  assert.equal(editor.state.focus.id, item.id);
});

test('task conversion preserves identity and children; completion does not cascade', () => {
  const { editor, b, child } = fixture();
  editor.execute('convert');
  editor.execute('complete');
  assert.equal(locate(editor.state.nodes, b.id)!.item.completed, true);
  assert.equal(locate(editor.state.nodes, child.id)!.item.completed, false);
  editor.execute('convert');
  assert.equal(locate(editor.state.nodes, b.id)!.item.kind, 'item');
  assert.equal(locate(editor.state.nodes, b.id)!.item.completed, false);
  assert.equal(locate(editor.state.nodes, child.id)!.parent!.id, b.id);
  editor.undo();
  assert.equal(locate(editor.state.nodes, b.id)!.item.completed, true);
});

test('typing groups until a pause; structural changes and edits after undo separate history', () => {
  const { editor, b } = fixture();
  editor.edit('Be', 2, 2, 1000);
  editor.edit('Bee', 3, 3, 1100);
  assert.equal(editor.past.length, 1);
  editor.edit('Been', 4, 4, 2000);
  assert.equal(editor.past.length, 2);
  editor.undo();
  assert.equal(locate(editor.state.nodes, b.id)!.item.text, 'Bee');
  assert.equal(editor.state.focus.start, 3);
  editor.undo();
  assert.equal(locate(editor.state.nodes, b.id)!.item.text, 'B');
  assert.equal(editor.state.focus.start, 1);
  editor.redo();
  editor.edit('New text', 8, 8, 2100);
  assert.equal(editor.future.length, 0);
  editor.execute('indent');
  editor.undo();
  assert.equal(locate(editor.state.nodes, b.id)!.item.text, 'New text');
});

test('collapsed nodes are excluded from navigation but remain in content', () => {
  const { editor, b, child } = fixture();
  assert.equal(visibleItems(editor.state.nodes, new Set([b.id])).length, 3);
  assert.equal(visibleItems(editor.state.nodes, new Set()).length, 4);
  assert.ok(locate(editor.state.nodes, child.id));
});

test('repeated structural changes preserve unique IDs and valid content through undo/redo', () => {
  const { editor } = fixture();
  const original = structuredClone(editor.state.nodes);
  for (let i = 0; i < 40; i++) {
    for (const action of [
      'indent',
      'outdent',
      'down',
      'up',
      'convert',
      'complete',
    ] as const) {
      editor.execute(action);
      assertTree(editor.state.nodes);
    }
  }
  while (editor.undo()) assertTree(editor.state.nodes);
  // History is bounded, so only verify complete restoration for a shorter sequence.
  const fresh = new Editor(original);
  fresh.execute('add');
  fresh.execute('indent');
  fresh.execute('convert');
  fresh.execute('complete');
  while (fresh.undo()) assertTree(fresh.state.nodes);
  assert.deepEqual(fresh.state.nodes, original);
  while (fresh.redo()) assertTree(fresh.state.nodes);
});

test('Escape cancellation restores history and focus without a redoable empty item', () => {
  const { editor, b } = fixture();
  editor.edit('Updated', 7, 7);
  editor.undo();
  const future = structuredClone(editor.future);
  const past = structuredClone(editor.past);
  editor.execute('add');
  assert.equal(editor.cancelNewItem(), true);
  assert.equal(editor.state.nodes.length, 3);
  assert.deepEqual(editor.state.focus, {
    id: b.id,
    mode: 'navigate',
    start: 1,
    end: 1,
  });
  assert.deepEqual(editor.past, past);
  assert.deepEqual(editor.future, future);
  assert.equal(editor.cancelNewItem(), false);
});

test('only untouched additions can be cancelled, including in an empty list', () => {
  const empty = new Editor([]);
  empty.execute('add');
  assert.equal(empty.cancelNewItem(), true);
  assert.equal(empty.state.focus.id, null);
  assert.deepEqual(empty.state.nodes, []);
  for (const change of ['typing', 'indent', 'focus', 'undo'] as const) {
    const { editor } = fixture();
    editor.execute('add');
    if (change === 'typing') {
      editor.edit('x', 1, 1);
      editor.edit('', 0, 0);
    } else if (change === 'indent') editor.execute('indent');
    else if (change === 'focus')
      editor.setFocus({ ...editor.state.focus, mode: 'navigate' });
    else {
      editor.undo();
      editor.redo();
    }
    assert.equal(editor.cancelNewItem(), false, change);
  }
  const existing = new Editor([createItem()]);
  assert.equal(existing.cancelNewItem(), false);
});

test('notes apply as one undoable command and survive branch operations', () => {
  const { editor, b } = fixture();
  const before = editor.past.length;
  assert.equal(editor.setNote(b.id, '**Literal**\nA note'), true);
  assert.equal(editor.past.length, before + 1);
  assert.equal(
    locate(editor.state.nodes, b.id)!.item.note,
    '**Literal**\nA note',
  );
  editor.execute('indent');
  assert.equal(
    locate(editor.state.nodes, b.id)!.item.note,
    '**Literal**\nA note',
  );
  editor.undo();
  editor.undo();
  assert.equal(locate(editor.state.nodes, b.id)!.item.note, undefined);
  editor.redo();
  assert.equal(
    locate(editor.state.nodes, b.id)!.item.note,
    '**Literal**\nA note',
  );
  assert.equal(editor.setNote(b.id, '**Literal**\nA note'), false);
  assert.equal(editor.setNote(b.id, ''), true);
  assert.equal(locate(editor.state.nodes, b.id)!.item.note, undefined);
});
