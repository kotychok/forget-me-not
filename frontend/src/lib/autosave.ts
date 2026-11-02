import type { PreparedSave } from './save-request.ts';
import { sameDocument } from './documents.ts';
import { ApiError } from './api.ts';
import type { Document, ListDocument } from './api.ts';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';
export type Transport = {
  prepareSave?: (
    document: Document,
    revision: number,
    baseline?: Document,
    operationId?: string,
  ) => Promise<PreparedSave>;
  sendSave?: (prepared: PreparedSave) => Promise<{ revision: number }>;
  save: (
    document: Document,
    baseRevision: number,
  ) => Promise<{ revision: number }>;
  get: (id: string) => Promise<ListDocument>;
};
type Attempt = {
  document: Document;
  generation: number;
  revision: number;
  operationId: string;
  prepared?: PreparedSave;
};
/** One queue per list; acknowledgements never replace locally edited content. */
export class Autosave {
  revision: number;
  status: SaveStatus = 'saved';
  error = '';
  private generation = 0;
  private baseline: Document | undefined;
  private acknowledged = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<boolean> | undefined;
  private retryFlight: Promise<boolean> | undefined;
  private attempt: Attempt | undefined;
  private disposed = false;
  private paused = false;

  private read: () => Document;
  private transport: Transport;
  private changed: () => void;
  private delay: number;

  constructor(
    revision: number,
    read: () => Document,
    transport: Transport,
    changed: () => void,
    delay = 500,
    baseline?: Document,
  ) {
    this.baseline = baseline ? structuredClone(baseline) : undefined;
    this.revision = revision;
    this.read = read;
    this.transport = transport;
    this.changed = changed;
    this.delay = delay;
  }

  get dirty() {
    return this.generation !== this.acknowledged;
  }

  markDirty() {
    this.generation++;
    if (!this.paused && this.status !== 'conflict' && this.status !== 'error') {
      if (!this.flight) this.status = 'unsaved';
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), this.delay);
    }
    this.changed();
  }

  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (
      this.disposed ||
      this.paused ||
      this.status === 'conflict' ||
      this.status === 'error'
    )
      return false;
    if (this.flight) {
      await this.flight;
      return this.flush();
    }
    if (!this.dirty) return true;
    const attempt: Attempt = {
      document: structuredClone(this.read()),
      generation: this.generation,
      revision: this.revision,
      operationId: crypto.randomUUID(),
    };
    if (this.baseline && sameDocument(attempt.document, this.baseline)) {
      this.acknowledged = attempt.generation;
      this.status = 'saved';
      this.error = '';
      this.changed();
      return true;
    }
    this.attempt = attempt;
    this.status = 'saving';
    this.changed();
    this.flight = (async () => {
      if (this.transport.prepareSave && this.transport.sendSave) {
        attempt.prepared = await this.transport.prepareSave(
          attempt.document,
          attempt.revision,
          this.baseline,
          attempt.operationId,
        );
        return this.transport.sendSave(attempt.prepared);
      }
      return this.transport.save(attempt.document, attempt.revision);
    })()
      .then((response) => {
        this.baseline = structuredClone(attempt.document);
        this.revision = response.revision;
        this.acknowledged = attempt.generation;
        this.attempt = undefined;
        this.status = this.dirty ? 'unsaved' : 'saved';
        this.error = '';
        return true;
      })
      .catch((error: unknown) => {
        this.status =
          error instanceof ApiError &&
          error.status === 409 &&
          error.code !== 'operation_id_reused'
            ? 'conflict'
            : 'error';
        this.error = error instanceof Error ? error.message : 'Save failed';
        return false;
      });
    const saved = await this.flight;
    this.flight = undefined;
    this.changed();
    return saved && this.dirty ? this.flush() : saved;
  }

  /** Reconcile a potentially committed write before resending after a lost response. */
  retry(): Promise<boolean> {
    if (this.retryFlight) return this.retryFlight;
    const work = this.retryOnce();
    this.retryFlight = work;
    void work.finally(() => {
      if (this.retryFlight === work) this.retryFlight = undefined;
    });
    return work;
  }
  private async retryOnce(): Promise<boolean> {
    if (
      this.flight ||
      this.paused ||
      this.status === 'conflict' ||
      this.disposed
    )
      return false;
    try {
      const attempt = this.attempt;
      if (attempt?.prepared?.method === 'PATCH' && this.transport.sendSave) {
        try {
          const response = await this.transport.sendSave(attempt.prepared);
          this.revision = response.revision;
          this.baseline = structuredClone(attempt.document);
          this.acknowledged = attempt.generation;
          this.attempt = undefined;
          this.status = this.dirty ? 'unsaved' : 'saved';
          this.error = '';
          this.changed();
          return this.flush();
        } catch (error) {
          if (!(
            error instanceof ApiError &&
            error.status === 409 &&
            error.code !== 'operation_id_reused'
          ))
            throw error;
        }
      }
      const current = await this.transport.get(this.read().id);
      if (this.attempt && sameDocument(current, this.attempt.document)) {
        this.baseline = structuredClone(this.attempt.document);
        this.revision = current.revision;
        this.acknowledged = this.attempt.generation;
        this.attempt = undefined;
      } else if (
        current.revision !== this.revision ||
        this.attempt?.prepared?.method === 'PATCH'
      ) {
        this.status = 'conflict';
        this.error = 'List changed on the server';
        this.changed();
        return false;
      }
      this.status = this.dirty ? 'unsaved' : 'saved';
      this.error = '';
      this.changed();
      return this.flush();
    } catch (error) {
      this.status = 'error';
      this.error = error instanceof Error ? error.message : 'Retry failed';
      this.changed();
      return false;
    }
  }

  async pause(): Promise<void> {
    this.paused = true;
    clearTimeout(this.timer);
    await this.flight;
    await this.retryFlight;
  }
  resume() {
    this.paused = false;
    if (this.dirty && this.status !== 'error' && this.status !== 'conflict')
      this.timer = setTimeout(() => void this.flush(), this.delay);
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
