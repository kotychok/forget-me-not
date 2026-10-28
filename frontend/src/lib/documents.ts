import type { Document } from './api.ts';
import type { Item } from './editor.ts';
function sameItems(left: Item[], right: Item[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        item.id === other.id &&
        item.kind === other.kind &&
        item.text === other.text &&
        (item.note ?? '') === (other.note ?? '') &&
        JSON.stringify(item.tags ?? []) === JSON.stringify(other.tags ?? []) &&
        item.completed === other.completed &&
        sameItems(item.children, other.children)
      );
    })
  );
}
export function sameDocument(left: Document, right: Document): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    sameItems(left.nodes, right.nodes)
  );
}
