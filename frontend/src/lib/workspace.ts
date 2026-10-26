import { api } from './api.ts';
import type { ListDocument, ListSummary } from './api.ts';
import { Autosave } from './autosave.ts';
import type { SaveStatus } from './autosave.ts';
import { Editor, visibleItems } from './editor.ts';

export type Session = {
  editor: Editor;
  title: string;
  sync: Autosave;
  collapsed: Set<string>;
};
export type SidebarList = ListSummary & { saveStatus?: SaveStatus };

/** Owns list sessions and API coordination; no DOM, Svelte, URLs, or dialogs. */
export class Workspace {
  lists: SidebarList[] = [];
  selectedId: string | null = null;
  loading = true;
  busy = false;
  error = '';
  private sessions = new Map<string, Session>();
  private transport: typeof api;
  private notify: () => void;

  constructor(notify: () => void, transport = api) {
    this.notify = notify;
    this.transport = transport;
  }
  get current() {
    return this.selectedId ? this.sessions.get(this.selectedId) : undefined;
  }
  get title() {
    return this.current?.title ?? 'No lists yet';
  }
  get hasUnsaved() {
    return [...this.sessions.values()].some((session) => session.sync.dirty);
  }

  private sessionChanged(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.lists = this.lists.map((list) =>
      list.id === id
        ? {
            ...list,
            title: session.title,
            revision: session.sync.revision,
            saveStatus: session.sync.status,
            itemCount: visibleItems(session.editor.state.nodes, new Set())
              .length,
          }
        : list,
    );
    this.notify();
  }
  private makeSession(document: ListDocument) {
    const session: Session = {
      editor: new Editor(document.nodes),
      title: document.title,
      collapsed: new Set(),
      sync: new Autosave(
        document.revision,
        () => ({
          id: document.id,
          title: session.title,
          nodes: session.editor.state.nodes,
        }),
        this.transport,
        () => this.sessionChanged(document.id),
      ),
    };
    this.sessions.set(document.id, session);
    return session;
  }
  private async activate(id: string) {
    if (!this.sessions.has(id)) this.makeSession(await this.transport.get(id));
    this.selectedId = id;
  }
  async load(preferred: string | null) {
    this.loading = true;
    this.error = '';
    this.notify();
    try {
      this.lists = await this.transport.lists();
      const id =
        this.lists.find((list) => list.id === preferred)?.id ??
        this.lists[0]?.id;
      if (id) await this.open(id);
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Could not load lists';
    } finally {
      this.loading = false;
      this.notify();
    }
  }
  async open(id: string) {
    if (this.busy) return false;
    this.busy = true;
    this.error = '';
    this.notify();
    try {
      await this.activate(id);
      return true;
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Could not open list';
      return false;
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  async create() {
    if (this.busy) return false;
    this.busy = true;
    this.error = '';
    this.notify();
    try {
      const document = await this.transport.create('Untitled list');
      this.lists = [
        ...this.lists,
        {
          id: document.id,
          title: document.title,
          revision: document.revision,
          position: this.lists.length,
          itemCount: 0,
        },
      ];
      this.makeSession(document);
      this.selectedId = document.id;
      return true;
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Could not create list';
      return false;
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  rename(title: string) {
    const next = title.trim();
    if (!this.current || !next || [...next].length > 200 || next === this.title)
      return;
    this.current.title = next;
    this.current.sync.markDirty();
  }
  async removeCurrent() {
    const session = this.current;
    const id = this.selectedId;
    if (!session || !id || this.busy) return false;
    this.busy = true;
    this.error = '';
    this.notify();
    try {
      if (!(await session.sync.flush())) {
        this.error =
          'Resolve the save error or conflict before deleting this list.';
        return false;
      }
      await this.transport.delete(id, session.sync.revision);
      session.sync.dispose();
      this.sessions.delete(id);
      this.lists = this.lists.filter((list) => list.id !== id);
      this.selectedId = null;
      if (this.lists[0]) await this.activate(this.lists[0].id);
      return true;
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Could not delete list';
      return false;
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  dispose() {
    this.sessions.forEach((session) => session.sync.dispose());
  }
}
