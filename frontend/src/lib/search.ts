import type { Document } from './api.ts';
import type { Item } from './editor.ts';

export type SearchHit = {
  listId: string;
  title: string;
  itemId: string | null;
  field?: 'note' | 'tag' | 'date';
  text: string;
  ancestors: string[];
};
export function matchParts(text: string, query: string) {
  const needle = query.trim();
  if (!needle) return [{ text, match: false }];
  const regex = new RegExp(
    needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'giu',
  );
  const parts: { text: string; match: boolean }[] = [];
  let offset = 0;
  for (const match of text.matchAll(regex)) {
    if (match.index > offset)
      parts.push({ text: text.slice(offset, match.index), match: false });
    parts.push({ text: match[0], match: true });
    offset = match.index + match[0].length;
  }
  if (offset < text.length)
    parts.push({ text: text.slice(offset), match: false });
  return parts;
}
export function matches(text: string, query: string) {
  return !!query.trim() && matchParts(text, query).some((part) => part.match);
}
export function snippet(text: string, query: string) {
  const parts = matchParts(text, query);
  const start = parts[0]?.match ? 0 : (parts[0]?.text.length ?? 0);
  const from = Math.max(0, start - 60);
  const end = Math.min(
    text.length,
    Math.max(from + 180, start + query.trim().length),
  );
  return `${from ? '…' : ''}${text.slice(from, end)}${end < text.length ? '…' : ''}`;
}
export function searchDocuments(
  documents: Document[],
  query: string,
  limit = 200,
) {
  const hits: SearchHit[] = [];
  let total = 0;
  const add = (hit: SearchHit) => {
    total++;
    if (hits.length < limit) hits.push(hit);
  };
  if (!query.trim()) return { hits, total };
  for (const doc of documents) {
    const base = { listId: doc.id, title: doc.title };
    if (matches(doc.title, query))
      add({ ...base, itemId: null, text: doc.title, ancestors: [] });
    function visit(nodes: Item[], ancestors: string[]) {
      for (const item of nodes) {
        if (matches(item.text, query))
          add({ ...base, itemId: item.id, text: item.text, ancestors });
        if (item.dueDate && matches(item.dueDate, query))
          add({
            ...base,
            itemId: item.id,
            text: item.dueDate,
            ancestors: [...ancestors, item.text || 'Empty item'],
            field: 'date',
          });
        if (item.note && matches(item.note, query))
          add({
            ...base,
            itemId: item.id,
            text: item.note!,
            ancestors: [...ancestors, item.text || 'Empty item'],
            field: 'note',
          });
        if (item.tags?.some((tag) => matches(tag, query)))
          add({
            ...base,
            itemId: item.id,
            text: item.tags.join(', '),
            ancestors: [...ancestors, item.text || 'Empty item'],
            field: 'tag',
          });
        visit(item.children, [...ancestors, item.text || 'Empty item']);
      }
    }
    visit(doc.nodes, []);
  }
  return { hits, total };
}
