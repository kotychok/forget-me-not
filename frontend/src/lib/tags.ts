import type { Item } from './editor.ts';

export function validateTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 12)
    throw new Error('An item can have at most 12 tags');
  const seen = new Set<string>();
  for (const tag of value) {
    if (
      typeof tag !== 'string' ||
      !tag ||
      [...tag].length > 40 ||
      tag.trim() !== tag ||
      /[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF,]/u.test(tag)
    )
      throw new Error(
        'Tags need 1–40 characters without surrounding whitespace, commas or control characters',
      );
    if (seen.has(tag)) throw new Error('Duplicate tag names are not allowed');
    seen.add(tag);
  }
  return [...seen];
}
export function parseTags(text: string): string[] {
  return validateTags(
    text.trim() ? text.split(',').map((name) => name.trim()) : [],
  );
}
export function tagNames(nodes: Item[]): string[] {
  const names = new Set<string>();
  function visit(items: Item[]) {
    for (const item of items) {
      for (const tag of item.tags ?? []) names.add(tag);
      visit(item.children);
    }
  }
  visit(nodes);
  return [...names].sort();
}
/** Projection only: exact tag matches and their ancestor paths in original tree order. */
export function taggedItems(
  nodes: Item[],
  tag: string,
  depth = 0,
): { item: Item; depth: number; match: boolean }[] {
  return nodes.flatMap((item) => {
    const children = taggedItems(item.children, tag, depth + 1);
    const match = item.tags?.includes(tag) ?? false;
    return match || children.length
      ? [{ item, depth, match }, ...children]
      : [];
  });
}
