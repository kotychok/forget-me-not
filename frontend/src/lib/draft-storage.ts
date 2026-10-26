import type { Document } from './api.ts';
import { validatePortable } from './portable.ts';
export type Draft = {
  id: string;
  scope: string;
  token: string;
  formatVersion: 1;
  baseRevision: number;
  updatedAt: number;
  document: Document;
};
export interface DraftStorage {
  list(scope: string): Promise<Draft[]>;
  put(draft: Draft): Promise<void>;
  remove(scope: string, id: string, token: string): Promise<boolean>;
}
function validateDraft(value: Draft, scope: string): Draft {
  if (
    value?.scope !== scope ||
    value.formatVersion !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.token !== 'string' ||
    !Number.isSafeInteger(value.baseRevision) ||
    value.baseRevision < 0 ||
    !Number.isFinite(value.updatedAt)
  )
    throw new Error('Invalid local draft. Stored data was kept.');
  validatePortable({ schemaVersion: 1, lists: [value.document] });
  return value;
}

/** IndexedDB adapter only. Origin isolation is provided by the browser; scope is server + owner. */
export class IndexedDbDrafts implements DraftStorage {
  private connection: Promise<IDBDatabase> | undefined;
  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    this.connection = new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let rejected = false;
      const fail = () => {
        rejected = true;
        reject(new Error('Local draft storage could not be opened.'));
      };
      try {
        request = indexedDB.open('forget-me-not-drafts', 1);
      } catch {
        fail();
        return;
      }
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('drafts', {
          keyPath: ['scope', 'id'],
        });
        store.createIndex('scope', 'scope');
      };
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = () => {
        if (rejected) {
          request.result.close();
          return;
        }
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.connection = undefined;
        };
        resolve(database);
      };
    });
    this.connection.catch(() => {
      this.connection = undefined;
    });
    return this.connection;
  }
  async list(scope: string): Promise<Draft[]> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('drafts', 'readonly');
      const request = tx
        .objectStore('drafts')
        .index('scope')
        .getAll(IDBKeyRange.only(scope));
      tx.oncomplete = () => {
        try {
          resolve(
            (request.result as Draft[])
              .map((value) => validateDraft(value, scope))
              .sort((a, b) => b.updatedAt - a.updatedAt),
          );
        } catch (error) {
          reject(error);
        }
      };
      tx.onerror = tx.onabort = () =>
        reject(new Error('Could not read local drafts. Stored data was kept.'));
    });
  }
  async put(draft: Draft): Promise<void> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put(structuredClone(draft));
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(
          new Error(
            'Could not save a local draft. Browser storage may be unavailable or full.',
          ),
        );
    });
  }
  async remove(scope: string, id: string, token: string): Promise<boolean> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('drafts', 'readwrite');
      const store = tx.objectStore('drafts');
      let deleted = false;
      const request = store.get([scope, id]);
      request.onsuccess = () => {
        if ((request.result as Draft | undefined)?.token === token) {
          store.delete([scope, id]);
          deleted = true;
        }
      };
      tx.oncomplete = () => resolve(deleted);
      tx.onerror = tx.onabort = () =>
        reject(
          new Error('Could not update local drafts. Stored data was kept.'),
        );
    });
  }
}
