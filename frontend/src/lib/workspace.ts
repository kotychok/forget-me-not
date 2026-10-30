import { OutlineState } from './outline-state.ts';
import { Drafts } from './drafts.ts';
import type { Draft, DraftStorage } from './draft-storage.ts';
import { validatePortable } from './portable.ts';
import type { Portable } from './portable.ts';
import { api } from './api.ts';
import type { ListDocument, ListSummary } from './api.ts';
import { Autosave } from './autosave.ts';
import type { SaveStatus } from './autosave.ts';
import { Editor, visibleItems } from './editor.ts';
import { locate } from './editor.ts';
import { matches } from './search.ts';
import type { SearchHit } from './search.ts';

export type Session = {
  editor: Editor;
  title: string;
  sync: Autosave;
  collapsed: Set<string>;
  outline?: OutlineState;
  interactionBlocked?: boolean;
  titleEditing?: boolean;
  remoteChanged?: boolean;
};
export type SidebarList = ListSummary & { saveStatus?: SaveStatus };

/** Owns list sessions and API coordination; no DOM, Svelte, URLs, or dialogs. */
export class Workspace {
  lists: SidebarList[] = [];
  selectedId: string | null = null;
  loading = true;
  busy = false;
  error = '';
  refreshError = '';
  private refreshing = false;
  private activity = 0;
  private backgroundPaused = false;
  private disposed = false;
  private sessions = new Map<string, Session>();
  private transport: Omit<
    typeof api,
    'decodeFile' | 'encodeFile' | 'getView' | 'patchView'
  > &
    Partial<Pick<typeof api, 'getView' | 'patchView'>>;
  private notify: () => void;
  readonly drafts: Drafts | undefined;
  private draftIdentityReady = false;
  private authenticatedIdentity:
    { serverId: string; ownerId: string } | undefined;

  constructor(
    notify: () => void,
    transport: Omit<
      typeof api,
      'decodeFile' | 'encodeFile' | 'getView' | 'patchView'
    > &
      Partial<Pick<typeof api, 'getView' | 'patchView'>> = api,
    storage?: DraftStorage,
  ) {
    this.notify = notify;
    this.transport = transport;
    if (storage) this.drafts = new Drafts(storage, notify);
  }
  get current() {
    return this.selectedId ? this.sessions.get(this.selectedId) : undefined;
  }
  get title() {
    return this.current?.title ?? 'No lists yet';
  }
  get hasUnsaved() {
    return [...this.sessions.values()].some(
      (session) => session.sync.dirty || session.outline?.dirty,
    );
  }

