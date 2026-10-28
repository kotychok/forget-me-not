import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parsePortable,
  serializePortable,
  validatePortable,
  countItems,
  MAX_FILE_BYTES,
} from '../src/lib/portable.ts';
const fixture = () =>
  parsePortable(
    readFileSync(
      new URL('../../fixtures/portable-v1.json', import.meta.url),
      'utf8',
    ),
  );

test('JSON round-trip preserves IDs, nesting, text, completion, and empty lists', () => {
  const source = fixture();
  assert.deepEqual(parsePortable(serializePortable(source)), source);
  assert.equal(countItems(source), 2);
  assert.equal(
    source.lists[0].nodes[0].children[0].text,
    'Buy **tickets** & keep <html> literal',
  );
});
test('unknown fields, unsupported versions, and duplicate IDs have actionable paths', () => {
  let source: unknown = fixture();
  (source as Record<string, unknown>).ownerId = 'untrusted';
  assert.throws(() => validatePortable(source), /\$\.ownerId: Unknown field/);
  source = { ...fixture(), schemaVersion: 4 };
  assert.throws(() => validatePortable(source), /\$\.schemaVersion/);
  const duplicate = fixture();
  duplicate.lists[1].nodes = [structuredClone(duplicate.lists[0].nodes[0])];
  assert.throws(
    () => validatePortable(duplicate),
    /\$\.lists\[1\]\.nodes\[0\]\.id: Duplicate ID/,
  );
});
test('invalid node types, plain completion, and malformed arrays are rejected', () => {
  const source = fixture();
  source.lists[0].nodes[0].completed = true;
  assert.throws(() => validatePortable(source), /completed/);
  const bad = fixture();
  (bad.lists[0].nodes[0] as unknown as Record<string, unknown>).children = {};
  assert.throws(() => validatePortable(bad), /children: Expected an array/);
  assert.throws(() => parsePortable('{ broken'), /Invalid JSON/);
});
test('limits count UTF-8 bytes and reject deep trees and oversized files', () => {
  const source = fixture();
  source.lists[0].nodes[0].text = '🙂'.repeat(8192);
  assert.doesNotThrow(() => validatePortable(source));
  source.lists[0].nodes[0].text += '🙂';
  assert.throws(
    () => validatePortable(source),
    /text: Expected text up to 32 KiB/,
  );
  const deep = fixture();
  let root = deep.lists[0].nodes[0];
  root.children = [];
  for (let i = 0; i < 32; i++) {
    const child = { ...root, id: crypto.randomUUID(), children: [] };
    root.children = [child];
    root = child;
  }
  assert.throws(() => validatePortable(deep), /Maximum nesting/);
  assert.throws(
    () => parsePortable(' '.repeat(MAX_FILE_BYTES + 1)),
    /File exceeds 8 MiB/,
  );
});

test('lone Unicode surrogates are rejected before sending a file to the server', () => {
  const source = fixture();
  source.lists[0].nodes[0].text = '\ud800';
  assert.throws(() => validatePortable(source), /\.text/);
});

test('5000-item documents remain portable and the next item is rejected', () => {
  const doc = fixture();
  doc.lists = [doc.lists[0]];
  doc.lists[0].nodes = Array.from({ length: 5000 }, (_, index) => ({
    id: crypto.randomUUID(),
    kind: 'item',
    text: `Synthetic ${index}`,
    completed: false,
    children: [],
  }));
  assert.equal(countItems(parsePortable(serializePortable(doc))), 5000);
  doc.lists[0].nodes.push({
    id: crypto.randomUUID(),
    kind: 'item',
    text: 'One too many',
    completed: false,
    children: [],
  });
  assert.throws(() => validatePortable(doc), /5000 per list/);
});

test('legacy schemas upgrade to current; notes are supported from v2', () => {
  const old = JSON.parse(
    readFileSync(
      new URL('../../fixtures/portable-v1.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(validatePortable(old).schemaVersion, 3);
  old.lists[0].nodes[0].note = 'A note';
  assert.throws(() => validatePortable(old), /Unknown field/);
  old.schemaVersion = 2;
  old.lists[0].nodes[0].note = '**Literal**\n<script>text</script>';
  const roundtrip = parsePortable(serializePortable(validatePortable(old)));
  assert.equal(roundtrip.lists[0].nodes[0].note, old.lists[0].nodes[0].note);
  old.lists[0].nodes[0].note = 'a'.repeat(65537);
  assert.throws(() => validatePortable(old), /64 KiB/);
});

test('shared v2 fixture carries notes through portable export', () => {
  const source = parsePortable(
    readFileSync(
      new URL('../../fixtures/portable-v2.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(source.schemaVersion, 3);
  assert.equal(
    parsePortable(serializePortable(source)).lists[0].nodes[0].note,
    '**Trip details**\nBring the itinerary. ✈️',
  );
});

test('shared v3 fixture preserves tags and rejects tags in older versions', () => {
  const source = JSON.parse(
    readFileSync(
      new URL('../../fixtures/portable-v3.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(
    parsePortable(serializePortable(validatePortable(source))).lists[0].nodes[0]
      .tags,
    ['travel', 'planning'],
  );
  source.schemaVersion = 2;
  assert.throws(() => validatePortable(source), /Unknown field/);
});
