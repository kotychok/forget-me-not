import type { Portable } from './portable.ts';
import type { Item } from './editor.ts';

export type Document = { id: string; title: string; nodes: Item[] };
export type ListDocument = Document & { revision: number };
export type ListSummary = {
  id: string;
  title: string;
  revision: number;
  position: number;
  itemCount: number;
};
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      error?.error ?? `Request failed (${response.status})`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const api = {
  session: () => request<{ serverId: string; ownerId: string }>('/session'),
  exportJson: () => request<Portable>('/export'),
  importJson: (document: Portable) =>
    request<ListSummary[]>('/import', {
      method: 'POST',
      body: JSON.stringify(document),
    }),
  lists: () => request<ListSummary[]>('/lists'),
  get: (id: string) =>
    request<ListDocument>(`/lists/${encodeURIComponent(id)}`),
  create: (title: string) =>
    request<ListDocument>('/lists', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  save: (document: Document, baseRevision: number) =>
    request<{ revision: number }>(`/lists/${encodeURIComponent(document.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ document, baseRevision }),
    }),
  delete: (id: string, baseRevision: number) =>
    request<void>(
      `/lists/${encodeURIComponent(id)}?baseRevision=${baseRevision}`,
      { method: 'DELETE' },
    ),
};
