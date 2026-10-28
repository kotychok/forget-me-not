import { request } from './api';
export type AuthUser = {
  ownerId: string;
  login: string;
  role: string;
  sessionId?: string;
};
export type BrowserSession = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};
export const authApi = {
  status: () =>
    request<{ mode: 'local' | 'password'; configured: boolean }>(
      '/auth/status',
    ),
  me: () => request<AuthUser>('/auth/me'),
  login: (login: string, password: string) =>
    request<AuthUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  logoutAll: () => request<void>('/auth/logout-all', { method: 'POST' }),
  sessions: () => request<BrowserSession[]>('/auth/sessions'),
  revoke: (id: string) =>
    request<void>(`/auth/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  password: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};
