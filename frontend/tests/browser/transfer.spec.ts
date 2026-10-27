import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parsePortable } from '../../src/lib/portable';
const fixture = await readFile(
  new URL('../../../fixtures/portable-v1.json', import.meta.url),
  'utf8',
);

test.beforeEach(async ({ page, request }) => {
  const imported = await request.post('/api/import', {
    data: JSON.parse(fixture),
  });
  expect(imported.status()).toBe(201);
  const lists = await imported.json();
  await page.goto(`/?list=${lists[0].id}`);
  await expect(page.getByRole('button', { name: 'Rename list' })).toHaveText(
    'Travel',
  );
});

async function download(page: import('@playwright/test').Page, name: string) {
  const pending = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: 'Import / export' })
    .getByRole('button', { name, exact: true })
    .click();
  const file = await pending;
  return parsePortable(await readFile((await file.path())!, 'utf8'));
}

test('current JSON export round-trips through preview into a new copy without overwriting', async ({
  page,
  request,
}) => {
  const originalId = new URL(page.url()).searchParams.get('list')!;
  await page
    .getByRole('button', { name: 'Import / export', exact: false })
    .click();
  const exported = await download(page, 'Export current list');
  expect(exported.lists[0].id).toBe(originalId);
  expect(exported.lists[0].nodes[0].children[0].completed).toBe(true);
  expect(exported.lists[0].nodes[0].children[0].text).toContain('**tickets**');
  const before = await (await request.get('/api/lists')).json();
  const dialog = page.getByRole('dialog', { name: 'Import / export' });
  await dialog.getByLabel('Choose JSON or Markdown file').setInputFiles({
    name: 'copy.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(dialog.getByLabel('Import preview')).toContainText(
    '1 list · 2 items',
  );
  expect((await (await request.get('/api/lists')).json()).length).toBe(
    before.length,
  );
  await dialog
    .getByRole('button', { name: 'Import as new copies', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toHaveText(
    'Imported 1 list as new copies.',
  );
  const after = await (await request.get('/api/lists')).json();
  const copy = after.find(
    (list: { id: string }) =>
      !before.some((old: { id: string }) => old.id === list.id),
  );
  expect(copy.id).not.toBe(originalId);
  const copied = await (await request.get(`/api/lists/${copy.id}`)).json();
  expect(copied.nodes[0].id).not.toBe(exported.lists[0].nodes[0].id);
  expect(copied.nodes[0].text).toBe(exported.lists[0].nodes[0].text);
  expect((await request.get(`/api/lists/${originalId}`)).status()).toBe(200);
});

test('invalid JSON and unknown versions show errors and never enable import', async ({
  page,
  request,
}) => {
  await page
    .getByRole('button', { name: 'Import / export', exact: false })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Import / export' });
  const input = dialog.getByLabel('Choose JSON or Markdown file');
  const before = await (await request.get('/api/lists')).json();
  await input.setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ broken'),
  });
  await expect(dialog.getByRole('alert')).toContainText('Invalid JSON');
  await input.setInputFiles({
    name: 'future.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      fixture.replace('"schemaVersion": 1', '"schemaVersion": 3'),
    ),
  });
  await expect(dialog.getByRole('alert')).toContainText('$.schemaVersion');
  await expect(
    dialog.getByRole('button', { name: 'Import as new copies', exact: true }),
  ).toHaveCount(0);
  expect((await (await request.get('/api/lists')).json()).length).toBe(
    before.length,
  );
});

test('all-list export flushes the current edit before downloading saved data', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  await page.locator('.row .item-text').first().click();
  await page
    .getByRole('textbox', { name: 'Item text' })
    .fill('Latest before export');
  await page
    .getByRole('button', { name: 'Import / export', exact: false })
    .click();
  const exported = await download(page, 'Export all lists');
  expect(exported.lists.find((list) => list.id === id)!.nodes[0].text).toBe(
    'Latest before export',
  );
  const saved = await (await request.get(`/api/lists/${id}`)).json();
  expect(saved.nodes[0].text).toBe('Latest before export');
  expect(exported.lists.map((list) => list.id)).toEqual(
    (await (await request.get('/api/lists')).json()).map(
      (list: { id: string }) => list.id,
    ),
  );
});

