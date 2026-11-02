/** Pure baseline-to-target planner; no editor history, network or Svelte state. */
import type { Document } from './api.ts';
import type { Item } from './editor.ts';
import { sameDocument } from './documents.ts';
export type Changes = Partial<
  Pick<Item, 'kind' | 'text' | 'completed' | 'note' | 'tags'>
> & { dueDate?: string | null };
export type Operation =
  | { type: 'update'; itemId: string; changes: Changes }
  | {
      type: 'create';
      item: Omit<Item, 'children'>;
      parentId: string | null;
      afterId: string | null;
    }
  | {
      type: 'move';
      itemId: string;
      parentId: string | null;
      afterId: string | null;
    }
  | { type: 'remove'; itemId: string };
export type Batch = {
  protocolVersion: 1;
  operationId: string;
  baseRevision: number;
  title?: string;
  ops: Operation[];
};
type Entry = { item: Item; parent: string | null };
function leaf(item: Item): Item {
  return {
    id: item.id,
    kind: item.kind,
    text: item.text,
    completed: item.completed,
    ...(item.note ? { note: item.note } : {}),
    ...(item.tags?.length ? { tags: [...item.tags] } : {}),
    ...(item.dueDate ? { dueDate: item.dueDate } : {}),
    children: [],
  };
}
export function planChanges(
  base: Document,
  target: Document,
  revision: number,
  operationId: string,
): Batch | undefined {
  if (base.id !== target.id) return;
  const entries = new Map<string, Entry>();
  const groups = new Map<string | null, string[]>([[null, []]]);
  const previous = new Map<string, string | null>();
  function reindex(parent: string | null) {
    let prev: string | null = null;
    for (const id of groups.get(parent) ?? []) {
      previous.set(id, prev);
      prev = id;
    }
  }
  function seed(nodes: Item[], parent: string | null, depth: number) {
    if (nodes.length && depth > 32) throw new Error('Invalid baseline');
    groups.set(
      parent,
      nodes.map((n) => n.id),
    );
    for (const node of nodes) {
      if (entries.has(node.id) || entries.size >= 5000)
        throw new Error('Invalid baseline');
      entries.set(node.id, { item: leaf(node), parent });
      seed(node.children, node.id, depth + 1);
    }
    reindex(parent);
  }
  const wanted = new Set<string>();
  const visited = new Set<string>();
  const batch: Batch = {
    protocolVersion: 1,
    operationId,
    baseRevision: revision,
    ...(base.title !== target.title ? { title: target.title } : {}),
    ops: [],
  };
  let creates = 0;
  let baselineCount = 0;
  function bounded() {
    if (
      batch.ops.length > 10000 ||
      entries.size > 10000 ||
      (baselineCount + creates) * Math.max(1, batch.ops.length) > 2_000_000
    )
      throw new Error('Use snapshot');
  }
  function position(id: string, parent: string | null, after: string | null) {
    const entry = entries.get(id)!;
    for (
      let at = parent, depth = 0;
      at !== null;
      at = entries.get(at)?.parent ?? null
    ) {
      if (at === id || ++depth > 63) throw new Error('Invalid move');
    }
    const old = groups.get(entry.parent)!;
    old.splice(old.indexOf(id), 1);
    reindex(entry.parent);
    const next = groups.get(parent);
    if (!next || (after !== null && !next.includes(after)))
      throw new Error('Invalid anchor');
    next.splice(after === null ? 0 : next.indexOf(after) + 1, 0, id);
    entry.parent = parent;
    reindex(parent);
  }
  function visit(nodes: Item[], parent: string | null, depth: number) {
    if (nodes.length && depth > 32) throw new Error('Invalid target');
    let after: string | null = null;
    for (const node of nodes) {
      if (visited.has(node.id) || visited.size >= 5000)
        throw new Error('Invalid target');
      visited.add(node.id);
      let entry = entries.get(node.id);
      if (!entry) {
        creates++;
        const item = leaf(node);
        const { children: _children, ...fields } = item;
        batch.ops.push({
          type: 'create',
          item: fields,
          parentId: parent,
          afterId: after,
        });
        bounded();
        entry = { item, parent };
        entries.set(node.id, entry);
        groups.set(node.id, []);
        const group = groups.get(parent)!;
        group.splice(after === null ? 0 : group.indexOf(after) + 1, 0, node.id);
        reindex(parent);
      } else {
        if (entry.parent !== parent || previous.get(node.id) !== after) {
          batch.ops.push({
            type: 'move',
            itemId: node.id,
            parentId: parent,
            afterId: after,
          });
          bounded();
          position(node.id, parent, after);
          prune();
        }
        const changes: Changes = {};
        if (entry.item.text !== node.text) changes.text = node.text;
        if ((entry.item.note ?? '') !== (node.note ?? ''))
          changes.note = node.note ?? '';
        if (
          JSON.stringify(entry.item.tags ?? []) !==
          JSON.stringify(node.tags ?? [])
        )
          changes.tags = [...(node.tags ?? [])];
        if ((entry.item.dueDate ?? '') !== (node.dueDate ?? ''))
          changes.dueDate = node.dueDate ?? null;
        if (entry.item.kind !== node.kind) changes.kind = node.kind;
        if (entry.item.completed !== node.completed)
          changes.completed = node.completed;
        if (Object.keys(changes).length) {
          batch.ops.push({ type: 'update', itemId: node.id, changes });
          bounded();
          entry.item = leaf(node);
        }
      }
      bounded();
      visit(node.children, node.id, depth + 1);
      after = node.id;
    }
  }
  function erase(id: string) {
    if (wanted.has(id)) throw new Error('Surviving descendant');
    for (const child of groups.get(id) ?? []) erase(child);
    groups.delete(id);
    entries.delete(id);
    previous.delete(id);
  }
  function clean(parent: string | null) {
    const group = groups.get(parent)!;
    for (const id of [...group]) {
      if (!wanted.has(id)) {
        batch.ops.push({ type: 'remove', itemId: id });
        bounded();
        erase(id);
        group.splice(group.indexOf(id), 1);
      } else clean(id);
    }
    reindex(parent);
  }
  function prune() {
    const keep = new Set<string>();
    function mark(parent: string | null): boolean {
      let any = false;
      for (const id of groups.get(parent) ?? []) {
        const children = mark(id);
        if (wanted.has(id) || children) {
          keep.add(id);
          any = true;
        }
      }
      return any;
    }
    mark(null);
    function discard(parent: string | null) {
      const group = groups.get(parent)!;
      for (const id of [...group]) {
        if (!keep.has(id)) {
          batch.ops.push({ type: 'remove', itemId: id });
          bounded();
          erase(id);
          group.splice(group.indexOf(id), 1);
        } else discard(id);
      }
      reindex(parent);
    }
    discard(null);
  }
  function rebuild(parent: string | null, depth = 1): Item[] {
    if (depth > 33) throw new Error('Invalid result');
    return (groups.get(parent) ?? []).map((id) => ({
      ...entries.get(id)!.item,
      children: rebuild(id, depth + 1),
    }));
  }
  try {
    seed(base.nodes, null, 1);
    baselineCount = entries.size;
    const collect = (nodes: Item[], depth = 1) => {
      if (nodes.length && depth > 32) throw new Error('Invalid target');
      for (const node of nodes) {
        if (wanted.has(node.id) || wanted.size >= 5000)
          throw new Error('Invalid target');
        wanted.add(node.id);
        collect(node.children, depth + 1);
      }
    };
    collect(target.nodes);
    prune();
    visit(target.nodes, null, 1);
    clean(null);
    if (
      !sameDocument(
        { id: base.id, title: target.title, nodes: rebuild(null) },
        target,
      )
    )
      return;
    if (!batch.ops.length && batch.title === undefined) return;
    return batch;
  } catch {
    return;
  }
}
