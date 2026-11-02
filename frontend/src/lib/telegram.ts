import { api, request } from './api';
export type TelegramStatus = {
  enabled: boolean;
  botUsername: string | null;
  telegramId: string | null;
  listId: string | null;
};
export const telegramApi = {
  status: () => request<TelegramStatus>('/telegram'),
  lists: api.lists,
  link: (listId: string) =>
    request<{ url: string; expiresIn: number }>('/telegram/link', {
      method: 'POST',
      body: JSON.stringify({ listId }),
    }),
  inbox: (listId: string) =>
    request<void>('/telegram/inbox', {
      method: 'PATCH',
      body: JSON.stringify({ listId }),
    }),
  disconnect: () => request<void>('/telegram', { method: 'DELETE' }),
};
