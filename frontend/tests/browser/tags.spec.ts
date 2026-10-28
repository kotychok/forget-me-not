import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const node = (text: string, tags: string[] = [], children: any[] = []) => ({
  id: randomUUID(),
  kind: 'item',
  text,
  tags,
  children,
  completed: false,
});

test.beforeEach(async ({ page, request }) => {
  const list = await (
    await request.post('/api/lists', { data: { title: 'Tag list' } })
  ).json();
  const nodes = [
    node(
      'Parent context',
      [],
      [node('Unmatched sibling'), node('Matching child', ['work'])],
    ),
    node('Other match', ['work', 'Київ']),
    node('Different case', ['Work']),
  ];
  expect(
    (
      await request.put(`/api/lists/${list.id}`, {
        data: {
          baseRevision: 0,
          document: { id: list.id, title: list.title, nodes },
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/?list=${list.id}`);
});

test('tags Apply/Cancel, history, current JSON and global tag search preserve content', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  const item = page.getByRole('button', {
    name: 'Different case',
    exact: true,
  });
  await item.focus();
  await item.press('t');
  const dialog = page.getByRole('dialog', { name: 'Item tags', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Tags', exact: true });
  await input.fill('work, Київ, next');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(item).toBeFocused();
  expect(
    (await (await request.get(`/api/lists/${id}`)).json()).nodes[2].tags,
  ).toEqual(['Work']);
  await item.press('t');
  await input.fill('work, Київ, next');
  await dialog.getByRole('button', { name: 'Apply tags', exact: true }).click();
  await expect(
    page.getByLabel('Tags for Different case', { exact: true }),
  ).toContainText('next');
  const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
  const redo =
    process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
  await item.press(undo);
  await expect(
    page.getByLabel('Tags for Different case', { exact: true }),
  ).toHaveText('Work');
  await item.press(redo);
  await expect(
    page.getByLabel('Tags for Different case', { exact: true }),
  ).toContainText('next');
  await expect(
    page.getByRole('status', { name: 'Save status', exact: true }),
  ).toContainText('Saved');
  await page.reload();
  await expect(
    page.getByLabel('Tags for Different case', { exact: true }),
  ).toContainText('next');
  await page.getByRole('button', { name: 'Search lists', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Search lists' });
  await search.getByRole('textbox').fill('next');
  await search.getByRole('button', { name: /Tags/ }).click();
  await expect(item).toBeFocused();
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
  const data = JSON.parse(
    await readFile((await (await ready).path())!, 'utf8'),
  );
  expect(data.schemaVersion).toBe(4);
  expect(data.lists[0].nodes[2].tags).toEqual(['work', 'Київ', 'next']);
  await transfer.getByLabel('Export format').selectOption('markdown');
  await transfer
    .getByRole('button', { name: 'Export current list', exact: true })
    .click();
  await expect(transfer.getByRole('alert')).toContainText('contains tags');
  await transfer.getByLabel('Choose JSON or Markdown file').setInputFiles({
    name: 'tags.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await transfer
    .getByRole('button', { name: 'Import as new copies', exact: true })
    .click();
  await expect(transfer.getByRole('status')).toContainText('Imported 1 list');
  const lists = await (await request.get('/api/lists')).json();
  const copy = lists.find(
    (list: { id: string; title: string }) =>
      list.id !== id && list.title === 'Tag list',
  );
  expect(
    (await (await request.get(`/api/lists/${copy.id}`)).json()).nodes[2].tags,
  ).toEqual(['work', 'Київ', 'next']);
});

test('filter preserves ancestor context, locks structure and keeps saved collapse preferences unchanged', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  await page
    .getByRole('button', { name: 'Collapse Parent context', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/lists/${id}/view`)).json())
          .collapsedItemIds.length,
    )
    .toBe(1);
  const before = await (await request.get(`/api/lists/${id}`)).json();
  const select = page.getByRole('combobox', {
    name: 'Filter by tag',
    exact: true,
  });
  await select.selectOption('work');
  await expect(page.locator('.row')).toHaveCount(3);
  await expect(page.locator('.filter-context')).toContainText('Parent context');
  await expect(
    page.getByRole('button', { name: 'Unmatched sibling', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Different case', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Import / export', exact: false })
    .click();
  const transfer = page.getByRole('dialog', {
    name: 'Import / export',
    exact: true,
  });
  const downloadReady = page.waitForEvent('download');
  await transfer
    .getByRole('button', { name: 'Export current list', exact: true })
    .click();
  const fullExport = JSON.parse(
    await readFile((await (await downloadReady).path())!, 'utf8'),
  );
  expect(fullExport.lists[0].nodes.length).toBe(3);
  expect(fullExport.lists[0].nodes[0].children.length).toBe(2);
  await transfer
    .getByRole('button', { name: 'Close import and export', exact: true })
    .click();
  const child = page.getByRole('button', {
    name: 'Matching child',
    exact: true,
  });
  await child.focus();
  await expect(
    page.getByRole('button', { name: '＋ Add item', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Delete branch', exact: true }),
  ).toBeDisabled();
  await child.press('Tab');
  await child.press('Delete');
  await child.press('Enter');
  await child.press('Alt+ArrowUp');
  expect((await (await request.get(`/api/lists/${id}`)).json()).revision).toBe(
    before.revision,
  );
  await child.press('ArrowRight');
  await expect(child).toBeFocused();
  await child.press('ArrowLeft');
  await expect(
    page.getByRole('button', { name: 'Parent context', exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 954 });
  await page.screenshot({
    path: test.info().outputPath('tag-filter-mobile.png'),
  });
  await page.keyboard.press('Escape');
  await expect(select).toHaveValue('');
  expect(
    (await (await request.get(`/api/lists/${id}/view`)).json()).collapsedItemIds
      .length,
  ).toBe(1);
  await select.selectOption('work');
  await child.focus();
  await child.press('Escape');
  await expect(child).toBeFocused();
  await expect(select).toHaveValue('');
  await select.selectOption('work');
  await child.focus();
  await child.press('t');
  const dialog = page.getByRole('dialog', { name: 'Item tags' });
  await dialog.getByRole('textbox').fill('');
  await dialog.getByRole('button', { name: 'Apply tags', exact: true }).click();
  await expect(select).toHaveValue('');
  await expect(child).toBeFocused();
  await expect(page.locator('.row')).toHaveCount(5);
  await select.selectOption('work');
  await page.getByRole('button', { name: 'Search lists', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Search lists' });
  await search.getByRole('textbox').fill('Unmatched sibling');
  await search
    .locator(`[data-search-list="${id}"]`)
    .filter({ hasText: 'Unmatched sibling' })
    .click();
  await expect(select).toHaveValue('');
  await expect(
    page.getByRole('button', { name: 'Unmatched sibling', exact: true }),
  ).toBeFocused();
});

test('invalid tag drafts are blocked and applied tags survive an unacknowledged draft recovery', async ({
  page,
  request,
}) => {
  const original = new URL(page.url()).searchParams.get('list')!;
  await page.getByRole('button', { name: 'Other match', exact: true }).focus();
  await page.keyboard.press('t');
  const dialog = page.getByRole('dialog', { name: 'Item tags' });
  const input = dialog.getByRole('textbox');
  await input.fill('work, work');
  await expect(
    dialog.getByRole('button', { name: 'Apply tags', exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('Duplicate');
  await input.fill('recovered-tag');
  await page.route('**/api/lists/*', (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue(),
  );
  await dialog.getByRole('button', { name: 'Apply tags', exact: true }).click();
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
  const id = new URL(page.url()).searchParams.get('list')!;
  expect(id).not.toBe(original);
  expect(
    (await (await request.get(`/api/lists/${id}`)).json()).nodes[1].tags,
  ).toEqual(['recovered-tag']);
});
