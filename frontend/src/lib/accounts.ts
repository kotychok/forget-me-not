import { request } from './api';
export type ManagedAccount = {
  id: string;
  login: string;
  displayName: string;
  role: string;
  status: 'active' | 'disabled' | 'pending' | 'reset_pending';
  activeSessions: number;
  linkExpiresAt: number | null;
};
export type IssuedLink = {
  token: string;
  login: string;
  purpose: 'activate' | 'reset';
  expiresAt: number;
};
export type LinkInfo = Omit<IssuedLink, 'token'>;
export const accountsApi = {
  list: () => request<ManagedAccount[]>('/auth/admin/users'),
  create: (login: string, displayName: string) =>
    request<IssuedLink>('/auth/admin/users', {
      method: 'POST',
      body: JSON.stringify({ login, displayName }),
    }),
  link: (id: string) =>
    request<IssuedLink>(`/auth/admin/users/${encodeURIComponent(id)}/link`, {
      method: 'POST',
    }),
  enabled: (id: string, enabled: boolean) =>
    request<void>(`/auth/admin/users/${encodeURIComponent(id)}/enabled`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  revoke: (id: string) =>
    request<void>(`/auth/admin/users/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
    }),
  preview: (token: string) =>
    request<LinkInfo>('/auth/access/info', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  redeem: (token: string, password: string) =>
    request<void>('/auth/access/redeem', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
};
