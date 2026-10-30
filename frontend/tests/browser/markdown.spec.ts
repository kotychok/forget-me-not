import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function transfer(page: import('@playwright/test').Page) {
  await page
    .getByRole('button', { name: 'Import / export', exact: false })
    .click();
  return page.getByRole('dialog', { name: 'Import / export', exact: true });
}

test('Markdown preview and current export round-trip through shared new-copy import', async ({
  page,
  request,
}) => {
  await page.goto('/');
  let dialog = await transfer(page);
  const before = await (await request.get('/api/lists')).json();
  const source =
    '# Markdown demo #\n\n[ ] Task\n\n- Parent\n   - [x] Child\n\nRoot paragraph\n';
  await dialog.getByLabel('Choose JSON or Markdown file').setInputFiles({
    name: 'demo.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source),
  });
  await expect(dialog.getByLabel('Import preview')).toContainText('4 items');
  expect((await (await request.get('/api/lists')).json()).length).toBe(
    before.length,
  );
  await expect(dialog.getByLabel('Format notes')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 954 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath('markdown-preview.png'),
  });
  await dialog
    .getByRole('button', { name: 'Import as new copies', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toContainText('Imported 1 list');
  await dialog.getByRole('button', { name: 'Close import and export' }).click();
  await page.locator('.mobile-list-picker').click();
  await page
    .getByRole('dialog', { name: 'Choose a list' })
    .getByRole('button', { name: 'Markdown demo', exact: false })
    .click();
  await expect(
    page.getByRole('button', { name: 'Child', exact: true }),
  ).toBeVisible();
  const original = (await (await request.get('/api/lists')).json()).find(
    (list: { title: string }) => list.title === 'Markdown demo',
  );
  dialog = await transfer(page);
  await dialog.getByLabel('Export format').selectOption('markdown');
  await expect(
    dialog.getByRole('button', { name: 'Export all lists', exact: true }),
  ).toBeDisabled();
  const ready = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Export current list', exact: true })
    .click();
  const download = await ready;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const exported = await readFile((await download.path())!, 'utf8');
  expect(exported).toContain('  - [x] Child');
  await dialog.getByLabel('Choose JSON or Markdown file').setInputFiles({
    name: 'again.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(exported),
  });
  await dialog
    .getByRole('button', { name: 'Import as new copies', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toContainText('Imported 1 list');
  const lists = await (await request.get('/api/lists')).json();
  const copies = lists.filter(
    (list: { title: string }) => list.title === 'Markdown demo',
  );
  expect(copies.length).toBe(2);
  expect(copies[0].id).not.toBe(copies[1].id);
  expect(
    (await (await request.get(`/api/lists/${original.id}`)).json()).nodes
      .length,
  ).toBe(3);
});

test('5000-item Markdown list imports intact, edits, undoes, saves, searches and reloads', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const dialog = await transfer(page);
  const source =
    '# Large synthetic outline\n\n' +
    Array.from({ length: 5000 }, (_, i) => `- Large node ${i}`).join('\n');
  await dialog.getByLabel('Choose JSON or Markdown file').setInputFiles({
    name: 'large.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source),
  });
  await expect(dialog.getByLabel('Import preview')).toContainText('5000 items');
  await dialog
    .getByRole('button', { name: 'Import as new copies', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toContainText('Imported 1 list');
  await dialog.getByRole('button', { name: 'Close import and export' }).click();
  const list = (await (await request.get('/api/lists')).json()).find(
    (list: { title: string }) => list.title === 'Large synthetic outline',
  );
  const start = Date.now();
  await page.goto(`/?list=${list.id}`);
  await expect(page.locator('.row')).toHaveCount(5000);
  const item = page.locator('.item-text').last();
  await item.focus();
  await item.press('Tab');
  await expect(page.locator('.row.active')).toHaveCSS('--depth', '1');
  const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
  await page.locator('.row.active .item-text').press(undo);
  await expect(page.locator('.row.active')).toHaveCSS('--depth', '0');
  await page.locator('.row.active .item-text').press('F2');
  const text = page.getByRole('textbox', { name: 'Item text' });
  await text.fill('Large edited needle');
  await text.press('Escape');
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saved',
  );
  await page.getByRole('button', { name: 'Search lists', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Search lists' });
  await search.getByRole('textbox').fill('Large edited needle');
  await expect(
    search.getByRole('status', { name: 'Search status' }),
  ).toHaveText('1 results');
  await search.getByRole('button', { name: /Large edited needle/ }).click();
  await expect(page.locator('.row.active .item-text')).toBeFocused();
  const exported = await (
    await request.get(`/api/export?listId=${list.id}`)
  ).json();
  expect(exported.lists[0].nodes.length).toBe(5000);
  expect(exported.lists[0].nodes[4999].text).toBe('Large edited needle');
  expect(
    Buffer.byteLength(
      JSON.stringify({ document: exported.lists[0], baseRevision: 0 }),
    ),
  ).toBeLessThan(1024 * 1024);
  await page.reload();
  await expect(page.locator('.row')).toHaveCount(5000);
  expect(
    (await (await request.get(`/api/lists/${list.id}`)).json()).nodes[4999]
      .text,
  ).toBe('Large edited needle');
  console.log(
    `5000-item load/edit/undo/save/search/reload: ${Date.now() - start} ms`,
  );
});

test('local JSON export remains available when format conversion is unavailable', async ({
  page,
  request,
}) => {
  const list = await (
    await request.post('/api/lists', { data: { title: 'Local fallback' } })
  ).json();
  await page.goto(`/?list=${list.id}`);
  await page.route('**/api/transfer/**', (route) => route.abort());
  const dialog = await transfer(page);
  const ready = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Export current list', exact: true })
    .click();
  const download = await ready;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.lists[0].id).toBe(list.id);
  expect(exported.lists[0].title).toBe('Local fallback');
});
