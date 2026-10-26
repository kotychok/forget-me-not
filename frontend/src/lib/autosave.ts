import { ApiError } from './api.ts';
import type { Document, ListDocument } from './api.ts';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';
export type Transport = {
  save: (
    document: Document,
    baseRevision: number,
  ) => Promise<{ revision: number }>;
  get: (id: string) => Promise<ListDocument>;
};
type Attempt = { document: Document; generation: number; revision: number };
const equalDocument = (left: Document, right: Document) =>
  left.id === right.id &&
  left.title === right.title &&
  JSON.stringify(left.nodes) === JSON.stringify(right.nodes);

/** One queue per list; acknowledgements never replace locally edited content. */
export class Autosave {
  revision: number;
  status: SaveStatus = 'saved';
  error = '';
  private generation = 0;
  private acknowledged = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<boolean> | undefined;
  private attempt: Attempt | undefined;
  private disposed = false;

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
  ) {
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
    if (this.status !== 'conflict' && this.status !== 'error') {
      if (!this.flight) this.status = 'unsaved';
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), this.delay);
    }
    this.changed();
  }

  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.disposed || this.status === 'conflict' || this.status === 'error')
      return false;
    if (this.flight) {
      await this.flight;
      return this.flush();
    }
    if (!this.dirty) return true;
    const attempt = {
      document: structuredClone(this.read()),
      generation: this.generation,
      revision: this.revision,
    };
    this.attempt = attempt;
    this.status = 'saving';
    this.changed();
    this.flight = this.transport
      .save(attempt.document, attempt.revision)
      .then((response) => {
        this.revision = response.revision;
        this.acknowledged = attempt.generation;
        this.attempt = undefined;
        this.status = this.dirty ? 'unsaved' : 'saved';
        this.error = '';
        return true;
      })
      .catch((error: unknown) => {
        this.status =
          error instanceof ApiError && error.status === 409
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
  async retry(): Promise<boolean> {
    if (this.flight || this.status === 'conflict' || this.disposed)
      return false;
    try {
      const current = await this.transport.get(this.read().id);
      if (this.attempt && equalDocument(current, this.attempt.document)) {
        this.revision = current.revision;
        this.acknowledged = this.attempt.generation;
        this.attempt = undefined;
      } else if (current.revision !== this.revision) {
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

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
