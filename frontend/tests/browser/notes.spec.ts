import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const text = '**Literal Markdown**\n<html>not markup</html>\nA separate note';

test.beforeEach(async ({ page, request }) => {
  const list = await (
    await request.post('/api/lists', { data: { title: 'Note list' } })
  ).json();
  expect(
    (
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
                text: 'Item with notes',
                completed: false,
                children: [],
              },
            ],
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/?list=${list.id}`);
});

test('note Apply/Cancel and undo preserve literal content, persist, export current JSON and search notes', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  const item = page.getByRole('button', {
    name: 'Item with notes',
    exact: true,
  });
  const dialog = page.getByRole('dialog', { name: 'Item note', exact: true });
  await item.focus();
  await item.press('n');
  const note = dialog.getByRole('textbox', { name: 'Note text' });
  await expect(note).toBeFocused();
  await note.fill('Discarded');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(item).toBeFocused();
  expect(
    (await (await request.get(`/api/lists/${id}`)).json()).nodes[0].note,
  ).toBeUndefined();
  await item.press('n');
  await note.fill(text);
  await dialog.getByRole('button', { name: 'Apply note', exact: true }).click();
  const indicator = page.getByRole('button', {
    name: 'Edit note for Item with notes',
    exact: true,
  });
  await expect(indicator).toBeVisible();
  await expect(
    page.getByRole('status', { name: 'Save status', exact: true }),
  ).toContainText('Saved');
  const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
  const redo =
    process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
  await item.press(undo);
  await expect(indicator).toHaveCount(0);
  await item.press(redo);
  await expect(indicator).toBeVisible();
  await expect(
    page.getByRole('status', { name: 'Save status', exact: true }),
  ).toContainText('Saved');
  await page.reload();
  await indicator.click();
  await expect(note).toHaveValue(text);
  await page.setViewportSize({ width: 390, height: 954 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('note-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(item).toBeFocused();
  await page.getByRole('button', { name: 'Search lists', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Search lists' });
  await search.getByRole('textbox').fill('separate note');
  await expect(search.getByRole('button', { name: /Note/ })).toContainText(
    'A separate note',
  );
  await search.getByRole('button', { name: /Note/ }).click();
  await expect(dialog).toBeVisible();
  await expect(note).toHaveValue(text);
  await expect(note).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('button', { name: 'Import / export', exact: false })
    .click();
  const transfer = page.getByRole('dialog', {
    name: 'Import / export',
    exact: true,
  });
  const ready = page.waitForEvent('download');
  await transfer
    .getByRole('button', { name: 'Export current list', exact: true })
    .click();
  const exported = JSON.parse(
    await readFile((await (await ready).path())!, 'utf8'),
  );
  expect(exported.schemaVersion).toBe(3);
  expect(exported.lists[0].nodes[0].note).toBe(text);
  await transfer.getByLabel('Export format').selectOption('markdown');
  await transfer
    .getByRole('button', { name: 'Export current list', exact: true })
    .click();
  await expect(transfer.getByRole('alert')).toContainText(
    'contains item notes',
  );
  await transfer.getByLabel('Choose JSON or Markdown file').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await transfer
    .getByRole('button', { name: 'Import as new copies', exact: true })
    .click();
  await expect(transfer.getByRole('status')).toContainText('Imported 1 list');
  const lists = await (await request.get('/api/lists')).json();
  const copy = lists.find(
    (list: { id: string; title: string }) =>
      list.id !== id && list.title === 'Note list',
  );
  expect(
    (await (await request.get(`/api/lists/${copy.id}`)).json()).nodes[0].note,
  ).toBe(text);
});

test('unacknowledged notes survive draft recovery as a new copy', async ({
  page,
  request,
}) => {
  const originalId = new URL(page.url()).searchParams.get('list')!;
  await page.route('**/api/lists/*', (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue(),
  );
  await page
    .getByRole('button', { name: 'Item with notes', exact: true })
    .focus();
  await page.keyboard.press('n');
  const note = page.getByRole('dialog', { name: 'Item note', exact: true });
  await note.getByRole('textbox').fill(text);
  await note.getByRole('button', { name: 'Apply note', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'Save status', exact: true }),
  ).toContainText('Save failed');
  await expect(
    page.getByText('Local draft saved in this browser.', { exact: true }),
  ).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByRole('button', { name: 'Recover drafts (1)', exact: true })
    .click();
  const recovery = page.getByRole('dialog', { name: 'Recover local drafts' });
  await recovery
    .getByRole('button', { name: 'Recover as new list', exact: true })
    .click();
  await expect(recovery.getByRole('status')).toHaveText(
    'Draft recovered as a new list.',
  );
  await recovery
    .getByRole('button', { name: 'Close draft recovery', exact: true })
    .click();
  const copy = new URL(page.url()).searchParams.get('list')!;
  expect(copy).not.toBe(originalId);
  expect(
    (await (await request.get(`/api/lists/${copy}`)).json()).nodes[0].note,
  ).toBe(text);
  expect(
    (await (await request.get(`/api/lists/${originalId}`)).json()).nodes[0]
      .note,
  ).toBeUndefined();
});

test('note byte limit prevents oversized changes and cancelling keeps history clean', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  const item = page.getByRole('button', {
    name: 'Item with notes',
    exact: true,
  });
  await item.focus();
  await item.press('n');
  const dialog = page.getByRole('dialog', { name: 'Item note', exact: true });
  const note = dialog.getByRole('textbox');
  await note.fill('a'.repeat(65537));
  await expect(
    dialog.getByRole('button', { name: 'Apply note', exact: true }),
  ).toBeDisabled();
  expect((await (await request.get(`/api/lists/${id}`)).json()).revision).toBe(
    1,
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeDisabled();
  await item.press('n');
  await expect(note).toHaveValue('');
  await note.fill('a'.repeat(65536));
  await dialog.getByRole('button', { name: 'Apply note', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'Save status', exact: true }),
  ).toContainText('Saved');
  expect(
    (await (await request.get(`/api/lists/${id}`)).json()).nodes[0].note.length,
  ).toBe(65536);
});
