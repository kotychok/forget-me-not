import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTags,
  validateTags,
  taggedItems,
  tagNames,
} from '../src/lib/tags.ts';
import { createItem, Editor, locate } from '../src/lib/editor.ts';

test('tag names preserve exact case and Unicode, with explicit count/length/duplicate rules', () => {
  assert.deepEqual(parseTags(' work, Київ, Work '), ['work', 'Київ', 'Work']);
  assert.deepEqual(parseTags(''), []);
  assert.deepEqual(validateTags(['😀'.repeat(40)]), ['😀'.repeat(40)]);
  for (const tags of [
    [''],
    [' padded'],
    ['comma,name'],
    ['line\nbreak'],
    ['work', 'work'],
    ['a'.repeat(41)],
    Array.from({ length: 13 }, (_, i) => `tag${i}`),
  ])
    assert.throws(() => validateTags(tags));
});
test('filter projection includes matching ancestors and preserves original tree, ordering and metadata', () => {
  const child = createItem('Match');
  child.tags = ['work'];
  const hidden = createItem('Hidden sibling');
  const parent = createItem('Context');
  parent.children = [hidden, child];
  const other = createItem('Other');
  other.tags = ['Work'];
  const nodes = [parent, other];
  const before = structuredClone(nodes);
  const rows = taggedItems(nodes, 'work');
  assert.deepEqual(
    rows.map((row) => [row.item.id, row.depth, row.match]),
    [
      [parent.id, 0, false],
      [child.id, 1, true],
    ],
  );
  assert.deepEqual(nodes, before);
  assert.deepEqual(tagNames(nodes), ['Work', 'work']);
  assert.deepEqual(taggedItems(nodes, 'missing'), []);
});
test('tag assignment is one undoable command; removing tags and branch edits preserve identity', () => {
  const a = createItem('A'),
    b = createItem('B');
  const editor = new Editor([a, b]);
  editor.setFocus({ id: b.id, mode: 'navigate', start: 0, end: 0 });
  assert.equal(editor.setTags(b.id, ['work']), true);
  assert.equal(editor.setTags(b.id, ['work']), false);
  editor.execute('indent');
  assert.deepEqual(locate(editor.state.nodes, b.id)!.item.tags, ['work']);
  editor.undo();
  editor.undo();
  assert.equal(locate(editor.state.nodes, b.id)!.item.tags, undefined);
  editor.redo();
  assert.deepEqual(locate(editor.state.nodes, b.id)!.item.tags, ['work']);
  editor.setTags(b.id, []);
  assert.equal(locate(editor.state.nodes, b.id)!.item.tags, undefined);
});
