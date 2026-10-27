import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchDocuments,
  matches,
  matchParts,
  snippet,
} from '../src/lib/search.ts';
import { createItem } from '../src/lib/editor.ts';

test('literal Unicode search returns list titles and nested context in stable tree order', () => {
  const child = createItem('Знайти [A+B] у тексті');
  const root = createItem('Контекст');
  root.children.push(child);
  const doc = { id: crypto.randomUUID(), title: 'Пошук [a+b]', nodes: [root] };
  const result = searchDocuments([doc], '[a+b]');
  assert.equal(result.total, 2);
  assert.equal(result.hits[0].itemId, null);
  assert.equal(result.hits[1].itemId, child.id);
  assert.deepEqual(result.hits[1].ancestors, ['Контекст']);
  assert.ok(matches('КИЇВ', 'київ'));
  assert.equal(matches('anything', '.*'), false);
  assert.equal(searchDocuments([doc], '  ').total, 0);
  assert.equal(
    matchParts(child.text, '[a+b]')
      .map((p) => p.text)
      .join(''),
    child.text,
  );
});

test('results are bounded explicitly and snippets include late matches without changing source', () => {
  const nodes = Array.from({ length: 205 }, () => createItem('match'));
  const doc = { id: crypto.randomUUID(), title: 'Other', nodes };
  const before = structuredClone(doc);
  const result = searchDocuments([doc], 'match');
  assert.equal(result.hits.length, 200);
  assert.equal(result.total, 205);
  assert.deepEqual(doc, before);
  const text = 'x'.repeat(1000) + '<script>Match</script>' + 'z'.repeat(1000);
  const display = snippet(text, 'match');
  assert.ok(display.includes('Match'));
  assert.ok(display.startsWith('…'));
  assert.ok(display.length <= 182);
});
