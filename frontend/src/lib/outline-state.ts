import { ApiError } from './api.ts';
import type { OutlineView, ViewChange } from './api.ts';

type Transport = {
  getView: (id: string) => Promise<OutlineView>;
  patchView: (
    id: string,
    revision: number,
    changes: ViewChange[],
  ) => Promise<OutlineView>;
};
/** Manual presentation preferences only; content and temporary expansion are external. */
export class OutlineState {
  collapsed = new Set<string>();
  revision = 0;
  version = 0;
  error = '';
  loading = false;
  saving = false;
  private pending = new Map<string, { collapsed: boolean; sequence: number }>();
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | undefined;
  private disposed = false;
  private id: string;
  private transport: Transport;
  private notify: () => void;
  private delay: number;
  constructor(
    id: string,
    transport: Transport,
    notify: () => void,
    delay = 400,
  ) {
    this.id = id;
    this.transport = transport;
    this.notify = notify;
    this.delay = delay;
  }
  get dirty() {
    return this.pending.size > 0;
  }
  private changed() {
    this.version++;
    if (!this.disposed) this.notify();
  }
  private apply(view: OutlineView) {
    if (this.disposed) return;
    this.revision = view.revision;
    this.collapsed = new Set(view.collapsedItemIds);
    for (const [id, change] of this.pending) {
      if (change.collapsed) this.collapsed.add(id);
      else this.collapsed.delete(id);
    }
    this.changed();
  }
  set(id: string, collapsed: boolean) {
    if (this.disposed) return;
    this.pending.set(id, { collapsed, sequence: ++this.sequence });
    if (collapsed) this.collapsed.add(id);
    else this.collapsed.delete(id);
    this.changed();
    clearTimeout(this.timer);
    if (!this.error)
      this.timer = setTimeout(() => void this.flush(), this.delay);
  }
  async refresh() {
    if (this.disposed || this.loading || this.flight) return;
    this.loading = true;
    this.changed();
    try {
      const view = await this.transport.getView(this.id);
      this.error = '';
      this.apply(view);
      if (this.dirty) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.flush(), this.delay);
      }
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : 'Could not load outline preferences';
    } finally {
      this.loading = false;
      this.changed();
    }
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.disposed || this.loading || !this.dirty || this.error) return;
    if (this.flight) return this.flight;
    this.saving = true;
    this.changed();
    this.flight = this.send();
    await this.flight;
    this.flight = undefined;
    this.saving = false;
    this.changed();
    if (this.dirty && !this.error && !this.disposed) return this.flush();
  }
  private async send() {
    const attempt = new Map(this.pending);
    for (let tries = 0; tries < 3 && !this.disposed; tries++) {
      try {
        const result = await this.transport.patchView(
          this.id,
          this.revision,
          [...attempt].map(([itemId, value]) => ({
            itemId,
            collapsed: value.collapsed,
          })),
        );
        for (const [id, value] of attempt)
          if (this.pending.get(id)?.sequence === value.sequence)
            this.pending.delete(id);
        this.error = '';
        this.apply(result);
        return;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && tries < 2) {
          try {
            this.apply(await this.transport.getView(this.id));
            continue;
          } catch (readError) {
            this.error =
              readError instanceof Error
                ? readError.message
                : 'Could not refresh outline preferences';
            return;
          }
        }
        this.error =
          error instanceof Error
            ? error.message
            : 'Could not save outline preferences';
        return;
      }
    }
  }
  async retry() {
    await this.refresh();
    if (!this.error) await this.flush();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
