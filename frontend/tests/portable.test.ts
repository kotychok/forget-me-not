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
  source = { ...fixture(), schemaVersion: 2 };
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
