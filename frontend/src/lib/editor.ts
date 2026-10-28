import { validDate } from './dates.ts';
import { validateTags } from './tags.ts';
export type Item = {
  id: string;
  kind: 'item' | 'task';
  text: string;
  note?: string;
  tags?: string[];
  dueDate?: string;
  completed: boolean;
  children: Item[];
};
export type Focus = {
  id: string | null;
  mode: 'navigate' | 'edit';
  start: number;
  end: number;
};
export type Snapshot = { nodes: Item[]; focus: Focus };
export type Command =
  | 'add'
  | 'indent'
  | 'outdent'
  | 'up'
  | 'down'
  | 'delete'
  | 'convert'
  | 'complete';
export type Location = {
  item: Item;
  siblings: Item[];
  index: number;
  parent: Item | null;
};

export function createItem(text = '', kind: Item['kind'] = 'item'): Item {
  return {
    id: crypto.randomUUID(),
    kind,
    text,
    completed: false,
    children: [],
  };
}

export function locate(
  nodes: Item[],
  id: string | null,
  parent: Item | null = null,
): Location | null {
  for (let index = 0; index < nodes.length; index++) {
    const item = nodes[index];
    if (item.id === id) return { item, siblings: nodes, index, parent };
    const child = locate(item.children, id, item);
    if (child) return child;
  }
  return null;
}

export function visibleItems(
  nodes: Item[],
  collapsed: ReadonlySet<string>,
  depth = 0,
): { item: Item; depth: number }[] {
  return nodes.flatMap((item) => [
    { item, depth },
    ...(collapsed.has(item.id)
      ? []
      : visibleItems(item.children, collapsed, depth + 1)),
  ]);
}

export class Editor {
  state: Snapshot;
  past: Snapshot[] = [];
  future: Snapshot[] = [];
  private group: { id: string; time: number } | null = null;
  private pendingAdd: {
    id: string | null;
    state: Snapshot;
    past: Snapshot[];
    future: Snapshot[];
  } | null = null;

  constructor(nodes: Item[]) {
    this.state = {
      nodes: structuredClone(nodes),
      focus: { id: nodes[0]?.id ?? null, mode: 'navigate', start: 0, end: 0 },
    };
  }

  breakGroup() {
    this.group = null;
  }

  setFocus(focus: Focus) {
    if (
      focus.id !== this.state.focus.id ||
      focus.mode !== this.state.focus.mode
    ) {
      this.breakGroup();
      this.pendingAdd = null;
    }
    this.state = { ...this.state, focus: { ...focus } };
  }

  private commit(next: Snapshot, grouped = false) {
    if (!grouped) this.past.push(structuredClone(this.state));
    // Bound session history to avoid unbounded growth during a long editing session.
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.state = next;
  }

  edit(text: string, start: number, end: number, now = Date.now()) {
    const id = this.state.focus.id;
    const current = locate(this.state.nodes, id);
    if (!current || current.item.text === text) return false;
    this.pendingAdd = null;
    const next = structuredClone(this.state);
    locate(next.nodes, id)!.item.text = text;
    next.focus = { id, mode: 'edit', start, end };
    const grouped = this.group?.id === id && now - this.group.time < 750;
    this.commit(next, grouped);
    this.group = { id: id!, time: now };
    return true;
  }

  setNote(id: string, note: string) {
    const current = locate(this.state.nodes, id);
    if (!current || (current.item.note ?? '') === note) return false;
    this.breakGroup();
    this.pendingAdd = null;
    const next = structuredClone(this.state);
    const item = locate(next.nodes, id)!.item;
    if (note) item.note = note;
    else delete item.note;
    this.commit(next);
    return true;
  }

  setDueDate(id: string, date: string) {
    if (date && !validDate(date))
      throw new Error('Expected a real calendar date YYYY-MM-DD');
    const current = locate(this.state.nodes, id);
    if (!current || (current.item.dueDate ?? '') === date) return false;
    this.breakGroup();
    this.pendingAdd = null;
    const next = structuredClone(this.state);
    const item = locate(next.nodes, id)!.item;
    if (date) item.dueDate = date;
    else delete item.dueDate;
    this.commit(next);
    return true;
  }

  setTags(id: string, value: string[]) {
    const tags = validateTags(value);
    const current = locate(this.state.nodes, id);
    if (
      !current ||
      JSON.stringify(current.item.tags ?? []) === JSON.stringify(tags)
    )
      return false;
    this.breakGroup();
    this.pendingAdd = null;
    const next = structuredClone(this.state);
    const item = locate(next.nodes, id)!.item;
    if (tags.length) item.tags = tags;
    else delete item.tags;
    this.commit(next);
    return true;
  }

  execute(command: Command, collapsed: ReadonlySet<string> = new Set()) {
    this.breakGroup();
    const next = structuredClone(this.state);
    const at = locate(next.nodes, next.focus.id);
    if (command === 'add') {
      const item = createItem();
      if (at) at.siblings.splice(at.index + 1, 0, item);
      else next.nodes.push(item);
      next.focus = { id: item.id, mode: 'edit', start: 0, end: 0 };
    } else {
      if (!at) return false;
      const { item, siblings, index, parent } = at;
      if (command === 'indent') {
        if (index === 0) return false;
        siblings[index - 1].children.push(...siblings.splice(index, 1));
      } else if (command === 'outdent') {
        if (!parent) return false;
        const above = locate(next.nodes, parent.id)!;
        above.siblings.splice(above.index + 1, 0, ...siblings.splice(index, 1));
      } else if (command === 'up' || command === 'down') {
        const target = index + (command === 'up' ? -1 : 1);
        if (target < 0 || target >= siblings.length) return false;
        [siblings[index], siblings[target]] = [
          siblings[target],
          siblings[index],
        ];
      } else if (command === 'convert') {
        item.kind = item.kind === 'item' ? 'task' : 'item';
        item.completed = false;
      } else if (command === 'complete') {
        if (item.kind !== 'task') return false;
        item.completed = !item.completed;
      } else if (command === 'delete') {
        const before = visibleItems(next.nodes, collapsed).map(
          ({ item }) => item.id,
        );
        const offset = before.indexOf(item.id);
        siblings.splice(index, 1);
        const remaining = new Set(
          visibleItems(next.nodes, collapsed).map(({ item }) => item.id),
        );
        const id =
          before.slice(offset + 1).find((id) => remaining.has(id)) ??
          before
            .slice(0, offset)
            .reverse()
            .find((id) => remaining.has(id)) ??
          null;
        next.focus = { id, mode: 'navigate', start: 0, end: 0 };
      }
    }
    const pendingAdd =
      command === 'add'
        ? {
            id: next.focus.id,
            state: structuredClone(this.state),
            past: [...this.past],
            future: [...this.future],
          }
        : null;
    this.commit(next);
    this.pendingAdd = pendingAdd;
    return true;
  }

  cancelNewItem() {
    const pending = this.pendingAdd;
    if (!pending || this.state.focus.id !== pending.id) return false;
    this.state = pending.state;
    this.state.focus.mode = 'navigate';
    this.past = pending.past;
    this.future = pending.future;
    this.pendingAdd = null;
    this.breakGroup();
    return true;
  }

  undo() {
    this.pendingAdd = null;
    this.breakGroup();
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(structuredClone(this.state));
    this.state = previous;
    return true;
  }

  redo() {
    this.pendingAdd = null;
    this.breakGroup();
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(structuredClone(this.state));
    this.state = next;
    return true;
  }
}