test('current-list export preserves local edits even after a server conflict', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  const original = await (await request.get(`/api/lists/${id}`)).json();
  await request.put(`/api/lists/${id}`, {
    data: {
      baseRevision: original.revision,
      document: { id, title: 'Other tab', nodes: original.nodes },
    },
  });
  await page.locator('.row .item-text').first().click();
  await page
    .getByRole('textbox', { name: 'Item text' })
    .fill('Local copy from conflict');
  await expect(
    page.getByRole('status', { name: 'Save status', exact: true }),
  ).toContainText('Conflict');
  await page
    .getByRole('button', { name: 'Import / export', exact: false })
    .click();
  const exported = await download(page, 'Export current list');
  expect(exported.lists[0].nodes[0].text).toBe('Local copy from conflict');
  expect((await (await request.get(`/api/lists/${id}`)).json()).title).toBe(
    'Other tab',
  );
});

test('canceling a valid preview makes no writes; batch import creates both lists', async ({
  page,
  request,
}) => {
  const before = await (await request.get('/api/lists')).json();
  const trigger = page.getByRole('button', {
    name: 'Import / export',
    exact: false,
  });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Import / export' });
  await dialog.getByLabel('Choose JSON or Markdown file').setInputFiles({
    name: 'two-lists.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fixture),
  });
  await expect(dialog.getByLabel('Import preview')).toContainText(
    '2 lists · 2 items',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect((await (await request.get('/api/lists')).json()).length).toBe(
    before.length,
  );
  await trigger.click();
  await dialog
    .getByRole('button', { name: 'Import as new copies', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toHaveText(
    'Imported 2 lists as new copies.',
  );
  expect((await (await request.get('/api/lists')).json()).length).toBe(
    before.length + 2,
  );
});

test('lost import response is not retried and refreshing the index preserves local edits', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  const original = await (await request.get(`/api/lists/${id}`)).json();
  await request.put(`/api/lists/${id}`, {
    data: {
      baseRevision: original.revision,
      document: { id, title: 'External update', nodes: original.nodes },
    },
  });
  await page.locator('.row .item-text').first().click();
  await page
    .getByRole('textbox', { name: 'Item text' })
    .fill('Keep local draft');
  await expect(
    page.getByRole('status', { name: 'Save status', exact: true }),
  ).toContainText('Conflict');
  let attempts = 0;
  await page.route('**/api/import', async (route) => {
    attempts++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort('connectionfailed');
  });
  const before = await (await request.get('/api/lists')).json();
  await page
    .getByRole('button', { name: 'Import / export', exact: false })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Import / export' });
  await dialog.getByLabel('Choose JSON or Markdown file').setInputFiles({
    name: 'uncertain.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fixture),
  });
  await dialog
    .getByRole('button', { name: 'Import as new copies', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'response was not confirmed',
  );
  await expect(
    dialog.getByRole('button', { name: 'Import as new copies', exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole('button', { name: 'Refresh list index', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toContainText(
    'List index refreshed',
  );
  expect(attempts).toBe(1);
  expect((await (await request.get('/api/lists')).json()).length).toBe(
    before.length + 2,
  );
  await dialog.getByRole('button', { name: 'Close import and export' }).click();
  await expect(page.getByRole('textbox', { name: 'Item text' })).toHaveValue(
    'Keep local draft',
  );
  await expect(
    page.getByRole('status', { name: 'Save status', exact: true }),
  ).toContainText('Conflict');
  await expect(page.locator('nav .list-link')).toHaveCount(before.length + 2);
});
