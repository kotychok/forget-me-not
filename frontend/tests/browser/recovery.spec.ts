import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parsePortable } from '../../src/lib/portable';

const status = (page: Page) =>
  page.getByRole('status', { name: 'Save status' });
const recover = (page: Page) =>
  page.getByRole('button', { name: /Recover drafts \(/ });

test.beforeEach(async ({ page, request }) => {
  const list = await (
    await request.post('/api/lists', { data: { title: 'Recovery list' } })
  ).json();
  await request.put(`/api/lists/${list.id}`, {
    data: {
      baseRevision: 0,
      document: {
        id: list.id,
        title: list.title,
        nodes: [
          {
            id: randomUUID(),
            kind: 'item',
            text: 'Server original',
            completed: false,
            children: [],
          },
        ],
      },
    },
  });
  await page.goto(`/?list=${list.id}`);
  await expect(status(page)).toHaveText('Saved');
});
async function edit(page: Page, text: string) {
  await page.locator('.row .item-text').first().click();
  await page.getByRole('textbox', { name: 'Item text' }).fill(text);
}
async function reloadUnsaved(page: Page) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(status(page)).toHaveText('Saved');
}
async function breakWrites(page: Page) {
  await page.route('**/api/lists/*', (route) =>
    route.request().method() === 'PUT'
      ? route.abort('failed')
      : route.continue(),
  );
}

