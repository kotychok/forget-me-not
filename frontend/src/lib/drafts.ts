import type { Document, ListDocument } from './api.ts';
import type { Draft, DraftStorage } from './draft-storage.ts';
import { sameDocument } from './documents.ts';

/** Serialized writes per tab/list prevent an older acknowledgement deleting a newer draft. */
class DraftWriter {
  readonly id = crypto.randomUUID();
  error = '';
  private latest: Draft | undefined;
  private dirty = false;
  private persistedToken: string | undefined;
  private tail = Promise.resolve();
  private storage: DraftStorage;
  private scope: string;
  private notify: () => void;
  constructor(storage: DraftStorage, scope: string, notify: () => void) {
    this.storage = storage;
    this.scope = scope;
    this.notify = notify;
  }
  get durable() {
    return this.dirty && this.latest?.token === this.persistedToken;
  }
  private enqueue(task: () => Promise<unknown>) {
    this.tail = this.tail
      .then(task)
      .then(() => {
        this.error = '';
        this.notify();
      })
      .catch((error) => {
        this.error =
          error instanceof Error ? error.message : 'Local draft write failed';
        this.notify();
      });
  }
  update(document: Document, revision: number, dirty: boolean, force = false) {
    this.dirty = dirty;
    if (!dirty) {
      if (this.latest) {
        const draft = this.latest;
        this.enqueue(() =>
          this.storage.remove(draft.scope, draft.id, draft.token),
        );
      }
      return;
    }
    if (
      !force &&
      !this.error &&
      this.latest?.baseRevision === revision &&
      sameDocument(this.latest.document, document)
    )
      return;
    const draft: Draft = {
      id: this.id,
      scope: this.scope,
      token: crypto.randomUUID(),
      formatVersion: 1,
      baseRevision: revision,
      updatedAt: Date.now(),
      document: structuredClone(document),
    };
    this.latest = draft;
    this.enqueue(async () => {
      await this.storage.put(draft);
      this.persistedToken = draft.token;
    });
  }
  retry() {
    if (this.latest)
      this.update(
        this.latest.document,
        this.latest.baseRevision,
        this.dirty,
        true,
      );
  }
  async flush() {
    await this.tail;
    if (this.error) throw new Error(this.error);
  }
}

/** Scoped draft lifecycle; no Svelte or DOM. Each page owns distinct writer IDs. */
export class Drafts {
  records: Draft[] = [];
  private storage: DraftStorage;
  private scope: string | undefined;
  private notify: () => void;
  private writers = new Map<string, DraftWriter>();
  private readError = '';
  constructor(storage: DraftStorage, notify: () => void) {
    this.storage = storage;
    this.notify = notify;
  }
  isDurable(id: string) {
    return this.writers.get(id)?.durable ?? false;
  }
  fail(message: string) {
    this.readError = message;
    this.notify();
  }
  get error() {
    return (
      this.readError ||
      [...this.writers.values()].find((writer) => writer.error)?.error ||
      ''
    );
  }
  async initialize(serverId: string, ownerId: string) {
    const scope = JSON.stringify([serverId, ownerId]);
    if (this.scope !== scope) {
      this.records = [];
      this.readError = '';
      this.notify();
      if (this.scope && this.writers.size) {
        const previous = [...this.writers.values()];
        this.writers.clear();
        this.scope = undefined;
        await Promise.all(
          previous.map((writer) => writer.flush().catch(() => {})),
        );
        throw new Error(
          'Identity changed. Open a new workspace before editing.',
        );
      }
    }
    this.scope = scope;
    await this.refresh();
  }
  async refresh() {
    if (!this.scope) return;
    try {
      const owned = new Set<string>(
        [...this.writers.values()].map((writer) => writer.id),
      );
      this.records = (await this.storage.list(this.scope)).filter(
        (record) => !owned.has(record.id),
      );
      this.readError = '';
    } catch (error) {
      this.readError =
        error instanceof Error ? error.message : 'Could not read local drafts';
    }
    this.notify();
  }
  update(document: Document, revision: number, dirty: boolean, force = false) {
    if (!this.scope) return;
    let writer = this.writers.get(document.id);
    if (!writer && dirty) {
      writer = new DraftWriter(this.storage, this.scope, this.notify);
      this.writers.set(document.id, writer);
    }
    writer?.update(document, revision, dirty, force);
  }
  async preserve(document: Document, revision: number) {
    this.update(document, revision, true, true);
    const writer = this.writers.get(document.id);
    if (!writer) throw new Error('Draft identity is unavailable');
    await writer.flush();
  }
  async release(document: Document, revision: number, keep: boolean) {
    const writer = this.writers.get(document.id);
    if (writer) {
      if (!keep) writer.update(document, revision, false);
      try {
        await writer.flush();
      } catch (error) {
        this.readError =
          error instanceof Error ? error.message : 'Local draft storage failed';
      }
      this.writers.delete(document.id);
    }
    await this.refresh();
  }
  async prune(saved: ListDocument) {
    if (!this.scope) return;
    for (const record of this.records.filter((record) =>
      sameDocument(record.document, saved),
    )) {
      try {
        await this.storage.remove(this.scope, record.id, record.token);
      } catch (error) {
        this.readError =
          error instanceof Error
            ? error.message
            : 'Could not clean up an acknowledged draft';
        this.notify();
        return;
      }
    }
    await this.refresh();
  }
  async consume(record: Draft): Promise<boolean> {
    if (!this.scope || record.scope !== this.scope)
      throw new Error('Draft identity does not match');
    const removed = await this.storage.remove(
      this.scope,
      record.id,
      record.token,
    );
    await this.refresh();
    return removed;
  }
  async discard(record: Draft) {
    if (!this.scope || record.scope !== this.scope)
      throw new Error('Draft identity does not match');
    if (!(await this.storage.remove(this.scope, record.id, record.token))) {
      await this.refresh();
      throw new Error(
        'This draft changed in another tab. Review the refreshed version.',
      );
    }
    await this.refresh();
  }
  async retry() {
    for (const writer of this.writers.values()) writer.retry();
    await Promise.all(
      [...this.writers.values()].map((writer) =>
        writer.flush().catch(() => {}),
      ),
    );
    await this.refresh();
  }
  async settle() {
    await Promise.all(
      [...this.writers.values()].map((writer) =>
        writer.flush().catch(() => {}),
      ),
    );
  }
}
