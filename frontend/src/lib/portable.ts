import type { Document } from './api.ts';
import type { Item } from './editor.ts';

export type Portable = { schemaVersion: 1 | 2; lists: Document[] };
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_LISTS = 100;
export const MAX_TOTAL_ITEMS = 10_000;
const encoder = new TextEncoder();
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}
function object(
  value: unknown,
  fields: string[],
  path: string,
  optional: string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(path, 'Expected an object');
  const record = value as Record<string, unknown>;
  for (const field of Object.keys(record))
    if (!fields.includes(field) && !optional.includes(field))
      fail(`${path}.${field}`, 'Unknown field');
  for (const field of fields)
    if (!Object.hasOwn(record, field))
      fail(`${path}.${field}`, 'Missing field');
  return record;
}
function wellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function id(value: unknown, path: string, seen: Set<string>) {
  if (typeof value !== 'string' || !uuid.test(value))
    fail(path, 'Expected a canonical UUIDv4');
  if (seen.has(value)) fail(path, 'Duplicate ID');
  seen.add(value);
  return value;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'Expected an array');
  return value;
}

/** Pure validation/conversion: no DOM, HTTP, persistence, or Markdown interpretation. */
export function validatePortable(value: unknown): Portable {
  const root = object(value, ['schemaVersion', 'lists'], '$');
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2)
    fail('$.schemaVersion', 'Only schema versions 1 and 2 are supported');
  const source = array(root.lists, '$.lists');
  if (!source.length || source.length > MAX_LISTS)
    fail('$.lists', `Expected 1–${MAX_LISTS} lists`);
  const listIds = new Set<string>();
  const itemIds = new Set<string>();
  let total = 0;
  const lists = source.map((value, index): Document => {
    const path = `$.lists[${index}]`;
    const list = object(value, ['id', 'title', 'nodes'], path);
    const listId = id(list.id, `${path}.id`, listIds);
    if (
      typeof list.title !== 'string' ||
      !wellFormed(list.title) ||
      !list.title.trim() ||
      [...list.title].length > 200
    )
      fail(`${path}.title`, 'Expected 1–200 characters');
    let count = 0;
    function nodes(value: unknown, path: string, depth: number): Item[] {
      return array(value, path).map((value, index) => {
        const at = `${path}[${index}]`;
        const item = object(
          value,
          ['id', 'kind', 'text', 'completed', 'children'],
          at,
          root.schemaVersion === 2 ? ['note'] : [],
        );
        if (depth > 32) fail(at, 'Maximum nesting is 32 levels');
        if (++count > 5000 || ++total > MAX_TOTAL_ITEMS)
          fail(at, 'Too many items (5000 per list; 10000 per file)');
        const itemId = id(item.id, `${at}.id`, itemIds);
        if (item.kind !== 'item' && item.kind !== 'task')
          fail(`${at}.kind`, 'Expected item or task');
        if (
          typeof item.text !== 'string' ||
          !wellFormed(item.text) ||
          encoder.encode(item.text).length > 32768
        )
          fail(`${at}.text`, 'Expected text up to 32 KiB');
        if (
          typeof item.completed !== 'boolean' ||
          (item.kind === 'item' && item.completed)
        )
          fail(
            `${at}.completed`,
            'Expected boolean; plain items cannot be completed',
          );
        if (
          Object.hasOwn(item, 'note') &&
          (typeof item.note !== 'string' ||
            !wellFormed(item.note) ||
            encoder.encode(item.note).length > 65536)
        )
          fail(`${at}.note`, 'Expected note text up to 64 KiB');
        return {
          ...(item.note ? { note: item.note as string } : {}),
          id: itemId,
          kind: item.kind,
          text: item.text,
          completed: item.completed,
          children: nodes(item.children, `${at}.children`, depth + 1),
        };
      });
    }
    const document = {
      id: listId,
      title: list.title,
      nodes: nodes(list.nodes, `${path}.nodes`, 1),
    };
    // Every imported list must remain saveable through the normal snapshot API.
    if (
      encoder.encode(JSON.stringify({ baseRevision: 0, document })).length >
      1024 * 1024
    )
      fail(path, 'List exceeds the 1 MiB save limit');
    return document;
  });
  const result: Portable = { schemaVersion: 2, lists };
  if (encoder.encode(JSON.stringify(result)).length > MAX_FILE_BYTES)
    fail('$', 'File exceeds 8 MiB');
  return result;
}
export function parsePortable(text: string): Portable {
  if (encoder.encode(text).length > MAX_FILE_BYTES)
    fail('$', 'File exceeds 8 MiB');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('$', 'Invalid JSON');
  }
  return validatePortable(value);
}
export function serializePortable(value: Portable): string {
  return JSON.stringify(validatePortable(value));
}
export function countItems(value: Portable): number {
  let count = 0;
  const pending = value.lists.flatMap((list) => list.nodes);
  while (pending.length) {
    const item = pending.pop()!;
    count++;
    pending.push(...item.children);
  }
  return count;
}