test('an unacknowledged edit survives reload and recovers as a separate list', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  await breakWrites(page);
  await edit(page, 'Unacknowledged recovery');
  await expect(status(page)).toContainText('Save failed');
  await expect(
    page.getByText('Local draft saved in this browser.', { exact: true }),
  ).toBeVisible();
  await reloadUnsaved(page);
  await expect(
    page.getByRole('button', { name: 'Server original', exact: true }),
  ).toBeVisible();
  await expect(recover(page)).toHaveText('Recover drafts (1)');
  await recover(page).click();
  const dialog = page.getByRole('dialog', { name: 'Recover local drafts' });
  await dialog.getByText('Preview local content', { exact: true }).click();
  await expect(
    dialog.getByText('• Unacknowledged recovery', { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Recover as new list', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toHaveText(
    'Draft recovered as a new list.',
  );
  await dialog.getByRole('button', { name: 'Close draft recovery' }).click();
  await expect(page.getByRole('button', { name: 'Rename list' })).toHaveText(
    'Recovery list (recovered)',
  );
  await expect(
    page.getByRole('button', { name: 'Unacknowledged recovery', exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get('list')).not.toBe(id);
  expect(
    (await (await request.get(`/api/lists/${id}`)).json()).nodes[0].text,
  ).toBe('Server original');
  await expect(recover(page)).toHaveText('Recover drafts (0)');
});

test('two tabs keep both versions when a conflicting local edit is saved as a new list', async ({
  page,
  request,
}) => {
  const url = page.url();
  const id = new URL(url).searchParams.get('list')!;
  const other = await page.context().newPage();
  await other.goto(url);
  await expect(status(other)).toHaveText('Saved');
  await edit(page, 'Version A');
  await expect(status(page)).toHaveText('Saved');
  await edit(other, 'Version B');
  await expect(status(other)).toContainText('Conflict');
  await expect(
    other.getByText('Local draft saved in this browser.', { exact: true }),
  ).toBeVisible();
  await other
    .getByRole('button', { name: 'Save local as new list', exact: true })
    .click();
  await expect(other.getByRole('button', { name: 'Rename list' })).toHaveText(
    'Recovery list (local copy)',
  );
  await expect(
    other.getByRole('button', { name: 'Version B', exact: true }),
  ).toBeVisible();
  expect(
    (await (await request.get(`/api/lists/${id}`)).json()).nodes[0].text,
  ).toBe('Version A');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Version A', exact: true }),
  ).toBeVisible();
  await other.close();
});

test('loading the server version retains a downloadable draft until explicit discard', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  const original = await (await request.get(`/api/lists/${id}`)).json();
  await request.put(`/api/lists/${id}`, {
    data: {
      baseRevision: original.revision,
      document: {
        id,
        title: 'Server title',
        nodes: [{ ...original.nodes[0], text: 'Server version' }],
      },
    },
  });
  await edit(page, 'Local version');
  await expect(status(page)).toContainText('Conflict');
  await page
    .getByRole('button', { name: 'Load server version', exact: true })
    .click();
  await expect(status(page)).toHaveText('Saved');
  await expect(
    page.getByRole('button', { name: 'Server version', exact: true }),
  ).toBeVisible();
  await expect(recover(page)).toHaveText('Recover drafts (1)');
  await recover(page).click();
  const dialog = page.getByRole('dialog', { name: 'Recover local drafts' });
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download draft JSON' }).click();
  const file = await pending;
  const local = parsePortable(await readFile((await file.path())!, 'utf8'));
  expect(local.lists[0].nodes[0].text).toBe('Local version');
  page.once('dialog', (dialog) => dialog.accept());
  await dialog
    .getByRole('button', { name: 'Discard draft', exact: true })
    .click();
  await expect(dialog.getByRole('article')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close draft recovery' }).click();
  await expect(recover(page)).toHaveText('Recover drafts (0)');
  expect(
    (await (await request.get(`/api/lists/${id}`)).json()).nodes[0].text,
  ).toBe('Server version');
});

test('a retained draft can be recovered after its source list was deleted', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  await breakWrites(page);
  await edit(page, 'Survives source deletion');
  await expect(status(page)).toContainText('Save failed');
  await expect(
    page.getByText('Local draft saved in this browser.', { exact: true }),
  ).toBeVisible();
  const document = await (await request.get(`/api/lists/${id}`)).json();
  expect(
    (
      await request.delete(`/api/lists/${id}?baseRevision=${document.revision}`)
    ).status(),
  ).toBe(204);
  await reloadUnsaved(page);
  await recover(page).click();
  const dialog = page.getByRole('dialog', { name: 'Recover local drafts' });
  await dialog
    .getByRole('button', { name: 'Recover as new list', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toHaveText(
    'Draft recovered as a new list.',
  );
  await dialog.getByRole('button', { name: 'Close draft recovery' }).click();
  await expect(
    page.getByRole('button', { name: 'Survives source deletion', exact: true }),
  ).toBeVisible();
  expect((await request.get(`/api/lists/${id}`)).status()).toBe(404);
});

test('a lost save response is recognized on reload without duplicating the list', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  const before = await (await request.get('/api/lists')).json();
  await page.route('**/api/lists/*', async (route) => {
    if (route.request().method() === 'PUT') {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  await edit(page, 'Committed despite missing response');
  await expect(status(page)).toContainText('Save failed');
  await expect(
    page.getByText('Local draft saved in this browser.', { exact: true }),
  ).toBeVisible();
  await reloadUnsaved(page);
  await expect(recover(page)).toHaveText('Recover drafts (0)');
  await expect(
    page.getByRole('button', {
      name: 'Committed despite missing response',
      exact: true,
    }),
  ).toBeVisible();
  expect((await (await request.get('/api/lists')).json()).length).toBe(
    before.length,
  );
  expect((await (await request.get(`/api/lists/${id}`)).json()).revision).toBe(
    2,
  );
});

test('IndexedDB failure is visible, JSON remains available, and local storage can be retried', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { fail: true };
    (
      window as unknown as { draftStorageTest: { fail: boolean } }
    ).draftStorageTest = state;
    const open = indexedDB.open.bind(indexedDB);
    Object.defineProperty(indexedDB, 'open', {
      value: (name: string, version?: number) => {
        if (state.fail)
          throw new DOMException('Storage unavailable', 'QuotaExceededError');
        return open(name, version);
      },
    });
  });
  await page.reload();
  const warning = page.getByRole('region', {
    name: 'Local draft storage error',
  });
  await expect(warning).toBeVisible();
  await edit(page, 'Saved with storage unavailable');
  await expect(status(page)).toHaveText('Saved');
  const pending = page.waitForEvent('download');
  await warning
    .getByRole('button', { name: 'Download local JSON', exact: true })
    .click();
  const file = await pending;
  expect(
    parsePortable(await readFile((await file.path())!, 'utf8')).lists[0]
      .nodes[0].text,
  ).toBe('Saved with storage unavailable');
  await page.evaluate(() => {
    (
      window as unknown as { draftStorageTest: { fail: boolean } }
    ).draftStorageTest.fail = false;
  });
  await warning.getByRole('button', { name: 'Retry local storage' }).click();
  await expect(warning).not.toBeVisible();
  await breakWrites(page);
  await page
    .getByRole('textbox', { name: 'Item text' })
    .fill('Protected again');
  await expect(
    page.getByText('Local draft saved in this browser.', { exact: true }),
  ).toBeVisible();
});

test('draft records from other owners or installations are neither shown nor deleted', async ({
  page,
  request,
}) => {
  const identity = await (await request.get('/api/session')).json();
  const id = new URL(page.url()).searchParams.get('list')!;
  const document = await (await request.get(`/api/lists/${id}`)).json();
  const records = [
    { serverId: identity.serverId, ownerId: randomUUID() },
    { serverId: randomUUID(), ownerId: identity.ownerId },
  ].map((scope) => ({
    id: randomUUID(),
    scope: JSON.stringify([scope.serverId, scope.ownerId]),
    token: randomUUID(),
    formatVersion: 1,
    baseRevision: document.revision,
    updatedAt: Date.now(),
    document: { id, title: 'Hidden foreign draft', nodes: document.nodes },
  }));
  await page.evaluate(async (records) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('forget-me-not-drafts', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('drafts', 'readwrite');
        for (const record of records) tx.objectStore('drafts').put(record);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
    });
  }, records);
  await page.reload();
  await expect(status(page)).toHaveText('Saved');
  await expect(recover(page)).toHaveText('Recover drafts (0)');
  await recover(page).click();
  await expect(
    page.getByRole('dialog', { name: 'Recover local drafts' }),
  ).not.toContainText('Hidden foreign draft');
  const count = await page.evaluate(
    async () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('forget-me-not-drafts', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('drafts', 'readonly');
          const result = tx.objectStore('drafts').count();
          tx.oncomplete = () => {
            db.close();
            resolve(result.result);
          };
        };
      }),
  );
  expect(count).toBe(2);
});