  private document(id: string, session: Session) {
    return { id, title: session.title, nodes: session.editor.state.nodes };
  }
  private async initializeDrafts() {
    if (!this.drafts || this.draftIdentityReady) return;
    try {
      const identity = await this.transport.session();
      if (!identity.serverId || !identity.ownerId)
        throw new Error('Missing server identity');
      this.authenticatedIdentity = { ...identity };
      await this.drafts.initialize(identity.serverId, identity.ownerId);
      this.draftIdentityReady = true;
    } catch (error) {
      this.drafts.fail(
        error instanceof Error
          ? error.message
          : 'Draft identity could not be confirmed',
      );
    }
  }
  private async reconcileDrafts() {
    if (!this.drafts || !this.draftIdentityReady) return;
    for (const id of new Set(
      this.drafts.records.map((record) => record.document.id),
    )) {
      if (!this.lists.some((list) => list.id === id)) continue;
      try {
        await this.drafts.prune(await this.transport.get(id));
      } catch {
        this.drafts.fail(
          'Could not compare a draft with the server. Local versions were kept.',
        );
      }
    }
  }
  async refreshDrafts() {
    await this.initializeDrafts();
    await this.drafts?.refresh();
    await this.reconcileDrafts();
  }
  async retryDraftStorage() {
    await this.initializeDrafts();
    for (const [id, session] of this.sessions)
      this.drafts?.update(
        this.document(id, session),
        session.sync.revision,
        session.sync.dirty,
        true,
      );
    await this.drafts?.retry();
  }
  private sessionChanged(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.drafts?.update(
      this.document(id, session),
      session.sync.revision,
      session.sync.dirty,
    );
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
    const previous = this.sessions.get(document.id);
    if (previous?.outline) session.outline = previous.outline;
    else if (this.transport.getView && this.transport.patchView)
      session.outline = new OutlineState(
        document.id,
        {
          getView: (id) => this.transport.getView!(id),
          patchView: async (id, revision, changes) => {
            const current = this.sessions.get(id);
            if (current?.sync.dirty && !(await current.sync.flush()))
              throw new Error(
                'Save list changes before syncing outline preferences.',
              );
            return this.transport.patchView!(id, revision, changes);
          },
        },
        this.notify,
      );
    this.sessions.set(document.id, session);
    return session;
  }
  private async activate(id: string) {
    if (!this.sessions.has(id)) {
      const document = await this.transport.get(id);
      this.makeSession(document);
      await this.drafts?.prune(document);
      this.sessionChanged(id);
    }
    void this.sessions.get(id)?.outline?.refresh();
    this.selectedId = id;
  }
  async load(preferred: string | null) {
    this.activity++;
    this.loading = true;
    this.error = '';
    this.notify();
    try {
      await this.initializeDrafts();
      this.lists = await this.transport.lists();
      await this.reconcileDrafts();
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
  setInteractionBlocked(session: Session, blocked: boolean) {
    if (session.interactionBlocked === blocked) return;
    session.interactionBlocked = blocked;
    this.notify();
  }
  private canAcceptRemote(session: Session) {
    return (
      !session.sync.dirty &&
      session.sync.status === 'saved' &&
      session.editor.state.focus.mode !== 'edit' &&
      !session.interactionBlocked &&
      !session.titleEditing
    );
  }
  /** Poll summaries, then fetch changed cached lists only. Never replay local history. */
  async refreshRemote() {
    if (
      this.refreshing ||
      this.busy ||
      this.loading ||
      this.backgroundPaused ||
      this.disposed
    )
      return;
    this.refreshing = true;
    const activity = this.activity;
    try {
      const summaries = await this.transport.lists();
      if (
        this.busy ||
        this.backgroundPaused ||
        this.disposed ||
        activity !== this.activity
      )
        return;
      for (const [id, session] of this.sessions) {
        if (
          this.busy ||
          this.backgroundPaused ||
          this.disposed ||
          activity !== this.activity
        )
          return;
        const summary = summaries.find((list) => list.id === id);
        if (summary && summary.revision <= session.sync.revision) {
          session.remoteChanged = false;
          continue;
        }
        session.remoteChanged = true;
        if (!summary || !this.canAcceptRemote(session)) continue;
        const revision = session.sync.revision;
        const document = await this.transport.get(id);
        if (
          this.busy ||
          this.backgroundPaused ||
          this.disposed ||
          activity !== this.activity
        )
          return;
        if (
          this.sessions.get(id) !== session ||
          session.sync.revision !== revision ||
          !this.canAcceptRemote(session)
        )
          continue;
        const replacement = this.makeSession(document);
        replacement.collapsed = new Set(session.collapsed);
        const focus = session.editor.state.focus;
        if (locate(document.nodes, focus.id))
          replacement.editor.setFocus({ ...focus });
        session.sync.dispose();
        this.sessionChanged(id);
        await this.drafts?.prune(document);
      }
      if (
        this.busy ||
        this.backgroundPaused ||
        this.disposed ||
        activity !== this.activity
      )
        return;
      // Keep deleted cached lists available for explicit local-copy recovery.
      const merged = [...summaries];
      for (const [id, session] of this.sessions) {
        const entry = {
          id,
          title: session.title,
          revision: session.sync.revision,
          position:
            summaries.find((list) => list.id === id)?.position ?? merged.length,
          itemCount: visibleItems(session.editor.state.nodes, new Set()).length,
          saveStatus: session.sync.status,
        };
        const index = merged.findIndex((list) => list.id === id);
        if (index >= 0) merged[index] = entry;
        else merged.push(entry);
      }
      this.lists = merged;
      this.refreshError = '';
    } catch (error) {
      if (!this.backgroundPaused && !this.disposed)
        this.refreshError =
          error instanceof Error
            ? error.message
            : 'Could not check for remote changes';
    } finally {
      this.refreshing = false;
      if (!this.disposed) this.notify();
    }
  }
  async refreshOutline() {
    await this.current?.outline?.refresh();
  }
  async refreshIndex(): Promise<void> {
    if (this.busy) throw new Error('Another operation is in progress');
    this.busy = true;
    this.activity++;
    this.notify();
    try {
      this.lists = (await this.transport.lists()).map((list) => {
        const session = this.sessions.get(list.id);
        return session
          ? {
              ...list,
              title: session.title,
              revision: session.sync.revision,
              saveStatus: session.sync.status,
              itemCount: visibleItems(session.editor.state.nodes, new Set())
                .length,
            }
          : list;
      });
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  async open(id: string) {
    if (this.busy) return false;
    this.busy = true;
    this.activity++;
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
    this.activity++;
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
    this.activity++;
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
      session.outline?.dispose();
      await this.drafts?.release(
        this.document(id, session),
        session.sync.revision,
        false,
      );
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
  exportCurrent(): Portable {
    const session = this.current;
    if (!session || !this.selectedId) throw new Error('Choose a list first');
    return validatePortable({
      schemaVersion: 4,
      lists: [
        {
          id: this.selectedId,
          title: session.title,
          nodes: session.editor.state.nodes,
        },
      ],
    });
  }
  async searchSource() {
    // Read only: do not flush autosave or create editor sessions for search.
    const source = await this.transport.exportJson();
    const documents = new Map(source.lists.map((doc) => [doc.id, doc]));
    for (const [id, session] of this.sessions) {
      if (this.lists.some((list) => list.id === id))
        documents.set(id, structuredClone(this.document(id, session)));
    }
    return validatePortable({
      schemaVersion: 4,
      lists: [...documents.values()],
    }).lists;
  }
  async openSearchHit(hit: SearchHit, query: string) {
    if (this.busy) throw new Error('Another operation is in progress');
    this.busy = true;
    this.activity++;
    this.notify();
    try {
      const session = this.sessions.get(hit.listId);
      if (session) {
        // Confirm access/existence, but never replace a cached local version.
        await this.transport.get(hit.listId);
      } else {
        const document = await this.transport.get(hit.listId);
        if (hit.itemId && !locate(document.nodes, hit.itemId))
          throw new Error('This item was removed. Refresh search results.');
        this.makeSession(document);
      }
      const target = this.sessions.get(hit.listId)!;
      void target.outline?.refresh();
      if (hit.itemId && !locate(target.editor.state.nodes, hit.itemId))
        throw new Error(
          'This item was removed locally. Refresh search results.',
        );
      const text = hit.itemId
        ? hit.field === 'date'
          ? (locate(target.editor.state.nodes, hit.itemId)!.item.dueDate ?? '')
          : hit.field === 'note'
            ? (locate(target.editor.state.nodes, hit.itemId)!.item.note ?? '')
            : hit.field === 'tag'
              ? (locate(target.editor.state.nodes, hit.itemId)!.item.tags?.find(
                  (tag) => matches(tag, query),
                ) ?? '')
              : locate(target.editor.state.nodes, hit.itemId)!.item.text
        : target.title;
      if (!matches(text, query))
        throw new Error('This result changed. Refresh search results.');
      if (!this.lists.some((list) => list.id === hit.listId))
        this.lists = [
          ...this.lists,
          {
            id: hit.listId,
            title: target.title,
            revision: target.sync.revision,
            position: this.lists.length,
            itemCount: visibleItems(target.editor.state.nodes, new Set())
              .length,
          },
        ];
      this.selectedId = hit.listId;
      if (hit.itemId)
        target.editor.setFocus({
          id: hit.itemId,
          mode: 'navigate',
          start: 0,
          end: 0,
        });
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  async exportAll(): Promise<Portable> {
    if (this.busy) throw new Error('Another operation is in progress');
    this.busy = true;
    this.activity++;
    this.notify();
    try {
      for (const session of this.sessions.values()) {
        if (!(await session.sync.flush()))
          throw new Error(
            'Resolve unsaved changes first, or export the current list to keep its local edits.',
          );
      }
      return validatePortable(await this.transport.exportJson());
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  async importJson(document: Portable): Promise<number> {
    if (this.busy) throw new Error('Another operation is in progress');
    const validated = validatePortable(document);
    this.busy = true;
    this.activity++;
    this.error = '';
    this.notify();
    try {
      const imported = await this.transport.importJson(validated);
      this.lists = [...this.lists, ...imported];
      if (!this.selectedId && imported[0]) {
        try {
          await this.activate(imported[0].id);
        } catch {
          this.error = 'Import completed. Select a list to open it.';
        }
      }
      return imported.length;
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  async loadServerVersion(): Promise<void> {
    const session = this.current;
    const id = this.selectedId;
    if (!session || !id || this.busy) return;
    this.busy = true;
    this.activity++;
    this.error = '';
    this.notify();
    await session.sync.pause();
    try {
      const server = await this.transport.get(id);
      if (session.sync.dirty) {
        if (!this.drafts)
          throw new Error(
            'Local draft storage is unavailable. Save a local copy first.',
          );
        await this.drafts.preserve(
          this.document(id, session),
          session.sync.revision,
        );
      }
      session.sync.dispose();
      await this.drafts?.release(
        this.document(id, session),
        session.sync.revision,
        session.sync.dirty,
      );
      this.makeSession(server);
      this.sessionChanged(id);
      await this.drafts?.prune(server);
    } catch (error) {
      session.sync.resume();
      throw error;
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  async saveLocalCopy(): Promise<void> {
    const session = this.current;
    const id = this.selectedId;
    if (!session || !id || this.busy) return;
    this.busy = true;
    this.activity++;
    this.error = '';
    this.notify();
    await session.sync.pause();
    try {
      const source = this.exportCurrent();
      source.lists[0].title =
        [...source.lists[0].title].slice(0, 187).join('') + ' (local copy)';
      const imported = await this.transport.importJson(source);
      this.lists = [...this.lists, ...imported];
      const copy = await this.transport.get(imported[0].id);
      session.sync.dispose();
      await this.drafts?.release(
        this.document(id, session),
        session.sync.revision,
        false,
      );
      session.outline?.dispose();
      this.sessions.delete(id);
      this.makeSession(copy);
      this.selectedId = copy.id;
    } catch (error) {
      session.sync.resume();
      throw error;
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  async recoverDraft(record: Draft): Promise<void> {
    if (
      !this.drafts ||
      !this.drafts.records.some(
        (item) =>
          item.scope === record.scope &&
          item.id === record.id &&
          item.token === record.token,
      )
    )
      throw new Error('Refresh drafts before recovering this version.');
    if (this.busy) return;
    this.busy = true;
    this.activity++;
    this.error = '';
    this.notify();
    try {
      const source = validatePortable({
        schemaVersion: 4,
        lists: [record.document],
      });
      source.lists[0].title =
        [...source.lists[0].title].slice(0, 188).join('') + ' (recovered)';
      const imported = await this.transport.importJson(source);
      this.lists = [...this.lists, ...imported];
      const copy = await this.transport.get(imported[0].id);
      this.makeSession(copy);
      this.selectedId = copy.id;
      await this.drafts.consume(record);
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  async discardDraft(record: Draft) {
    await this.drafts?.discard(record);
  }
  async pauseForAuthentication() {
    this.activity++;
    this.backgroundPaused = true;
    await Promise.all(
      [...this.sessions.values()].map((session) => session.sync.pause()),
    );
  }
  async resumeAfterAuthentication() {
    if (this.authenticatedIdentity) {
      const identity = await this.transport.session();
      if (
        identity.serverId !== this.authenticatedIdentity.serverId ||
        identity.ownerId !== this.authenticatedIdentity.ownerId
      )
        throw new Error(
          'Installation identity changed. Download local edits, then reload before continuing. Browser drafts remain in the previous installation scope.',
        );
    }
    this.backgroundPaused = false;
    if (!this.sessions.size) {
      await this.load(this.selectedId);
      return;
    }
    for (const session of this.sessions.values()) {
      session.sync.resume();
      if (session.sync.status === 'error') await session.sync.retry();
      else if (session.sync.dirty) await session.sync.flush();
      await session.outline?.retry();
    }
  }
  async prepareLogout(keepDrafts = false) {
    for (const [id, session] of this.sessions) {
      if (!keepDrafts && session.sync.dirty && !(await session.sync.flush()))
        throw new Error(
          'Some edits could not be saved. Download local edits or keep browser drafts before signing out.',
        );
      if (!keepDrafts) {
        await session.outline?.flush();
        if (session.outline?.dirty)
          throw new Error(
            'Outline preferences are not saved. Retry or explicitly keep local drafts and sign out.',
          );
      }
      await session.sync.pause();
      if (session.sync.dirty) {
        if (!this.drafts)
          throw new Error(
            'Local draft storage is unavailable. Download your edits first.',
          );
        await this.drafts.preserve(
          this.document(id, session),
          session.sync.revision,
        );
      }
    }
  }
  localEdits(): Portable {
    const dirty = [...this.sessions].filter(
      ([, session]) => session.sync.dirty,
    );
    const source = dirty.length
      ? dirty
      : this.current && this.selectedId
        ? [[this.selectedId, this.current] as const]
        : [];
    return validatePortable({
      schemaVersion: 4,
      lists: source.map(([id, session]) => this.document(id, session)),
    });
  }
  dispose() {
    this.disposed = true;
    this.sessions.forEach((session) => {
      session.sync.dispose();
      session.outline?.dispose();
    });
  }
}
