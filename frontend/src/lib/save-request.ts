/** Immutable wire attempt retained until acknowledgement or explicit reconciliation. */
export type SaveScope = {
  epoch: number;
  owner: string | null;
  installation: string | null;
};
export type PreparedSave = {
  id: string;
  method: 'PUT' | 'PATCH';
  body: string | ArrayBuffer;
  encoding?: 'gzip';
  baseRevision: number;
  operationId?: string;
  scope: SaveScope;
};
