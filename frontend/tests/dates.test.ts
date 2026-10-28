import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validDate, localToday, dueStatus } from '../src/lib/dates.ts';
import { createItem, Editor } from '../src/lib/editor.ts';
import { sameDocument } from '../src/lib/documents.ts';
import {
  validatePortable,
  parsePortable,
  serializePortable,
} from '../src/lib/portable.ts';
import { searchDocuments } from '../src/lib/search.ts';

test('Gregorian calendar dates reject invalid dates and timestamps; status uses local calendar day', () => {
  for (const date of ['0001-01-01', '9999-12-31', '2000-02-29', '2028-02-29'])
    assert.ok(validDate(date));
  for (const date of [
    '',
    null,
    '0000-01-01',
    '1900-02-29',
    '2100-02-29',
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '2026-1-01',
    '2026-10-28T00:00:00Z',
    ' 2026-10-28',
    '２０２６-10-28',
  ])
    assert.equal(validDate(date), false);
  assert.equal(localToday(new Date(2026, 9, 28, 0, 1)), '2026-10-28');
  assert.equal(localToday(new Date(2026, 9, 28, 23, 59)), '2026-10-28');
  assert.equal(dueStatus('2026-10-27', false, '2026-10-28'), 'overdue');
  assert.equal(dueStatus('2026-10-28', false, '2026-10-28'), 'today');
  assert.equal(dueStatus('2026-10-29', false, '2026-10-28'), 'upcoming');
  assert.equal(dueStatus('2026-10-27', true, '2026-10-28'), 'done');
});
test('due dates are one undoable command, survive conversion, and participate in content reconciliation', () => {
  const item = createItem('Deadline', 'task');
  const editor = new Editor([item]);
  const document = { id: crypto.randomUUID(), title: 'Dates', nodes: [item] };
  assert.ok(editor.setDueDate(item.id, '2028-02-29'));
  assert.equal(editor.past.length, 1);
  assert.equal(editor.setDueDate(item.id, '2028-02-29'), false);
  assert.equal(
    sameDocument(document, { ...document, nodes: editor.state.nodes }),
    false,
  );
  editor.execute('convert');
  assert.equal(editor.state.nodes[0].dueDate, '2028-02-29');
  assert.ok(editor.setDueDate(item.id, ''));
  assert.equal(editor.state.nodes[0].dueDate, undefined);
  editor.undo();
  assert.equal(editor.state.nodes[0].dueDate, '2028-02-29');
  editor.undo();
  editor.undo();
  assert.equal(editor.state.nodes[0].dueDate, undefined);
  editor.redo();
  assert.equal(editor.state.nodes[0].dueDate, '2028-02-29');
  assert.throws(() => editor.setDueDate(item.id, '2026-02-30'));
});
test('v4 portable dates preserve calendar strings; older schemas reject date fields; search includes date', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../fixtures/portable-v4.json', import.meta.url),
      'utf8',
    ),
  );
  fixture.schemaVersion = 4;
  fixture.lists[0].nodes[0].dueDate = '2028-02-29';
  const result = parsePortable(serializePortable(validatePortable(fixture)));
  assert.equal(result.schemaVersion, 4);
  assert.equal(result.lists[0].nodes[0].dueDate, '2028-02-29');
  assert.equal(searchDocuments(result.lists, '2028-02').hits[0].field, 'date');
  for (const date of [null, '', '2026-02-30', '2026-10-28T00:00Z']) {
    fixture.lists[0].nodes[0].dueDate = date;
    assert.throws(() => validatePortable(fixture), /dueDate/);
  }
  fixture.lists[0].nodes[0].dueDate = '2028-02-29';
  fixture.schemaVersion = 3;
  assert.throws(() => validatePortable(fixture), /Unknown field/);
});
